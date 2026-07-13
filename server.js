/* Static server + NRL Fantasy data proxy — Railway compatible */
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const {createDatabase} = require('./db');
const {validateFeed} = require('./live-data');
const {
  parseInitialPlayerId, hasSeasonStats, searchQueryVariants, searchPlayerSelection, findSearchPlayerPath,
  hasCompleteSeasonDetails, payloadMatchesPlayer, buildOfficialPayload
} = require('./footystatistics');
const PORT     = process.env.PORT || 3000;
const APP_URL  = (process.env.APP_URL || 'https://nrl.the-squad.com.au').replace(/\/$/, '');
const FROM_EMAIL = process.env.FROM_EMAIL || 'NRL Fantasy <noreply@the-squad.com.au>';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_CAPTURE_FILE = process.env.NODE_ENV !== 'production' ? process.env.EMAIL_CAPTURE_FILE || '' : '';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const ALLOWED_ORIGIN = new URL(APP_URL).origin;
const SESSION_TTL_MS = Math.max(1000, Number(process.env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000);
const COOKIE_SECURE = process.env.NODE_ENV === 'production' || APP_URL.startsWith('https://');
const BODY_LIMIT = 100000;
const rateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.reset <= now) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

/* Email via Resend API */
function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
    if (EMAIL_CAPTURE_FILE) {
      const temporary = EMAIL_CAPTURE_FILE + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      fs.promises.writeFile(temporary, JSON.stringify({to, subject, html}), {mode: 0o600})
        .then(() => fs.promises.rename(temporary, EMAIL_CAPTURE_FILE))
        .then(resolve, error => { console.error('[email] test capture failed:', error.message); resolve(); });
      return;
    }
    if (!RESEND_KEY) {
      console.log('[email] RESEND_API_KEY not set — skipping:', subject, '→', to);
      return resolve();
    }
    const body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        let result = d;
        try { result = JSON.parse(d); } catch (_) {}
        if (r.statusCode >= 200 && r.statusCode < 300) console.log('[email] accepted:', subject, '→', to, result.id || 'ok');
        else console.error('[email] rejected:', r.statusCode, subject, '→', to);
        resolve();
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('email timeout')));
    req.on('error', e => { console.error('[email] error:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

/* Data storage */
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEAGUE_FILE = path.join(DATA_DIR, 'soo-leagues.json');
const USERS_FILE  = path.join(DATA_DIR, 'soo-users.json');
const SCORES_FILE = path.join(DATA_DIR, 'soo-scores.json');
let leagues = {};
let users   = {};  /* keyed by email (lowercase) */
let tokens  = {};  /* hashed token -> email */
const pendingRegistrations = new Set();
/* sooScores: { "gameNum:playerId": points }  e.g. { "3:1234": 87 } */
let sooScores = {};
let database = null;
let storageReady = false;
let storageMutation = Promise.resolve();

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
try { leagues = JSON.parse(fs.readFileSync(LEAGUE_FILE, 'utf8')); } catch(e) {}
try { sooScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  Object.values(users).forEach(user => {
    if (!Array.isArray(user.sessions)) user.sessions = [];
    const legacyHash = user.tokenHash || (user.token ? tokenHash(user.token) : null);
    if (legacyHash && user.tokenExpires && !user.sessions.some(session => session.hash === legacyHash))
      user.sessions.push({hash: legacyHash, expires: user.tokenExpires});
    delete user.token; delete user.tokenHash; delete user.tokenExpires;
    user.sessions.forEach(session => { if (session.hash && session.expires > Date.now()) tokens[session.hash] = user.email; });
  });
} catch(e) {}

function atomicSave(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
function queuedStorage(operation) {
  const pending = storageMutation.then(operation);
  storageMutation = pending.catch(() => {});
  return pending;
}
async function saveLeagues() {
  const snapshot = structuredClone(leagues);
  return queuedStorage(async () => { if (database) return database.saveLeagues(snapshot);
    try { atomicSave(LEAGUE_FILE, snapshot); } catch(e) { console.error('[storage] leagues:', e.message); throw e; } });
}
async function saveUsers() {
  const snapshot = structuredClone(users);
  return queuedStorage(async () => { if (database) return database.saveUsers(snapshot);
    try { atomicSave(USERS_FILE, snapshot); } catch(e) { console.error('[storage] users:', e.message); throw e; } });
}
async function saveScores() {
  const snapshot = structuredClone(sooScores);
  return queuedStorage(async () => { if (database) return database.saveScores(snapshot);
    try { atomicSave(SCORES_FILE, snapshot); } catch(e) { console.error('[storage] scores:', e.message); throw e; } });
}
async function saveAccountState() {
  const userSnapshot = structuredClone(users), leagueSnapshot = structuredClone(leagues);
  return queuedStorage(async () => {
    if (database) return database.saveAccountState(userSnapshot, leagueSnapshot);
    atomicSave(LEAGUE_FILE, leagueSnapshot); atomicSave(USERS_FILE, userSnapshot);
  });
}
function rebuildTokenIndex() {
  tokens = {};
  Object.values(users).forEach(user => (user.sessions || []).forEach(session => {
    if (session.hash && session.expires > Date.now()) tokens[session.hash] = user.email;
  }));
}
async function saveAccountStateOrRollback(previousUsers, previousLeagues) {
  try { return await saveAccountState(); }
  catch (error) { users = previousUsers; leagues = previousLeagues; rebuildTokenIndex(); throw error; }
}

function hashPwd(password, salt, iterations) {
  return new Promise((resolve, reject) => crypto.pbkdf2(password, salt, iterations || 310000, 64, 'sha512',
    (err, key) => err ? reject(err) : resolve(key.toString('hex'))));
}
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function genCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function readBody(req, cb, limit = BODY_LIMIT) {
  let body = '';
  let size = 0;
  let finished = false;
  const invoke = (...args) => {
    if (finished) return;
    finished = true;
    try { Promise.resolve(cb(...args)).catch(error => req.emit('handlerError', error)); }
    catch (error) { req.emit('handlerError', error); }
  };
  req.on('data', d => {
    if (finished) return;
    size += d.length;
    if (size > limit) {
      invoke(Object.assign(new Error('Payload too large'), {status: 413}));
      req.resume();
      return;
    }
    body += d;
  });
  req.on('end', () => {
    try { invoke(null, body ? JSON.parse(body) : {}); } catch(e) { invoke(e); }
  });
  req.on('aborted', () => invoke(Object.assign(new Error('Request aborted'), {status: 400})));
  req.on('error', () => invoke(Object.assign(new Error('Request failed'), {status: 400})));
}

function bodyError(req, res, err) {
  const status = err && err.status === 413 ? 413 : 400;
  jsonRes(req, res, status, {error: status === 413 ? 'Payload too large' : 'Bad request'});
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://fantasy.nrl.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  };
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return origin === ALLOWED_ORIGIN ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  } : {};
}

function jsonRes(req, res, status, obj, extra) {
  res.writeHead(status, Object.assign({}, securityHeaders('application/json; charset=utf-8'), {'Cache-Control': 'no-store', 'X-Request-Id': req.id || ''}, corsHeaders(req), extra || {}));
  res.end(status === 204 ? '' : JSON.stringify(obj));
}

function requestError(req, res, error) {
  console.error(JSON.stringify({
    type: 'request_error',
    id: req.id || null,
    method: req.method,
    path: String(req.url || '').split('?')[0],
    message: error && error.message ? error.message : 'Unknown request failure',
    stack: process.env.NODE_ENV === 'production' ? undefined : error && error.stack
  }));
  if (!res.headersSent) jsonRes(req, res, 500, {error: 'Internal server error', requestId: req.id || null});
  else if (!res.writableEnded) res.destroy();
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : String(req.socket.remoteAddress || '').trim();
}

function rateLimit(req, res, scope, limit, windowMs) {
  const now = Date.now();
  const key = scope + ':' + clientIp(req);
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) bucket = {count: 0, reset: now + windowMs};
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= limit) return false;
  jsonRes(req, res, 429, {error: 'Too many requests. Please try again later.'}, {'Retry-After': Math.ceil((bucket.reset - now) / 1000)});
  return true;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('='); return [decodeURIComponent(i < 0 ? v : v.slice(0, i)), decodeURIComponent(i < 0 ? '' : v.slice(i + 1))];
  }));
}

function isAdmin(user) { return !!(user && ADMIN_EMAILS.has(user.email)); }

function cleanPicks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowedPositions = new Set(['FB','WG','CTR','HLF','EDG','MID','HOK']);
  const playerCount = officialPlayerCount();
  const out = {};
  for (const [game, picks] of Object.entries(value).slice(0, 3)) {
    if (!/^[123]$/.test(game) || !picks || typeof picks !== 'object' || Array.isArray(picks)) continue;
    out[game] = {};
    const selected = new Set();
    for (const [position, playerId] of Object.entries(picks).slice(0, 20)) {
      const id = Number(playerId);
      if (allowedPositions.has(position) && Number.isSafeInteger(id) && id >= 0 && id < playerCount && !selected.has(id)) {
        out[game][position] = id; selected.add(id);
      }
    }
  }
  return out;
}

let _officialPlayerCount;
function officialPlayerCount() {
  if (_officialPlayerCount == null) {
    try { _officialPlayerCount = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/players.json'), 'utf8')).length; }
    catch { _officialPlayerCount = 0; }
  }
  return _officialPlayerCount;
}

const LOCKED_SOO_GAMES = new Set(['1','2','3']);
function withoutLockedPicks(picks) {
  return Object.fromEntries(Object.entries(picks).filter(([game]) => !LOCKED_SOO_GAMES.has(game)));
}
function changesLockedPicks(current, proposed) {
  return [...LOCKED_SOO_GAMES].some(game => JSON.stringify(current && current[game] || {}) !== JSON.stringify(proposed && proposed[game] || {}));
}

const APP_STATE_KEYS = new Set(['classic','customLeague','league','draft','settings','watchlist','corrections','origin','priceHistory','round','season']);
function cleanAppState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const clean = {};
  const records = new Set(['classic','customLeague','league','draft','settings','corrections','origin','priceHistory','season']);
  for (const [key, item] of Object.entries(value)) {
    if (!APP_STATE_KEYS.has(key)) continue;
    if (key === 'watchlist') {
      if (!Array.isArray(item) || item.length > 1000 || item.some(id => !Number.isSafeInteger(Number(id)))) return null;
      clean[key] = item.map(Number); continue;
    }
    if (key === 'round') {
      if (!Number.isSafeInteger(Number(item)) || Number(item) < 1 || Number(item) > 100) return null;
      clean[key] = Number(item); continue;
    }
    if (records.has(key) && item !== null && (typeof item !== 'object' || Array.isArray(item))) return null;
    clean[key] = item;
  }
  return clean;
}

function safeName(value, fallback, max) {
  const name = String(value || '').trim().replace(/[\u0000-\u001f\u007f<>&]/g, '').slice(0, max);
  return name || fallback;
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function textRes(res, status, text, contentType) {
  res.writeHead(status, securityHeaders(contentType || 'text/plain; charset=utf-8'));
  res.end(text);
}

function compressedRes(req, res, status, data, headers) {
  const accepts = String(req.headers['accept-encoding'] || '');
  const base = Object.assign({}, securityHeaders(headers['Content-Type']), headers, {'Vary': 'Accept-Encoding', 'X-Request-Id': req.id || ''});
  if (headers.ETag && String(req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(headers.ETag)) {
    res.writeHead(304, base); res.end(); return;
  }
  if (accepts.includes('br')) {
    zlib.brotliCompress(data, (err, output) => {
      if (err) return textRes(res, 500, 'compression error');
      res.writeHead(status, Object.assign(base, {'Content-Encoding': 'br'})); res.end(output);
    });
  } else if (accepts.includes('gzip')) {
    zlib.gzip(data, (err, output) => {
      if (err) return textRes(res, 500, 'compression error');
      res.writeHead(status, Object.assign(base, {'Content-Encoding': 'gzip'})); res.end(output);
    });
  } else {
    res.writeHead(status, base); res.end(data);
  }
}

function contentEtag(data) {
  return 'W/"' + crypto.createHash('sha256').update(data).digest('base64url').slice(0, 24) + '"';
}

/* Resolve user from token (body.token or Authorization header) */
function authUser(req, body) {
  const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const tok = parseCookies(req).session || hdr || (body && body.token) || '';
  const hash = tokenHash(tok);
  const email = tokens[hash] || tokens[tok];
  const user = email ? users[email] : null;
  if (!user) return null;
  const sessions = Array.isArray(user.sessions) ? user.sessions : [];
  const session = sessions.find(item => item.hash === hash || item.hash === tok);
  if (!session || session.expires < Date.now()) {
    delete tokens[hash]; delete tokens[tok];
    user.sessions = sessions.filter(item => item !== session && item.expires >= Date.now());
    saveUsers().catch(e => console.error('[storage] expired session:', e.message)); return null;
  }
  return user;
}

function issueSession(user) {
  const token = genToken();
  const hash = tokenHash(token), expires = Date.now() + SESSION_TTL_MS;
  user.sessions = (Array.isArray(user.sessions) ? user.sessions : []).filter(session => session.expires >= Date.now());
  user.sessions.push({hash, expires});
  tokens[hash] = user.email;
  return {token, cookie: 'session=' + encodeURIComponent(token) + '; Path=/; HttpOnly' + (COOKIE_SECURE ? '; Secure' : '') + '; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)};
}

function revokeSession(req, body, user) {
  const raw = parseCookies(req).session || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || body && body.token || '';
  const hash = tokenHash(raw);
  delete tokens[hash]; delete tokens[raw];
  if (user) user.sessions = (user.sessions || []).filter(session => session.hash !== hash && session.hash !== raw);
}

function revokeAllSessions(user) {
  for (const session of user.sessions || []) delete tokens[session.hash];
  if (user.tokenHash) delete tokens[user.tokenHash];
  if (user.token) delete tokens[user.token];
  user.sessions = [];
  delete user.token; delete user.tokenHash; delete user.tokenExpires;
}

function publicUser(user) {
  return {userId: user.userId, name: user.name, email: user.email, leagueCode: user.leagueCode || null,
    teamId: user.teamId || null, isAdmin: isAdmin(user)};
}

/* Static file helpers */
function serveLocal(req, res, filePath) {
  fs.readFile(filePath, function(err, data) {
    if (err) return proxyNRL(req, res, path.basename(filePath).replace('.json', '') === 'players'
      ? 'players.json' : 'rounds.json');
    compressedRes(req, res, 200, data, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'ETag': contentEtag(data)
    });
  });
}

const officialFeedCache = new Map();
const OFFICIAL_FEED_FRESH_MS = 30000;
const OFFICIAL_FEED_RETRIES = 2;

function requestOfficialJson(fileName) {
  return new Promise((resolve, reject) => {
    const upstreamReq = https.request({
      hostname: 'fantasy.nrl.com', path: '/data/nrl/' + fileName + '.json', method: 'GET',
      headers: {'User-Agent': 'NRL-Fantasy-The-Squad/1.0', 'Accept': 'application/json', 'Accept-Encoding': 'identity'}
    }, upstream => {
      const chunks = []; let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) return upstream.destroy(new Error('official NRL response too large'));
        chunks.push(chunk);
      });
      upstream.on('end', () => {
        if (upstream.statusCode < 200 || upstream.statusCode >= 300)
          return reject(new Error('official NRL upstream returned ' + upstream.statusCode));
        try {
          let body = Buffer.concat(chunks);
          const encoding = String(upstream.headers['content-encoding'] || '').toLowerCase();
          if (encoding === 'gzip' || (body[0] === 0x1f && body[1] === 0x8b)) body = zlib.gunzipSync(body);
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
          resolve(validateFeed(fileName, JSON.parse(body.toString('utf8'))));
        } catch (error) { reject(error); }
      });
      upstream.on('error', reject);
    });
    upstreamReq.on('error', reject);
    upstreamReq.setTimeout(8000, () => upstreamReq.destroy(new Error('official NRL upstream timeout')));
    upstreamReq.end();
  });
}

async function fetchOfficialJson(fileName) {
  let lastError;
  for (let attempt = 0; attempt < OFFICIAL_FEED_RETRIES; attempt++) {
    try { return await requestOfficialJson(fileName); }
    catch (error) {
      lastError = error;
      if (attempt + 1 < OFFICIAL_FEED_RETRIES) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function officialFeed(fileName) {
  const now = Date.now();
  let entry = officialFeedCache.get(fileName);
  if (entry && entry.value && now - entry.fetchedAt < OFFICIAL_FEED_FRESH_MS)
    return {value: entry.value, fetchedAt: entry.fetchedAt, source: 'memory', stale: false};
  if (entry && entry.promise) return entry.promise;
  entry = entry || {};
  entry.promise = fetchOfficialJson(fileName).then(value => {
    const updated = {value, fetchedAt: Date.now(), source: 'upstream', stale: false};
    officialFeedCache.set(fileName, updated);
    return updated;
  }).catch(async error => {
    console.error('[nrl-live-feed]', fileName, error.message);
    if (entry.value) return {value: entry.value, fetchedAt: entry.fetchedAt, source: 'stale-memory', stale: true, error};
    const value = validateFeed(fileName, JSON.parse(await fs.promises.readFile(path.join(__dirname, 'public', fileName + '.json'), 'utf8')));
    const fallback = {value, fetchedAt: Date.now(), source: 'snapshot', stale: true};
    officialFeedCache.set(fileName, fallback);
    return fallback;
  });
  officialFeedCache.set(fileName, entry);
  return entry.promise;
}

async function serveOfficialFeed(req, res, fileName) {
  const feed = await officialFeed(fileName);
  const data = Buffer.from(JSON.stringify(feed.value));
  compressedRes(req, res, 200, data, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, max-age=0, must-revalidate',
    'ETag': contentEtag(data),
    'X-NRL-Data-Source': feed.source,
    'X-NRL-Data-Age': String(Math.max(0, Math.floor((Date.now() - feed.fetchedAt) / 1000))),
    'X-NRL-Data-Stale': feed.stale ? 'true' : 'false',
    ...(feed.stale ? {'Warning': '110 - "Response is stale"'} : {})
  });
}

function serveAsset(req, res, fileName) {
  const allowed = new Set(['data-core.js', 'season-data.js', 'history-data.js']);
  if (!allowed.has(fileName)) return jsonRes(req, res, 404, {error: 'Asset not found'});
  fs.readFile(path.join(__dirname, 'public', 'assets', fileName), function(err, data) {
    if (err) return jsonRes(req, res, 404, {error: 'Asset not found'});
    const headers = {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'ETag': contentEtag(data)
    };
    if (req.method === 'HEAD') {
      if (String(req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(headers.ETag)) {
        res.writeHead(304, Object.assign({}, securityHeaders(headers['Content-Type']), headers)); res.end(); return;
      }
      res.writeHead(200, Object.assign({}, securityHeaders(headers['Content-Type']), headers)); res.end(); return;
    }
    compressedRes(req, res, 200, data, headers);
  });
}

function serveInstallFile(req, res, filePath, contentType) {
  fs.readFile(filePath, function(err, data) {
    if (err) return jsonRes(req, res, 404, {error: 'File not found'});
    const headers = {'Content-Type': contentType, 'Cache-Control': 'no-cache', 'ETag': contentEtag(data)};
    if (req.method === 'HEAD') {
      if (String(req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(headers.ETag)) {
        res.writeHead(304, Object.assign({}, securityHeaders(contentType), headers)); res.end(); return;
      }
      res.writeHead(200, Object.assign({}, securityHeaders(contentType), headers)); res.end(); return;
    }
    compressedRes(req, res, 200, data, headers);
  });
}

function proxyNRL(req, res, nrlPath) {
  const opts = {
    hostname: 'www.fantasy.nrl.com',
    path: '/data/nrl/' + nrlPath,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.fantasy.nrl.com/',
      'Origin': 'https://www.fantasy.nrl.com'
    }
  };
  let settled = false;
  const upstreamReq = https.request(opts, function(upstream) {
    if (settled) { upstream.resume(); return; }
    settled = true;
    res.writeHead(upstream.statusCode, Object.assign({}, securityHeaders('application/json; charset=utf-8'), corsHeaders(req), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60'
    }));
    upstream.pipe(res);
  });
  upstreamReq.on('error', function(e) {
    if (settled) return;
    settled = true;
    console.error('[nrl-proxy]', e.message);
    jsonRes(req, res, 502, {error: 'NRL data is temporarily unavailable', requestId: req.id || null});
  });
  upstreamReq.setTimeout(10000, () => upstreamReq.destroy(new Error('upstream timeout')));
  upstreamReq.end();
}

const footyStatisticsIds = new Map();
function footyStatisticsGet(requestPath, accept) {
  return new Promise((resolve, reject) => {
    const upstreamReq = https.request({
      hostname: 'footystatistics.com', path: requestPath, method: 'GET',
      headers: {'User-Agent': 'NRL-Fantasy-The-Squad/1.0', 'Accept': accept}
    }, upstream => {
      const chunks = []; let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > 3 * 1024 * 1024) return upstream.destroy(new Error('upstream response too large'));
        chunks.push(chunk);
      });
      upstream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          const error = new Error('upstream returned ' + upstream.statusCode);
          error.statusCode = upstream.statusCode;
          return reject(error);
        }
        resolve(body);
      });
      upstream.on('error', reject);
    });
    upstreamReq.on('error', reject);
    upstreamReq.setTimeout(10000, () => upstreamReq.destroy(new Error('upstream timeout')));
    upstreamReq.end();
  });
}

async function footyStatisticsPayload(playerId) {
  const body = await footyStatisticsGet('/api/player-stats?player_id=' + encodeURIComponent(playerId), 'application/json');
  return JSON.parse(body);
}

async function officialNrlData() {
  const [players, rounds] = await Promise.all([officialFeed('players'), officialFeed('rounds')]);
  return {players: players.value, rounds: rounds.value};
}

function officialNrlPlayerDetails(playerId) {
  return new Promise((resolve, reject) => {
    const upstreamReq = https.request({
      hostname: 'fantasy.nrl.com', path: '/data/nrl/stats/players/' + encodeURIComponent(playerId) + '.json',
      method: 'GET', headers: {'User-Agent': 'NRL-Fantasy-The-Squad/1.0', 'Accept': 'application/json', 'Accept-Encoding': 'identity'}
    }, upstream => {
      const chunks = []; let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > 3 * 1024 * 1024) return upstream.destroy(new Error('official NRL response too large'));
        chunks.push(chunk);
      });
      upstream.on('end', () => {
        if (upstream.statusCode < 200 || upstream.statusCode >= 300)
          return reject(new Error('official NRL upstream returned ' + upstream.statusCode));
        try {
          let body = Buffer.concat(chunks);
          const encoding = String(upstream.headers['content-encoding'] || '').toLowerCase();
          if (encoding === 'gzip') body = zlib.gunzipSync(body);
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
          resolve(JSON.parse(body.toString('utf8')));
        } catch (error) { reject(error); }
      });
      upstream.on('error', reject);
    });
    upstreamReq.on('error', reject);
    upstreamReq.setTimeout(10000, () => upstreamReq.destroy(new Error('official NRL upstream timeout')));
    upstreamReq.end();
  });
}

async function officialNrlPayload(playerId, sourcePlayerId, year) {
  const [{players, rounds}, details] = await Promise.all([officialNrlData(), officialNrlPlayerDetails(playerId)]);
  const player = players.find(item => Number(item.id) === Number(playerId));
  if (!player) throw new Error('official NRL player was not found');
  const payload = buildOfficialPayload(player, rounds, details, year, sourcePlayerId);
  if (!hasSeasonStats(payload, year)) throw new Error('official NRL current season statistics were not found');
  return payload;
}

async function resolveFootyStatisticsId(player, slug) {
  const cached = footyStatisticsIds.get(player.id);
  if (cached) return {...cached, method: 'cache'};
  const expected = {name: player.first_name + ' ' + player.last_name, slug, squadId: player.squad_id, positions: player.positions};
  const failures = []; let ambiguous = false;
  for (const searchPath of ['/api/players/search', '/api/search']) {
    for (const query of searchQueryVariants(expected.name)) try {
      const searchBody = await footyStatisticsGet(searchPath + '?q=' + encodeURIComponent(query), 'application/json');
      const results = JSON.parse(searchBody);
      const selection = searchPlayerSelection(results, expected);
      if (!selection || !selection.player) continue;
      if (selection.ambiguous) { ambiguous = true; continue; }
      const searchId = String(selection.player.id || selection.player.player_id || '');
      if (/^\d+$/.test(searchId) && searchId !== String(player.id)) {
        const resolved = {id: searchId, resolved: true, method: 'search', ambiguous, failures};
        footyStatisticsIds.set(player.id, resolved); return resolved;
      }
      const profilePath = findSearchPlayerPath(results, expected);
      if (!profilePath) continue;
      const profile = await footyStatisticsGet(profilePath, 'text/html');
      const profileId = parseInitialPlayerId(profile);
      if (profileId) {
        const resolved = {id: profileId, resolved: true, method: 'profile', ambiguous, failures};
        footyStatisticsIds.set(player.id, resolved); return resolved;
      }
    } catch (error) {
      failures.push(searchPath + ': ' + error.message);
    }
  }
  return {id: String(player.id), resolved: false, method: ambiguous ? 'ambiguous' : 'official-fallback', ambiguous, failures};
}

async function officialPlayer(playerId) {
  const {players} = await officialNrlData();
  return players.find(item => Number(item.id) === Number(playerId)) || null;
}

async function proxyFootyStatistics(req, res, playerId, slug) {
  try {
    const year = new Date().getFullYear();
    const player = await officialPlayer(playerId);
    if (!player) throw new Error('official NRL player was not found');
    const resolution = slug ? await resolveFootyStatisticsId(player, slug) : {
      id: String(playerId), resolved: false, method: 'official-fallback', ambiguous: false, failures: []
    };
    const resolvedId = resolution.id;
    let payload = null;
    let fallbackReason = '';
    try {
      payload = await footyStatisticsPayload(resolvedId);
    } catch (error) {
      console.warn('[footystatistics-proxy] resolved payload failed:', error.message);
      fallbackReason = 'upstream-failure';
    }
    if (payload && !payloadMatchesPlayer(payload, {
      name: player.first_name + ' ' + player.last_name, slug, squadId: player.squad_id, positions: player.positions
    })) fallbackReason = 'identity-mismatch';
    else if (payload && !hasCompleteSeasonDetails(payload, year, player.stats && player.stats.scores))
      fallbackReason = 'incomplete-details';
    if (!payload || fallbackReason)
      payload = await officialNrlPayload(playerId, resolvedId, year);
    payload.source_player_id = Number(resolvedId);
    payload.resolution_status = resolution.resolved ? 'resolved' : 'official-fallback';
    payload.resolution_method = resolution.method;
    jsonRes(req, res, 200, payload, {
      'Cache-Control': 'no-cache, max-age=0, must-revalidate',
      'X-FootyStatistics-Player-Id': resolvedId,
      'X-FootyStatistics-Resolution': payload.resolution_status,
      'X-FootyStatistics-Resolution-Method': resolution.method,
      'X-FootyStatistics-Ambiguous': resolution.ambiguous ? 'true' : 'false',
      'X-Player-Stats-Source': fallbackReason ? 'official-nrl-fallback' : 'footystatistics',
      'X-Player-Stats-Fallback-Reason': fallbackReason
    });
  } catch (error) {
    console.error('[footystatistics-proxy]', error.message);
    jsonRes(req, res, 502, {error: 'Detailed player statistics are temporarily unavailable', requestId: req.id || null});
  }
}

/* HTTP server */
async function handleRequest(req, res) {
  req.id = crypto.randomUUID();
  req.once('handlerError', error => requestError(req, res, error));
  const started = Date.now();
  res.on('finish', () => console.log(JSON.stringify({type: 'request', id: req.id, method: req.method,
    path: String(req.url || '').split('?')[0], status: res.statusCode, durationMs: Date.now() - started})));
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    jsonRes(req, res, 204, {}, {'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization'}); return;
  }

  if (url === '/health') {
    jsonRes(req, res, 200, {ok: true, uptime: Math.floor(process.uptime())}); return;
  }
  if (url === '/ready') {
    if (storageReady && database) {
      try { await database.ping(); } catch (error) {
        console.error('[readiness]', error.message);
        return jsonRes(req, res, 503, {ok: false, storage: 'postgresql'});
      }
    }
    jsonRes(req, res, storageReady ? 200 : 503, {ok: storageReady, storage: database ? 'postgresql' : 'json'}); return;
  }

  if (url === '/api/players' && (req.method === 'GET' || req.method === 'HEAD'))
    return serveOfficialFeed(req, res, 'players').catch(error => requestError(req, res, error));
  if (url === '/api/rounds' && (req.method === 'GET' || req.method === 'HEAD'))
    return serveOfficialFeed(req, res, 'rounds').catch(error => requestError(req, res, error));
  const playerStats = url.match(/^\/api\/player-stats\/(\d+)$/);
  if (playerStats && req.method === 'GET') {
    const requested = new URL(req.url, 'http://localhost');
    const slug = requested.searchParams.get('slug') || '';
    return proxyFootyStatistics(req, res, playerStats[1], /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '');
  }
  if (url === '/manifest.webmanifest' && (req.method === 'GET' || req.method === 'HEAD'))
    return serveInstallFile(req, res, path.join(__dirname, 'public', 'manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
  if (url === '/assets/app-icon.svg' && (req.method === 'GET' || req.method === 'HEAD'))
    return serveInstallFile(req, res, path.join(__dirname, 'public', 'assets', 'app-icon.svg'), 'image/svg+xml; charset=utf-8');
  const asset = url.match(/^\/assets\/(data-core|season-data|history-data)\.js$/);
  if (asset && (req.method === 'GET' || req.method === 'HEAD')) return serveAsset(req, res, asset[1] + '.js');
  if (url.startsWith('/assets/')) return jsonRes(req, res, 404, {error: 'Asset not found'});

  /* Auth */

  if (url === '/api/soo/register' && req.method === 'POST') {
    if (rateLimit(req, res, 'register', 5, 15 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, err.status || 400, {error: err.status === 413 ? 'Payload too large' : 'Bad request'});
      const email = (body.email||'').trim().toLowerCase();
      const name  = (body.name||'').trim().slice(0,40);
      const pass  = body.password||'';
      if (!email || !name || pass.length < 12 || pass.length > 128)
        return jsonRes(req, res, 400, {error: 'Name, email and password (12-128 chars) required'});
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return jsonRes(req, res, 400, {error: 'Invalid email'});
      if (users[email] || pendingRegistrations.has(email))
        return jsonRes(req, res, 409, {error: 'Email already registered'});
      pendingRegistrations.add(email);
      try {
        const salt   = crypto.randomBytes(16).toString('hex');
        const userId = genCode(10);
        users[email] = { userId, name: safeName(name, 'Player', 40), email, salt, iterations: 310000,
          hash: await hashPwd(pass, salt, 310000), sessions: [], appStateVersion: 0 };
        const session = issueSession(users[email]);
        await saveUsers();
        jsonRes(req, res, 201, publicUser(users[email]), {'Set-Cookie': session.cookie});
        /* Welcome email is asynchronous and does not block the response. */
        sendEmail(email, 'Welcome to NRL Fantasy! \u{1F3C9}', `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
            <h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy &#127945;</h2>
            <p>Hey ${escapeHtml(users[email].name)},</p>
            <p>You're all set! Head back to the app to pick your State of Origin team and compete with mates.</p>
            <a href="${APP_URL}" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Go to NRL Fantasy</a>
            <p style="color:#888;font-size:12px;margin-top:24px">Unofficial fan-made game &middot; Not affiliated with the NRL</p>
          </div>
        `).catch(() => {});
      } catch (error) {
        if (users[email]) { revokeAllSessions(users[email]); delete users[email]; }
        throw error;
      } finally { pendingRegistrations.delete(email); }
    });
    return;
  }

  if (url === '/api/soo/login' && req.method === 'POST') {
    if (rateLimit(req, res, 'login', 10, 15 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const email = (body.email||'').trim().toLowerCase();
      const pass  = body.password||'';
      const user  = users[email];
      const supplied = user ? Buffer.from(await hashPwd(pass, user.salt, user.iterations || 10000), 'hex') : Buffer.alloc(64);
      const expected = user ? Buffer.from(user.hash, 'hex') : crypto.randomBytes(64);
      if (!user || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected))
        return jsonRes(req, res, 401, {error: 'Invalid email or password'});
      if (!user.iterations || user.iterations < 310000) {
        user.salt = crypto.randomBytes(16).toString('hex'); user.iterations = 310000; user.hash = await hashPwd(pass, user.salt, user.iterations);
      }
      const session = issueSession(user);
      await saveUsers();
      jsonRes(req, res, 200, publicUser(user), {'Set-Cookie': session.cookie});
    });
    return;
  }

  /* POST /api/soo/forgot-password { email } */
  if (url === '/api/soo/forgot-password' && req.method === 'POST') {
    if (rateLimit(req, res, 'forgot', 5, 60 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const email = (body.email||'').trim().toLowerCase();
      /* Always 200 — never reveal whether an email is registered. */
      jsonRes(req, res, 200, {ok: true});
      const user = users[email];
      if (!user) return;
      const tok = genToken();
      user.resetTokenHash = tokenHash(tok);
      user.resetExpires = Date.now() + 3600000;
      await saveUsers();
      const link = APP_URL + '/?resetToken=' + tok;
      await sendEmail(email, 'Reset your NRL Fantasy password', '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy &#127945;</h2><p>Hi ' + escapeHtml(user.name) + ',</p><p>Someone requested a password reset for your account. Click below to set a new password &mdash; this link expires in <strong>1 hour</strong>.</p><a href="' + link + '" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Reset Password</a><p style="color:#888;font-size:12px">If you did not request this, you can safely ignore this email.</p><p style="color:#888;font-size:11px;word-break:break-all">Or copy this link: ' + link + '</p></div>').catch(() => {});
    });
    return;
  }

  /* POST /api/soo/reset-password { token, password } */
  if (url === '/api/soo/reset-password' && req.method === 'POST') {
    if (rateLimit(req, res, 'reset', 10, 60 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const resetHash = tokenHash(body.token);
      const user = Object.values(users).find(candidate => candidate.resetTokenHash === resetHash);
      if (!user || !user.resetExpires || Date.now() > user.resetExpires)
        return jsonRes(req, res, 400, {error: 'Reset link has expired or is invalid. Please request a new one.'});
      if (!body.password || body.password.length < 12 || body.password.length > 128)
        return jsonRes(req, res, 400, {error: 'Password must be 12-128 characters'});
      const salt = crypto.randomBytes(16).toString('hex');
      user.salt = salt;
      user.iterations = 310000;
      user.hash = await hashPwd(body.password, salt, user.iterations);
      revokeAllSessions(user);
      const session = issueSession(user);
      delete user.resetTokenHash; delete user.resetExpires;
      await saveUsers();
      jsonRes(req, res, 200, publicUser(user), {'Set-Cookie': session.cookie});
    });
    return;
  }

  if (url === '/api/soo/logout' && req.method === 'POST') {
    const user = authUser(req, {});
    if (user) {
      revokeSession(req, {}, user);
      saveUsers().catch(e => console.error('[storage] logout:', e.message));
    }
    jsonRes(req, res, 200, {ok: true}, {'Set-Cookie': 'session=; Path=/; HttpOnly' + (COOKIE_SECURE ? '; Secure' : '') + '; SameSite=Lax; Max-Age=0'});
    return;
  }

  if (url === '/api/soo/account' && req.method === 'DELETE') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const supplied = Buffer.from(await hashPwd(body.password || '', user.salt, user.iterations || 10000), 'hex');
      const expected = Buffer.from(user.hash, 'hex');
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected))
        return jsonRes(req, res, 403, {error: 'Incorrect password'});

      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues);
      for (const [code, league] of Object.entries(leagues)) {
        league.teams = (league.teams || []).filter(team => team.userId !== user.userId);
        if (league.ownerId === user.userId) {
          if (league.teams.length) league.ownerId = league.teams[0].userId;
          else delete leagues[code];
        }
      }
      revokeAllSessions(user);
      delete users[user.email];
      await saveAccountStateOrRollback(previousUsers, previousLeagues);
      jsonRes(req, res, 200, {ok: true}, {'Set-Cookie': 'session=; Path=/; HttpOnly' + (COOKIE_SECURE ? '; Secure' : '') + '; SameSite=Lax; Max-Age=0'});
    });
    return;
  }

  if (url === '/api/soo/me' && req.method === 'GET') {
    const user = authUser(req, {});
    if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
    const hasCookie = !!parseCookies(req).session;
    if (!hasCookie) {
      const session = issueSession(user); await saveUsers();
      return jsonRes(req, res, 200, publicUser(user), {'Set-Cookie': session.cookie});
    }
    jsonRes(req, res, 200, publicUser(user));
    return;
  }

  if (url === '/api/app-state' && req.method === 'GET') {
    const user = authUser(req, {});
    if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
    return jsonRes(req, res, 200, {state: user.appState || null, updatedAt: user.appStateUpdated || null,
      version: Number(user.appStateVersion) || 0});
  }

  if (url === '/api/app-state' && req.method === 'PUT') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const state = cleanAppState(body.state);
      if (!state) return jsonRes(req, res, 400, {error: 'Invalid app state'});
      const baseVersion = Number(body.baseVersion);
      const currentVersion = Number(user.appStateVersion) || 0;
      if (!Number.isSafeInteger(baseVersion) || baseVersion < 0)
        return jsonRes(req, res, 428, {error: 'A valid baseVersion is required', version: currentVersion});
      let result;
      if (database) result = await queuedStorage(() => database.saveAppState(user.email, state, baseVersion));
      else if (baseVersion !== currentVersion) result = {ok:false, version:currentVersion,
        state:user.appState || null, updatedAt:user.appStateUpdated || null};
      else result = {ok:true, version:currentVersion + 1, updatedAt:Date.now()};
      if (!result.ok) return jsonRes(req, res, 409, {error: 'Cloud state changed on another device',
        version: result.version, updatedAt: result.updatedAt, state: result.state});
      user.appState = state; user.appStateUpdated = result.updatedAt; user.appStateVersion = result.version;
      if (!database) await saveUsers();
      jsonRes(req, res, 200, {ok:true, updatedAt:user.appStateUpdated, version:user.appStateVersion});
    }, 1000000);
    return;
  }

  /* League API (all require authentication) */

  /* POST /api/soo/create  { name, teamName, picks, token } */
  if (url === '/api/soo/create' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      if (user.leagueCode && leagues[user.leagueCode]) {
        const existing = leagues[user.leagueCode].teams.find(team => team.userId === user.userId);
        return jsonRes(req, res, 409, {error: 'You already belong to a league', code: user.leagueCode,
          teamId: existing && existing.id || user.teamId});
      }
      const code   = genCode(6);
      const teamId = genCode(10);
      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues);
      leagues[code] = {
        name: safeName(body.name, 'SoO League', 40),
        ownerId: user.userId,
        created: Date.now(),
        teams: [{
          id: teamId,
          userId: user.userId,
          name: safeName(body.teamName || user.name, 'My Team', 30),
          picks: withoutLockedPicks(cleanPicks(body.picks)), version: 0
        }]
      };
      user.leagueCode = code; user.teamId = teamId;
      await saveAccountStateOrRollback(previousUsers, previousLeagues);
      jsonRes(req, res, 200, { code, teamId, version: 0 });
    });
    return;
  }

  /* POST /api/soo/join  { code, teamName, picks, token } */
  if (url === '/api/soo/join' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) return jsonRes(req, res, 400, {error: 'Invalid league code'});
      const lg = leagues[code];
      if (!lg) return jsonRes(req, res, 404, {error: 'League not found'});
      if (lg.teams.length >= 30) return jsonRes(req, res, 400, {error: 'League full'});
      const existing = lg.teams.find(t => t.userId === user.userId);
      if (existing) return jsonRes(req, res, 409, {error: 'You already have a team in this league', teamId: existing.id, league: {name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId}});
      if (user.leagueCode && leagues[user.leagueCode])
        return jsonRes(req, res, 409, {error: 'Leave your current league before joining another'});
      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues);
      const teamId = genCode(10);
      lg.teams.push({
        id: teamId,
        userId: user.userId,
        name: safeName(body.teamName || user.name, 'New Team', 30),
        picks: withoutLockedPicks(cleanPicks(body.picks)), version: 0
      });
      user.leagueCode = code; user.teamId = teamId;
      await saveAccountStateOrRollback(previousUsers, previousLeagues);
      jsonRes(req, res, 200, { teamId, version: 0,
        league: { name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId } });
    });
    return;
  }

  /* GET /api/soo/my-league */
  if (url === '/api/soo/my-league' && req.method === 'GET') {
    const u = authUser(req, {});
    if (!u || !u.leagueCode) return jsonRes(req, res, 404, {error: 'No league'});
    const lg = leagues[u.leagueCode];
    if (!lg) return jsonRes(req, res, 404, {error: 'League not found'});
    jsonRes(req, res, 200, { leagueCode: u.leagueCode, teamId: u.teamId, league: { name: lg.name, code: u.leagueCode, teams: lg.teams, ownerId: lg.ownerId } });
    return;
  }

  /* GET /api/soo/league/:code */
  const leagueGet = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueGet && req.method === 'GET') {
    const lg = leagues[leagueGet[1]];
    if (!lg) return jsonRes(req, res, 404, {error: 'Not found'});
    const user = authUser(req, {});
    if (!user || !lg.teams.some(t => t.userId === user.userId)) return jsonRes(req, res, 403, {error: 'League membership required'});
    jsonRes(req, res, 200, { name: lg.name, code: leagueGet[1], teams: lg.teams, ownerId: lg.ownerId });
    return;
  }

  /* POST /api/soo/league/:code/picks */
  const leaguePicks = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)\/picks$/);
  if (leaguePicks && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const lg = leagues[leaguePicks[1]];
      if (!lg) return jsonRes(req, res, 404, {error: 'Not found'});
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const team = lg.teams.find(t => t.id === body.teamId);
      if (!team) return jsonRes(req, res, 404, {error: 'Team not found'});
      if (team.userId !== user.userId) return jsonRes(req, res, 403, {error: 'You can only update your own team'});
      const baseVersion = Number(body.baseVersion);
      if (!Number.isSafeInteger(baseVersion) || baseVersion < 0)
        return jsonRes(req, res, 428, {error: 'A valid baseVersion is required', version: Number(team.version) || 0});
      if (baseVersion !== (Number(team.version) || 0))
        return jsonRes(req, res, 409, {error: 'Team changed on another device', version: Number(team.version) || 0, team});
      const nextPicks = cleanPicks(body.picks);
      if (changesLockedPicks(team.picks, nextPicks))
        return jsonRes(req, res, 423, {error: 'Picks for completed State of Origin games are locked', version: Number(team.version) || 0});
      const previousTeam = structuredClone(team);
      team.picks = nextPicks;
      if (body.teamName) team.name = safeName(body.teamName, team.name, 30);
      team.version = (Number(team.version) || 0) + 1;
      try { await saveLeagues(); } catch (error) { Object.keys(team).forEach(key => delete team[key]); Object.assign(team, previousTeam); throw error; }
      jsonRes(req, res, 200, { ok: true, version: team.version });
    });
    return;
  }

  /* DELETE /api/soo/league/:code/team/:teamId */
  const teamDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)\/team\/([A-Z0-9]+)$/);
  if (teamDel && req.method === 'DELETE') {
    readBody(req, async (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const lg = leagues[teamDel[1]];
      if (!lg) return jsonRes(req, res, 404, {error: 'League not found'});
      if (lg.ownerId && lg.ownerId !== user.userId) return jsonRes(req, res, 403, {error: 'Only the league owner can remove teams'});
      const removed = lg.teams.find(t => t.id === teamDel[2]);
      if (removed && removed.userId === lg.ownerId) return jsonRes(req, res, 400, {error: 'The league owner cannot be removed'});
      const before = lg.teams.length;
      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues);
      lg.teams = lg.teams.filter(t => t.id !== teamDel[2]);
      if (lg.teams.length === before) return jsonRes(req, res, 404, {error: 'Team not found'});
      const removedUser = Object.values(users).find(u => removed && u.userId === removed.userId);
      if (removedUser) { delete removedUser.leagueCode; delete removedUser.teamId; }
      await saveAccountStateOrRollback(previousUsers, previousLeagues);
      jsonRes(req, res, 200, { ok: true, teams: lg.teams });
    });
    return;
  }

  /* DELETE /api/soo/league/:code */
  const leagueDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueDel && req.method === 'DELETE') {
    readBody(req, async (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const lg = leagues[leagueDel[1]];
      if (!lg) return jsonRes(req, res, 404, {error: 'League not found'});
      if (lg.ownerId && lg.ownerId !== user.userId) return jsonRes(req, res, 403, {error: 'Only the league owner can delete this league'});
      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues);
      delete leagues[leagueDel[1]];
      Object.values(users).forEach(u => { if (u.leagueCode === leagueDel[1]) { delete u.leagueCode; delete u.teamId; } });
      await saveAccountStateOrRollback(previousUsers, previousLeagues);
      jsonRes(req, res, 200, { ok: true });
    });
    return;
  }

  /* State of Origin scores API */

  if (url === '/api/soo/scores' && req.method === 'GET') {
    jsonRes(req, res, 200, sooScores);
    return;
  }

  if (url === '/api/soo/scores' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return bodyError(req, res, err);
      const user = authUser(req, body);
      if (!isAdmin(user)) return jsonRes(req, res, 403, {error: 'Admin access required'});
      const game = parseInt(body.game);
      if (![1,2,3].includes(game) || !body.scores || typeof body.scores !== 'object') return jsonRes(req, res, 400, {error: 'valid game and scores required'});
      Object.entries(body.scores).forEach(([pid, pts]) => {
        const playerId = Number(pid), points = Number(pts);
        if (Number.isSafeInteger(playerId) && Number.isFinite(points) && points >= 0 && points <= 300) sooScores[game + ':' + playerId] = points;
      });
      await saveScores();
      jsonRes(req, res, 200, {ok: true, stored: Object.keys(body.scores).length});
    });
    return;
  }

  if (url === '/api/soo/scores' && req.method === 'DELETE') {
    const user = authUser(req, {});
    if (!isAdmin(user)) return jsonRes(req, res, 403, {error: 'Admin access required'});
    const gameMatch = new URL(req.url, APP_URL).searchParams.get('game');
    if (gameMatch) {
      const g = String(Number(gameMatch));
      if (!['1','2','3'].includes(g)) return jsonRes(req, res, 400, {error: 'Invalid game'});
      Object.keys(sooScores).forEach(k => { if(k.startsWith(g+':')) delete sooScores[k]; });
    } else {
      sooScores = {};
    }
    await saveScores();
    jsonRes(req, res, 200, {ok: true});
    return;
  }

  if (url === '/soo') {
    res.writeHead(302, Object.assign({}, securityHeaders('text/plain; charset=utf-8'), { 'Location': '/?soo=1' }));
    res.end();
    return;
  }

  if (url.startsWith('/api/')) {
    jsonRes(req, res, 404, {error: 'API route not found'});
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    jsonRes(req, res, 405, {error: 'Method not allowed'}, {'Allow': 'GET, HEAD'});
    return;
  }

  /* App shell */
  var file = path.join(__dirname, 'index.html');
  fs.readFile(file, function(err, data) {
    if (err) { textRes(res, 500, 'error'); return; }
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'ETag': contentEtag(data)
    };
    if (req.method === 'HEAD') {
      if (String(req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(headers.ETag)) {
        res.writeHead(304, Object.assign({}, securityHeaders(headers['Content-Type']), headers)); res.end(); return;
      }
      res.writeHead(200, Object.assign({}, securityHeaders(headers['Content-Type']), headers)); res.end(); return;
    }
    compressedRes(req, res, 200, data, headers);
  });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch(error => requestError(req, res, error));
});
server.requestTimeout = 15000;
server.headersTimeout = 20000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required in production; JSON storage is development-only');
  database = createDatabase({connectionString: process.env.DATABASE_URL, dataDir: DATA_DIR});
  if (database) {
    await database.migrate();
    const loaded = await database.load();
    users = loaded.users; leagues = loaded.leagues; sooScores = loaded.scores; tokens = {};
    Object.values(users).forEach(user => {
      user.sessions = (user.sessions || []).filter(session => session.expires >= Date.now());
      user.sessions.forEach(session => { tokens[session.hash] = user.email; });
    });
  }
  storageReady = true;
  server.listen(PORT, function() { console.log('NRL Fantasy on :' + PORT + ' using ' + (database ? 'PostgreSQL' : 'local JSON')); });
}

start().catch(error => { console.error('[startup]', error); process.exitCode = 1; });

async function shutdown() {
  storageReady = false;
  server.close(async () => { if (database) await database.close().catch(() => {}); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
