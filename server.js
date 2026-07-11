/* Static server + NRL Fantasy data proxy â€” Railway compatible */
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const {createDatabase} = require('./db');
const PORT     = process.env.PORT || 3000;
const APP_URL  = (process.env.APP_URL || 'https://nrl.the-squad.com.au').replace(/\/$/, '');
const FROM_EMAIL = process.env.FROM_EMAIL || 'NRL Fantasy <noreply@the-squad.com.au>';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const ALLOWED_ORIGIN = new URL(APP_URL).origin;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.NODE_ENV === 'production' || APP_URL.startsWith('https://');
const BODY_LIMIT = 100000;
const rateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.reset <= now) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

/* â”€â”€ Email via Resend API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
    if (!RESEND_KEY) {
      console.log('[email] RESEND_API_KEY not set â€” skipping:', subject, 'â†’', to);
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
        if (r.statusCode >= 200 && r.statusCode < 300) console.log('[email] accepted:', subject, 'â†’', to, result.id || 'ok');
        else console.error('[email] rejected:', r.statusCode, subject, 'â†’', to);
        resolve();
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('email timeout')));
    req.on('error', e => { console.error('[email] error:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

/* â”€â”€ Data storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEAGUE_FILE = path.join(DATA_DIR, 'soo-leagues.json');
const USERS_FILE  = path.join(DATA_DIR, 'soo-users.json');
const SCORES_FILE = path.join(DATA_DIR, 'soo-scores.json');
let leagues = {};
let users   = {};  /* keyed by email (lowercase) */
let tokens  = {};  /* token â†’ email */
/* sooScores: { "gameNum:playerId": points }  e.g. { "3:1234": 87 } */
let sooScores = {};
let database = null;
let storageReady = false;

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
try { leagues = JSON.parse(fs.readFileSync(LEAGUE_FILE, 'utf8')); } catch(e) {}
try { sooScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  Object.values(users).forEach(u => { if(u.tokenHash) tokens[u.tokenHash] = u.email; else if(u.token) tokens[u.token] = u.email; });
} catch(e) {}

function atomicSave(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
async function saveLeagues() { if (database) return database.saveLeagues(leagues); try { atomicSave(LEAGUE_FILE, leagues); } catch(e) { console.error('[storage] leagues:', e.message); throw e; } }
async function saveUsers()   { if (database) return database.saveUsers(users); try { atomicSave(USERS_FILE, users); } catch(e) { console.error('[storage] users:', e.message); throw e; } }
async function saveScores()  { if (database) return database.saveScores(sooScores); try { atomicSave(SCORES_FILE, sooScores); } catch(e) { console.error('[storage] scores:', e.message); throw e; } }

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

function readBody(req, cb) {
  let body = '';
  let tooLarge = false;
  req.on('data', d => { body += d; if (body.length > BODY_LIMIT) tooLarge = true; });
  req.on('end', () => {
    if (tooLarge) return cb(Object.assign(new Error('Payload too large'), {status: 413}));
    try { cb(null, body ? JSON.parse(body) : {}); } catch(e) { cb(e); }
  });
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

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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
  const out = {};
  for (const [game, picks] of Object.entries(value).slice(0, 3)) {
    if (!/^[123]$/.test(game) || !picks || typeof picks !== 'object' || Array.isArray(picks)) continue;
    out[game] = {};
    for (const [position, playerId] of Object.entries(picks).slice(0, 20)) {
      if (/^[A-Z0-9_-]{1,12}$/i.test(position) && Number.isSafeInteger(Number(playerId))) out[game][position] = Number(playerId);
    }
  }
  return out;
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

/* Resolve user from token (body.token or Authorization header) */
function authUser(req, body) {
  const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const tok = parseCookies(req).session || hdr || (body && body.token) || '';
  const hash = tokenHash(tok);
  const email = tokens[hash] || tokens[tok];
  const user = email ? users[email] : null;
  if (!user) return null;
  if (user.tokenExpires && user.tokenExpires < Date.now()) {
    delete tokens[hash]; delete tokens[tok]; delete user.token; delete user.tokenHash; delete user.tokenExpires; saveUsers().catch(e => console.error('[storage] expired session:', e.message)); return null;
  }
  return user;
}

function issueSession(user) {
  const token = genToken();
  if (user.token) delete tokens[user.token];
  if (user.tokenHash) delete tokens[user.tokenHash];
  delete user.token;
  user.tokenHash = tokenHash(token);
  user.tokenExpires = Date.now() + SESSION_TTL_MS;
  tokens[user.tokenHash] = user.email;
  return {token, cookie: 'session=' + encodeURIComponent(token) + '; Path=/; HttpOnly' + (COOKIE_SECURE ? '; Secure' : '') + '; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)};
}

function publicUser(user) {
  return {userId: user.userId, name: user.name, email: user.email, leagueCode: user.leagueCode || null,
    teamId: user.teamId || null, isAdmin: isAdmin(user)};
}

/* â”€â”€ Static file helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function serveLocal(req, res, filePath) {
  fs.readFile(filePath, function(err, data) {
    if (err) return proxyNRL(req, res, path.basename(filePath).replace('.json', '') === 'players'
      ? 'players.json' : 'rounds.json');
    compressedRes(req, res, 200, data, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'ETag': '"' + crypto.createHash('sha256').update(data).digest('base64url').slice(0, 24) + '"'
    });
  });
}

function proxyNRL(req, res, nrlPath) {
  const opts = {
    hostname: 'fantasy.nrl.com',
    path: '/data/nrl/' + nrlPath,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://fantasy.nrl.com/',
      'Origin': 'https://fantasy.nrl.com'
    }
  };
  const upstreamReq = https.request(opts, function(upstream) {
    res.writeHead(upstream.statusCode, Object.assign({}, securityHeaders('application/json; charset=utf-8'), corsHeaders(req), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60'
    }));
    upstream.pipe(res);
  });
  upstreamReq.on('error', function(e) {
    res.writeHead(502);
    res.end(JSON.stringify({error: 'proxy error', detail: e.message}));
  });
  upstreamReq.setTimeout(10000, () => upstreamReq.destroy(new Error('upstream timeout')));
  upstreamReq.end();
}

/* â”€â”€ HTTP server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const server = http.createServer(async function(req, res) {
  req.id = crypto.randomUUID();
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

  if (url === '/api/players') return serveLocal(req, res, path.join(__dirname, 'public/players.json'));
  if (url === '/api/rounds')  return serveLocal(req, res, path.join(__dirname, 'public/rounds.json'));

  /* â”€â”€ Auth â”€â”€ */

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
      if (users[email])
        return jsonRes(req, res, 409, {error: 'Email already registered'});
      const salt   = crypto.randomBytes(16).toString('hex');
      const token  = genToken();
      const userId = genCode(10);
      users[email] = { userId, name: safeName(name, 'Player', 40), email, salt, iterations: 310000, hash: await hashPwd(pass, salt, 310000) };
      const session = issueSession(users[email]);
      await saveUsers();
      jsonRes(req, res, 201, publicUser(users[email]), {'Set-Cookie': session.cookie});
      /* Welcome email (async â€” don't block response) */
      sendEmail(email, 'Welcome to NRL Fantasy! ðŸ‰', `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy ðŸ‰</h2>
          <p>Hey ${escapeHtml(users[email].name)},</p>
          <p>You're all set! Head back to the app to pick your State of Origin team and compete with mates.</p>
          <a href="${APP_URL}" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Go to NRL Fantasy</a>
          <p style="color:#888;font-size:12px;margin-top:24px">Unofficial fan-made game Â· Not affiliated with the NRL</p>
        </div>
      `).catch(() => {});
    });
    return;
  }

  if (url === '/api/soo/login' && req.method === 'POST') {
    if (rateLimit(req, res, 'login', 10, 15 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, 400, {error: 'Bad request'});
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
      if (err) return jsonRes(req, res, 400, {error: 'Bad request'});
      const email = (body.email||'').trim().toLowerCase();
      /* Always 200 â€” never reveal whether an email is registered */
      jsonRes(req, res, 200, {ok: true});
      const user = users[email];
      if (!user) return;
      const tok = genToken();
      user.resetTokenHash = tokenHash(tok);
      user.resetExpires = Date.now() + 3600000;
      await saveUsers();
      const link = APP_URL + '/?resetToken=' + tok;
      await sendEmail(email, 'Reset your NRL Fantasy password', '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy ðŸ‰</h2><p>Hi ' + user.name + ',</p><p>Someone requested a password reset for your account. Click below to set a new password â€” this link expires in <strong>1 hour</strong>.</p><a href="' + link + '" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Reset Password</a><p style="color:#888;font-size:12px">If you did not request this, you can safely ignore this email.</p><p style="color:#888;font-size:11px;word-break:break-all">Or copy this link: ' + link + '</p></div>').catch(() => {});
    });
    return;
  }

  /* POST /api/soo/reset-password { token, password } */
  if (url === '/api/soo/reset-password' && req.method === 'POST') {
    if (rateLimit(req, res, 'reset', 10, 60 * 60 * 1000)) return;
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, 400, {error: 'Bad request'});
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
      if (user.token) delete tokens[user.token];
      if (user.tokenHash) delete tokens[user.tokenHash];
      delete user.token; delete user.tokenHash; delete user.tokenExpires; saveUsers().catch(e => console.error('[storage] logout:', e.message));
    }
    jsonRes(req, res, 200, {ok: true}, {'Set-Cookie': 'session=; Path=/; HttpOnly' + (COOKIE_SECURE ? '; Secure' : '') + '; SameSite=Lax; Max-Age=0'});
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

  /* â”€â”€ League API (all require auth) â”€â”€ */

  /* POST /api/soo/create  { name, teamName, picks, token } */
  if (url === '/api/soo/create' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, 400, {error: 'bad json'});
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const code   = genCode(6);
      const teamId = genCode(10);
      leagues[code] = {
        name: safeName(body.name, 'SoO League', 40),
        ownerId: user.userId,
        created: Date.now(),
        teams: [{
          id: teamId,
          userId: user.userId,
          name: safeName(body.teamName || user.name, 'My Team', 30),
          picks: cleanPicks(body.picks)
        }]
      };
      user.leagueCode = code; user.teamId = teamId; await saveUsers();
      await saveLeagues();
      jsonRes(req, res, 200, { code, teamId });
    });
    return;
  }

  /* POST /api/soo/join  { code, teamName, picks, token } */
  if (url === '/api/soo/join' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, 400, {error: 'bad json'});
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const code = String(body.code || '').trim().toUpperCase();
      const lg = leagues[code];
      if (!lg) return jsonRes(req, res, 404, {error: 'League not found'});
      if (lg.teams.length >= 30) return jsonRes(req, res, 400, {error: 'League full'});
      const existing = lg.teams.find(t => t.userId === user.userId);
      if (existing) return jsonRes(req, res, 409, {error: 'You already have a team in this league', teamId: existing.id, league: {name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId}});
      const teamId = genCode(10);
      lg.teams.push({
        id: teamId,
        userId: user.userId,
        name: safeName(body.teamName || user.name, 'New Team', 30),
        picks: cleanPicks(body.picks)
      });
      user.leagueCode = code; user.teamId = teamId; await saveUsers();
      await saveLeagues();
      jsonRes(req, res, 200, { teamId, league: { name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId } });
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
      if (err) return jsonRes(req, res, 400, {error: 'bad json'});
      const lg = leagues[leaguePicks[1]];
      if (!lg) return jsonRes(req, res, 404, {error: 'Not found'});
      const user = authUser(req, body);
      if (!user) return jsonRes(req, res, 401, {error: 'Login required'});
      const team = lg.teams.find(t => t.id === body.teamId);
      if (!team) return jsonRes(req, res, 404, {error: 'Team not found'});
      if (team.userId !== user.userId) return jsonRes(req, res, 403, {error: 'You can only update your own team'});
      team.picks = cleanPicks(body.picks);
      if (body.teamName) team.name = safeName(body.teamName, team.name, 30);
      await saveLeagues();
      jsonRes(req, res, 200, { ok: true });
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
      lg.teams = lg.teams.filter(t => t.id !== teamDel[2]);
      if (lg.teams.length === before) return jsonRes(req, res, 404, {error: 'Team not found'});
      const removedUser = Object.values(users).find(u => removed && u.userId === removed.userId);
      if (removedUser) { delete removedUser.leagueCode; delete removedUser.teamId; await saveUsers(); }
      await saveLeagues();
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
      delete leagues[leagueDel[1]];
      Object.values(users).forEach(u => { if (u.leagueCode === leagueDel[1]) { delete u.leagueCode; delete u.teamId; } });
      await saveUsers();
      await saveLeagues();
      jsonRes(req, res, 200, { ok: true });
    });
    return;
  }

  /* â”€â”€ SoO Scores API â”€â”€ */

  if (url === '/api/soo/scores' && req.method === 'GET') {
    jsonRes(req, res, 200, sooScores);
    return;
  }

  if (url === '/api/soo/scores' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return jsonRes(req, res, 400, {error: 'bad json'});
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
    if (req.method === 'HEAD') {
      res.writeHead(200, Object.assign({}, securityHeaders('text/html; charset=utf-8'), {'Cache-Control': 'no-cache'})); res.end(); return;
    }
    compressedRes(req, res, 200, data, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
  });
});

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required in production; JSON storage is development-only');
  database = createDatabase({connectionString: process.env.DATABASE_URL, dataDir: DATA_DIR});
  if (database) {
    await database.migrate();
    const loaded = await database.load();
    users = loaded.users; leagues = loaded.leagues; sooScores = loaded.scores; tokens = {};
    Object.values(users).forEach(user => { if (user.tokenHash) tokens[user.tokenHash] = user.email; });
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
