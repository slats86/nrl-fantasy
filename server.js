/* Static server + NRL Fantasy data proxy — Railway compatible */
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const {createDatabase} = require('./db');
const {validateFeed} = require('./live-data');
const {freshness: teamNewsFreshness} = require('./lib/team-news');
const {
  parseInitialPlayerId, hasSeasonStats, searchQueryVariants, searchPlayerSelection, findSearchPlayerPath,
  hasCompleteSeasonDetails, payloadMatchesPlayer, mergeHistoricalPlayerStats, buildOfficialPayload
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
const MAX_FANTASY_LEAGUES = Math.max(1, Math.min(100, Number(process.env.MAX_FANTASY_LEAGUES_PER_USER) || 20));
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
const FANTASY_LEAGUE_FILE = path.join(DATA_DIR, 'fantasy-leagues.json');
const USERS_FILE  = path.join(DATA_DIR, 'soo-users.json');
const SCORES_FILE = path.join(DATA_DIR, 'soo-scores.json');
let leagues = {};
let fantasyLeagues = {};
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
try { fantasyLeagues = JSON.parse(fs.readFileSync(FANTASY_LEAGUE_FILE, 'utf8')); } catch(e) {}
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
async function persistFantasyLeagues(snapshot) {
  if (database) return database.saveFantasyLeagues(snapshot);
  atomicSave(FANTASY_LEAGUE_FILE, snapshot);
}
async function mutateFantasyLeagues(operation) {
  return queuedStorage(async () => {
    const previous=structuredClone(fantasyLeagues);
    try { const result=await operation(fantasyLeagues);await persistFantasyLeagues(structuredClone(fantasyLeagues));return result; }
    catch(error){fantasyLeagues=previous;throw error;}
  });
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
async function saveCompleteAccountStateOrRollback(previousUsers,previousLeagues,previousFantasyLeagues){
  try{return await queuedStorage(async()=>{if(database)return database.saveCompleteAccountState(structuredClone(users),structuredClone(leagues),structuredClone(fantasyLeagues));atomicSave(LEAGUE_FILE,structuredClone(leagues));atomicSave(USERS_FILE,structuredClone(users));atomicSave(FANTASY_LEAGUE_FILE,structuredClone(fantasyLeagues))})}
  catch(error){users=previousUsers;leagues=previousLeagues;fantasyLeagues=previousFantasyLeagues;rebuildTokenIndex();throw error}
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

const APP_STATE_KEYS = new Set(['classic','customLeague','customLeagues','league','draft','draftLeagues','activeCustomLeagueId','activeDraftLeagueId','settings','watchlist','teamNewsPrefs','corrections','origin','priceHistory','round','season']);
function cleanAppState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const clean = {};
  const records = new Set(['classic','customLeague','customLeagues','league','draft','draftLeagues','settings','teamNewsPrefs','corrections','origin','priceHistory','season']);
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
    if(key==='customLeagues'||key==='draftLeagues'){
      if(!Array.isArray(item)||item.length>100||item.some(entry=>!entry||typeof entry!=='object'||Array.isArray(entry)))return null;
      clean[key]=item;continue;
    }
    if(key==='activeCustomLeagueId'||key==='activeDraftLeagueId'){
      if(item!==null&&typeof item!=='string')return null;clean[key]=item==null?null:String(item).slice(0,40);continue;
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
function fantasyError(status,message,extra={}){return Object.assign(new Error(message),{status,public:extra})}
function optionalFantasyTimestamp(value){
  if(value===null||value===''||value===undefined)return null;
  const timestamp=+new Date(value);
  if(!Number.isFinite(timestamp))throw fantasyError(400,'Invalid invitation expiry');
  return timestamp;
}
function cleanLeagueState(value){
  if(value==null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw fantasyError(400,'Invalid league state');
  const serialized=JSON.stringify(value);if(serialized.length>500000)throw fantasyError(413,'League state is too large');
  return JSON.parse(serialized);
}
function fantasyMembership(league,userId){return (league.members||[]).find(member=>member.userId===userId&&member.active!==false)}
function fantasyTeam(league,userId){return (league.teams||[]).find(team=>team.userId===userId)}
function fantasySummary(league,user){
  const membership=fantasyMembership(league,user.userId),team=fantasyTeam(league,user.userId);
  return {id:league.id,code:league.code,format:league.format,name:league.name,role:membership&&membership.role,memberCount:(league.members||[]).filter(member=>member.active!==false).length,maxMembers:league.maxMembers,status:league.status,teamId:team&&team.id,teamName:team&&team.name,teamVersion:team&&team.version,draftVersion:league.draftVersion,created:league.created,updated:league.updated};
}
function fantasyDetail(league,user){
  const summary=fantasySummary(league,user),ownTeam=fantasyTeam(league,user.userId);
  return {...summary,rules:league.rules||{},draftState:league.format==='draft'?league.draftState:null,draftPicks:league.format==='draft'?(league.draftPicks||[]):[],team:ownTeam?{...ownTeam,state:ownTeam.state||{}}:null,members:(league.members||[]).filter(member=>member.active!==false).map(member=>{const account=Object.values(users).find(value=>value.userId===member.userId),team=fantasyTeam(league,member.userId);return {id:member.id,userId:member.userId,name:account&&account.name||'Member',role:member.role,team:team?{id:team.id,name:team.name,version:team.version}:null}}),fixtures:league.fixtures||[],scores:league.scores||[],inviteExpiresAt:league.inviteExpiresAt};
}
function uniqueFantasyCode(){let code;do{code=genCode(8)}while(Object.values(fantasyLeagues).some(league=>league.code===code));return code}
function fantasyId(prefix){return prefix+genCode(14)}
function requestKey(body){const value=String(body.requestId||'').trim();if(value&&!/^[a-zA-Z0-9_.:-]{8,80}$/.test(value))throw fantasyError(400,'Invalid request ID');return value||null}
function legacyFantasyId(format,identity){return 'FL'+crypto.createHash('sha256').update(format+'|'+identity).digest('hex').slice(0,22).toUpperCase()}
function migrateJsonFantasyLeagues(){
  let changed=false;
  const ownsLegacy=account=>['customLeague','draft'].some(key=>account.appState&&account.appState[key]&&account.appState[key].league&&account.appState[key].league.isOwner===true);
  const accounts=Object.values(users).sort((a,b)=>Number(ownsLegacy(b))-Number(ownsLegacy(a)));
  for(const account of accounts)for(const format of ['custom','draft']){
    const legacy=account.appState&&(format==='custom'?account.appState.customLeague:account.appState.draft);if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))continue;
    const embedded=String(legacy.league&&legacy.league.code||legacy.code||'').toUpperCase(),identity=/^[A-Z2-9]{6,12}$/.test(embedded)?embedded:account.userId+'|'+(legacy.created||legacy.name||'legacy'),id=legacyFantasyId(format,identity);
    let league=fantasyLeagues[id];
    if(!league){const now=Number(legacy.created)||Date.now(),membershipId='FM'+genCode(14),teamId='FT'+genCode(14);let code=/^[A-Z2-9]{6,12}$/.test(embedded)?embedded:uniqueFantasyCode();if(Object.values(fantasyLeagues).some(item=>item.id!==id&&item.code===code))code=uniqueFantasyCode();league={id,code,format,name:safeName(legacy.name||legacy.league&&legacy.league.name,`Legacy ${format} league`,80),ownerId:account.userId,rules:format==='custom'?(legacy.settings||{}):{},draftState:format==='draft'?legacy:null,draftVersion:0,maxMembers:Number(legacy.league&&legacy.league.size)||20,status:'active',created:now,updated:now,members:[{id:membershipId,userId:account.userId,role:'owner',joined:now,active:true}],teams:[{id:teamId,membershipId,userId:account.userId,name:safeName(legacy.team&&legacy.team.name||account.name,'My Team',60),state:format==='custom'?legacy:{legacyDraft:legacy},version:0,created:now,updated:now}],draftPicks:[],fixtures:[],scores:[]};fantasyLeagues[id]=league;changed=true;continue}
    if(legacy.league&&legacy.league.isOwner===true&&league.ownerId!==account.userId){(league.members||[]).forEach(member=>{member.role='member'});league.ownerId=account.userId;changed=true}
    if(!fantasyMembership(league,account.userId)){const membershipId='FM'+genCode(14),teamId='FT'+genCode(14),now=Date.now();league.members.push({id:membershipId,userId:account.userId,role:league.ownerId===account.userId?'owner':'member',joined:now,active:true});league.teams.push({id:teamId,membershipId,userId:account.userId,name:safeName(legacy.team&&legacy.team.name||account.name,'My Team',60),state:format==='custom'?legacy:{legacyDraft:legacy},version:0,created:now,updated:now});changed=true}
  }
  return changed;
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

function serveTeamNews(req,res){
  fs.readFile(path.join(__dirname,'public','team-news.json'),(error,buffer)=>{
    if(error)return jsonRes(req,res,503,{error:'Team News is temporarily unavailable',freshness:'source-unavailable'});
    try{
      const data=JSON.parse(buffer.toString('utf8'));data.freshness=teamNewsFreshness(data.checkedAt,data.sourceAvailable!==false);
      const body=Buffer.from(JSON.stringify(data)),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache, max-age=0, must-revalidate','ETag':contentEtag(body),'X-Team-News-Freshness':data.freshness};
      if(req.method==='HEAD'){res.writeHead(200,Object.assign({},securityHeaders(headers['Content-Type']),headers));res.end();return}
      compressedRes(req,res,200,body,headers);
    }catch(parseError){jsonRes(req,res,503,{error:'Team News snapshot is invalid',freshness:'source-unavailable'})}
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
    let payload = null, resolvedPayload = null;
    let fallbackReason = '';
    try {
      payload = await footyStatisticsPayload(resolvedId);
      resolvedPayload = payload;
    } catch (error) {
      console.warn('[footystatistics-proxy] resolved payload failed:', error.message);
      fallbackReason = 'upstream-failure';
    }
    if (payload && !payloadMatchesPlayer(payload, {
      name: player.first_name + ' ' + player.last_name, slug, squadId: player.squad_id, positions: player.positions
    })) { fallbackReason = 'identity-mismatch'; resolvedPayload = null; }
    else if (payload && !hasCompleteSeasonDetails(payload, year, player.stats && player.stats.scores))
      fallbackReason = 'incomplete-details';
    if (!payload || fallbackReason) {
      const officialPayload = await officialNrlPayload(playerId, resolvedId, year);
      payload = mergeHistoricalPlayerStats(officialPayload, resolvedPayload, year);
    } else payload = mergeHistoricalPlayerStats(payload, payload, year);
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
    jsonRes(req, res, 204, {}, {'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key'}); return;
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
  if (url === '/api/team-news' && (req.method === 'GET' || req.method === 'HEAD')) return serveTeamNews(req,res);
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

      const previousUsers = structuredClone(users), previousLeagues = structuredClone(leagues), previousFantasyLeagues=structuredClone(fantasyLeagues);
      for (const [code, league] of Object.entries(leagues)) {
        league.teams = (league.teams || []).filter(team => team.userId !== user.userId);
        if (league.ownerId === user.userId) {
          if (league.teams.length) league.ownerId = league.teams[0].userId;
          else delete leagues[code];
        }
      }
      for(const league of Object.values(fantasyLeagues)){
        const removedTeam=fantasyTeam(league,user.userId);
        if(league.format==='draft'&&league.draftState){const participants=league.draftState.league&&league.draftState.league.participants,slot=Array.isArray(participants)?participants.findIndex(item=>item&&item.userId===user.userId):-1;if(slot>=0)participants[slot]={name:'Open slot',isMe:false,isAI:false,isEmpty:true};}
        league.members=(league.members||[]).filter(member=>member.userId!==user.userId);
        league.teams=(league.teams||[]).filter(team=>team.userId!==user.userId);
        if(removedTeam)league.draftPicks=(league.draftPicks||[]).filter(pick=>pick.teamId!==removedTeam.id);
        if(league.ownerId===user.userId){
          const successor=(league.members||[]).find(member=>member.active!==false);
          if(successor){successor.role='owner';league.ownerId=successor.userId;league.updated=Date.now()}
          else delete fantasyLeagues[league.id];
        }
      }
      revokeAllSessions(user);
      delete users[user.email];
      await saveCompleteAccountStateOrRollback(previousUsers,previousLeagues,previousFantasyLeagues);
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

  /* Multi Custom/Draft League API. All resources are scoped by immutable league ID. */
  if(url==='/api/fantasy-leagues'&&req.method==='GET'){
    const user=authUser(req,{});if(!user)return jsonRes(req,res,401,{error:'Login required'});
    const items=Object.values(fantasyLeagues).filter(league=>fantasyMembership(league,user.userId)).map(league=>fantasySummary(league,user)).sort((a,b)=>b.updated-a.updated);
    return jsonRes(req,res,200,{leagues:items,limit:MAX_FANTASY_LEAGUES});
  }
  if(url==='/api/fantasy-leagues'&&req.method==='POST'){
    readBody(req,async(err,body)=>{
      if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{
        const result=await mutateFantasyLeagues(async all=>{
          const format=String(body.format||'');if(!['custom','draft'].includes(format))throw fantasyError(400,'Format must be custom or draft');
          const key=requestKey(body),existing=key&&Object.values(all).find(league=>league.ownerId===user.userId&&league.createKey===key);
          if(existing)return {league:fantasyDetail(existing,user),idempotent:true};
          const joined=Object.values(all).filter(league=>fantasyMembership(league,user.userId)).length;if(joined>=MAX_FANTASY_LEAGUES)throw fantasyError(409,`League limit reached (${MAX_FANTASY_LEAGUES})`,{limit:MAX_FANTASY_LEAGUES});
          const now=Date.now(),id=fantasyId('FL'),membershipId=fantasyId('FM'),teamId=fantasyId('FT'),maxMembers=Math.max(2,Math.min(30,Number(body.maxMembers)||20));
          const draftState=format==='draft'?cleanLeagueState(body.draftState||{}):null;
          if(draftState&&Array.isArray(draftState.league&&draftState.league.participants)){let ownerSlot=draftState.league.participants.findIndex(item=>item&&item.isMe);if(ownerSlot<0)ownerSlot=0;draftState.league.participants=draftState.league.participants.map((item,index)=>({...item,isMe:false,...(index===ownerSlot?{userId:user.userId,name:safeName(body.teamName||user.name,'My Team',60),isAI:false,isEmpty:false}:{})}));draftState.me=ownerSlot;}
          const league={id,code:uniqueFantasyCode(),format,name:safeName(body.name,format==='custom'?'Custom League':'Draft League',80),ownerId:user.userId,rules:cleanLeagueState(body.rules||{}),draftState,draftVersion:0,maxMembers,inviteExpiresAt:optionalFantasyTimestamp(body.inviteExpiresAt),status:'active',createKey:key,created:now,updated:now,members:[{id:membershipId,userId:user.userId,role:'owner',joined:now,active:true}],teams:[{id:teamId,membershipId,userId:user.userId,name:safeName(body.teamName||user.name,'My Team',60),state:cleanLeagueState(body.teamState||{}),version:0,created:now,updated:now}],draftPicks:[],fixtures:[],scores:[]};
          all[id]=league;return {league:fantasyDetail(league,user),idempotent:false};
        });
        jsonRes(req,res,result.idempotent?200:201,result);
      }catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    },1000000);return;
  }
  if(url==='/api/fantasy-leagues/join'&&req.method==='POST'){
    readBody(req,async(err,body)=>{
      if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{
        const result=await mutateFantasyLeagues(async all=>{
          const code=String(body.code||'').trim().toUpperCase();if(!/^[A-Z2-9]{6,12}$/.test(code))throw fantasyError(400,'Invalid league code');
          const league=Object.values(all).find(item=>item.code===code);if(!league)throw fantasyError(404,'League not found');
          if(body.format&&body.format!==league.format)throw fantasyError(409,`This invitation is for a ${league.format} league`,{format:league.format});
          if(league.status!=='active')throw fantasyError(410,'League is inactive');if(league.inviteExpiresAt&&league.inviteExpiresAt<Date.now())throw fantasyError(410,'Invitation has expired');
          const existing=fantasyMembership(league,user.userId),key=requestKey(body);if(existing){if(key&&existing.joinKey===key)return {league:fantasyDetail(league,user),idempotent:true};throw fantasyError(409,'You already belong to this league',{leagueId:league.id});}
          const joined=Object.values(all).filter(item=>fantasyMembership(item,user.userId)).length;if(joined>=MAX_FANTASY_LEAGUES)throw fantasyError(409,`League limit reached (${MAX_FANTASY_LEAGUES})`,{limit:MAX_FANTASY_LEAGUES});
          if(league.members.filter(member=>member.active!==false).length>=league.maxMembers)throw fantasyError(409,'League is full');
          const now=Date.now(),membershipId=fantasyId('FM'),teamId=fantasyId('FT'),teamName=safeName(body.teamName||user.name,'My Team',60);
          if(league.format==='draft'&&league.draftState){if(league.draftState.phase&&league.draftState.phase!=='lobby')throw fantasyError(409,'This Draft league is already in progress');const participants=league.draftState.league&&league.draftState.league.participants;if(Array.isArray(participants)){let slot=participants.findIndex(item=>item&&(item.isEmpty||item.isAI));if(slot<0&&participants.length<league.maxMembers){slot=participants.length;participants.push({})}if(slot<0)throw fantasyError(409,'Draft lobby has no open slot');participants[slot]={name:teamName,userId:user.userId,isMe:false,isAI:false,isEmpty:false};league.draftVersion++;}}
          league.members.push({id:membershipId,userId:user.userId,role:'member',joinKey:key,joined:now,active:true});league.teams.push({id:teamId,membershipId,userId:user.userId,name:teamName,state:cleanLeagueState(body.teamState||{}),version:0,created:now,updated:now});league.updated=now;return {league:fantasyDetail(league,user),idempotent:false};
        });jsonRes(req,res,result.idempotent?200:201,result);
      }catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    },1000000);return;
  }
  const fantasyRoute=url.match(/^\/api\/fantasy-leagues\/([A-Z0-9]+)$/);
  if(fantasyRoute&&req.method==='GET'){
    const user=authUser(req,{});if(!user)return jsonRes(req,res,401,{error:'Login required'});const league=fantasyLeagues[fantasyRoute[1]];if(!league)return jsonRes(req,res,404,{error:'League not found'});if(!fantasyMembership(league,user.userId))return jsonRes(req,res,403,{error:'League membership required'});return jsonRes(req,res,200,{league:fantasyDetail(league,user)});
  }
  if(fantasyRoute&&req.method==='PATCH'){
    readBody(req,async(err,body)=>{if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{const result=await mutateFantasyLeagues(async all=>{const league=all[fantasyRoute[1]];if(!league)throw fantasyError(404,'League not found');if(league.ownerId!==user.userId)throw fantasyError(403,'Only the league owner can manage this league');if(body.name)league.name=safeName(body.name,league.name,80);if(body.rules)league.rules=cleanLeagueState(body.rules);if(body.status&&['active','inactive'].includes(body.status))league.status=body.status;if(body.inviteExpiresAt!==undefined)league.inviteExpiresAt=optionalFantasyTimestamp(body.inviteExpiresAt);if(body.transferOwnerId){const next=fantasyMembership(league,String(body.transferOwnerId));if(!next)throw fantasyError(400,'New owner must be an active member');const current=fantasyMembership(league,user.userId);current.role='member';next.role='owner';league.ownerId=next.userId;}league.updated=Date.now();return fantasyDetail(league,user)});jsonRes(req,res,200,{league:result});}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    });return;
  }
  const fantasyTeamRoute=url.match(/^\/api\/fantasy-leagues\/([A-Z0-9]+)\/team$/);
  if(fantasyTeamRoute&&req.method==='PUT'){
    readBody(req,async(err,body)=>{if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{const result=await mutateFantasyLeagues(async all=>{const league=all[fantasyTeamRoute[1]];if(!league)throw fantasyError(404,'League not found');if(!fantasyMembership(league,user.userId))throw fantasyError(403,'League membership required');const team=fantasyTeam(league,user.userId);if(!team)throw fantasyError(404,'Team not found');const baseVersion=Number(body.baseVersion);if(!Number.isSafeInteger(baseVersion)||baseVersion<0)throw fantasyError(428,'A valid baseVersion is required',{version:team.version});if(baseVersion!==team.version)throw fantasyError(409,'Team changed on another device',{version:team.version,team:{...team,state:team.state||{}}});team.state=cleanLeagueState(body.state);if(body.teamName)team.name=safeName(body.teamName,team.name,60);team.version++;team.updated=Date.now();league.updated=team.updated;return {version:team.version,updatedAt:team.updated}});jsonRes(req,res,200,{ok:true,...result});}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    },1000000);return;
  }
  const fantasyDraftRoute=url.match(/^\/api\/fantasy-leagues\/([A-Z0-9]+)\/draft$/);
  if(fantasyDraftRoute&&req.method==='PUT'){
    readBody(req,async(err,body)=>{if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{const result=await mutateFantasyLeagues(async all=>{const league=all[fantasyDraftRoute[1]];if(!league)throw fantasyError(404,'League not found');if(league.format!=='draft')throw fantasyError(409,'Not a Draft league');if(league.ownerId!==user.userId)throw fantasyError(403,'Only the league owner can update Draft state');const base=Number(body.baseVersion);if(!Number.isSafeInteger(base)||base<0)throw fantasyError(428,'A valid baseVersion is required',{version:league.draftVersion});if(base!==league.draftVersion)throw fantasyError(409,'Draft changed on another device',{version:league.draftVersion,draftState:league.draftState});league.draftState=cleanLeagueState(body.state);league.draftVersion++;league.updated=Date.now();return {version:league.draftVersion}});jsonRes(req,res,200,{ok:true,...result});}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    },1000000);return;
  }
  const fantasyPickRoute=url.match(/^\/api\/fantasy-leagues\/([A-Z0-9]+)\/draft\/picks$/);
  if(fantasyPickRoute&&req.method==='POST'){
    readBody(req,async(err,body)=>{if(err)return bodyError(req,res,err);const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{const result=await mutateFantasyLeagues(async all=>{const league=all[fantasyPickRoute[1]];if(!league)throw fantasyError(404,'League not found');if(league.format!=='draft')throw fantasyError(409,'Not a Draft league');if(!fantasyMembership(league,user.userId))throw fantasyError(403,'League membership required');const base=Number(body.baseVersion);if(!Number.isSafeInteger(base)||base<0)throw fantasyError(428,'A valid baseVersion is required',{version:league.draftVersion});if(base!==league.draftVersion)throw fantasyError(409,'Draft changed on another device',{version:league.draftVersion,draftState:league.draftState});const team=fantasyTeam(league,user.userId),playerId=Number(body.playerId),pickNumber=Number(body.pickNumber);if(!Number.isSafeInteger(playerId)||playerId<0)throw fantasyError(400,'Invalid player');if(!Number.isSafeInteger(pickNumber)||pickNumber<0)throw fantasyError(400,'Invalid pick number');if((league.draftPicks||[]).some(pick=>pick.playerId===playerId))throw fantasyError(409,'Player has already been drafted in this league');if((league.draftPicks||[]).some(pick=>pick.pickNumber===pickNumber))throw fantasyError(409,'Draft pick number is already recorded');
        const draft=league.draftState;
        if(draft&&draft.phase==='draft'&&Array.isArray(draft.teams)){
          const size=Number(draft.size)||draft.teams.length,currentPick=Number(draft.pickNo);
          if(!Number.isSafeInteger(size)||size<2||size!==draft.teams.length||currentPick!==pickNumber)throw fantasyError(409,'Draft turn has changed',{version:league.draftVersion,draftState:draft});
          const round=Math.floor(currentPick/size),offset=currentPick%size,teamIndex=round%2===0?offset:size-1-offset;
          const participant=draft.league&&Array.isArray(draft.league.participants)&&draft.league.participants[teamIndex];
          if(!participant||participant.userId!==user.userId)throw fantasyError(403,'It is not your Draft turn');
          const draftTeam=draft.teams[teamIndex];if(!draftTeam||!Array.isArray(draftTeam.roster))throw fantasyError(409,'Draft roster is unavailable');
          if(draft.teams.some(item=>item&&Array.isArray(item.roster)&&item.roster.includes(playerId)))throw fantasyError(409,'Player has already been drafted in this league');
          draftTeam.roster.push(playerId);draft.log=Array.isArray(draft.log)?draft.log:[];draft.log.unshift({pick:pickNumber+1,team:teamIndex,pid:playerId});draft.pickNo=pickNumber+1;
        }
        const pick={playerId,teamId:team.id,pickNumber,created:Date.now()};league.draftPicks.push(pick);league.draftVersion++;league.updated=Date.now();return {pick,version:league.draftVersion,draftState:league.draftState}});jsonRes(req,res,201,result);}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    });return;
  }
  const fantasyLeaveRoute=url.match(/^\/api\/fantasy-leagues\/([A-Z0-9]+)\/membership$/);
  if(fantasyLeaveRoute&&req.method==='DELETE'){
    readBody(req,async(err,body)=>{if(err)body={};const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{await mutateFantasyLeagues(async all=>{const league=all[fantasyLeaveRoute[1]];if(!league)throw fantasyError(404,'League not found');const member=fantasyMembership(league,user.userId);if(!member)throw fantasyError(404,'Membership not found');if(league.ownerId===user.userId)throw fantasyError(409,'Transfer ownership or delete the league before leaving');if(league.format==='draft'&&league.draftState){if(league.draftState.phase&&league.draftState.phase!=='lobby')throw fantasyError(409,'You cannot leave while the Draft is in progress');const participants=league.draftState.league&&league.draftState.league.participants,slot=Array.isArray(participants)?participants.findIndex(item=>item&&item.userId===user.userId):-1;if(slot>=0){participants[slot]={name:'Open slot',isMe:false,isAI:false,isEmpty:true};league.draftVersion++;}}league.members=league.members.filter(item=>item.userId!==user.userId);league.teams=league.teams.filter(item=>item.userId!==user.userId);league.draftPicks=(league.draftPicks||[]).filter(pick=>league.teams.some(team=>team.id===pick.teamId));league.updated=Date.now();});jsonRes(req,res,200,{ok:true});}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    });return;
  }
  if(fantasyRoute&&req.method==='DELETE'){
    readBody(req,async(err,body)=>{if(err)body={};const user=authUser(req,body);if(!user)return jsonRes(req,res,401,{error:'Login required'});
      try{await mutateFantasyLeagues(async all=>{const league=all[fantasyRoute[1]];if(!league)throw fantasyError(404,'League not found');if(league.ownerId!==user.userId)throw fantasyError(403,'Only the league owner can delete this league');if(body.confirmName!==league.name)throw fantasyError(400,'League name confirmation is required');delete all[league.id];});jsonRes(req,res,200,{ok:true});}catch(error){jsonRes(req,res,error.status||500,{error:error.message,...error.public});}
    });return;
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
    users = loaded.users; leagues = loaded.leagues; sooScores = loaded.scores; fantasyLeagues = loaded.fantasyLeagues || {}; tokens = {};
    Object.values(users).forEach(user => {
      user.sessions = (user.sessions || []).filter(session => session.expires >= Date.now());
      user.sessions.forEach(session => { tokens[session.hash] = user.email; });
    });
  }
  else if(migrateJsonFantasyLeagues())await persistFantasyLeagues(structuredClone(fantasyLeagues));
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
