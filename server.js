/* Static server + NRL Fantasy data proxy — Railway compatible */
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const PORT     = process.env.PORT || 3000;
const APP_URL  = (process.env.APP_URL || 'https://nrl-fantasy-production.up.railway.app').replace(/\/$/, '');
const FROM_EMAIL = process.env.FROM_EMAIL || 'NRL Fantasy <noreply@nrl-fantasy.app>';
const RESEND_KEY = process.env.RESEND_API_KEY || '';

/* ── Email via Resend API ─────────────────────────────────── */
function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
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
      r.on('end', () => { console.log('[email] sent:', subject, '→', to, JSON.parse(d).id || d); resolve(); });
    });
    req.on('error', e => { console.error('[email] error:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

/* ── Data storage ─────────────────────────────────────────── */
const DATA_DIR    = path.join(__dirname, 'data');
const LEAGUE_FILE = path.join(DATA_DIR, 'soo-leagues.json');
const USERS_FILE  = path.join(DATA_DIR, 'soo-users.json');
const SCORES_FILE = path.join(DATA_DIR, 'soo-scores.json');
let leagues = {};
let users   = {};  /* keyed by email (lowercase) */
let tokens  = {};  /* token → email */
let resetTokens = {}; /* token → { email, expires } — in-memory only, cleared on restart */
/* sooScores: { "gameNum:playerId": points }  e.g. { "3:1234": 87 } */
let sooScores = {};

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
try { leagues = JSON.parse(fs.readFileSync(LEAGUE_FILE, 'utf8')); } catch(e) {}
try { sooScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  Object.values(users).forEach(u => { if(u.token) tokens[u.token] = u.email; });
} catch(e) {}

function saveLeagues() { try { fs.writeFileSync(LEAGUE_FILE, JSON.stringify(leagues)); } catch(e) {} }
function saveUsers()   { try { fs.writeFileSync(USERS_FILE,  JSON.stringify(users));   } catch(e) {} }
function saveScores()  { try { fs.writeFileSync(SCORES_FILE, JSON.stringify(sooScores)); } catch(e) {} }

function hashPwd(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function genCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 100000) req.destroy(); });
  req.on('end', () => { try { cb(null, JSON.parse(body)); } catch(e) { cb(e); } });
}

function jsonRes(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(JSON.stringify(obj));
}

/* Resolve user from token (body.token or Authorization header) */
function authUser(req, body) {
  const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const tok = hdr || (body && body.token) || '';
  const email = tokens[tok];
  return email ? users[email] : null;
}

/* ── Static file helpers ───────────────────────────────────── */
function serveLocal(res, filePath) {
  fs.readFile(filePath, function(err, data) {
    if (err) return proxyNRL(res, '/' + path.basename(filePath).replace('.json', '') === 'players'
      ? 'data/nrl/players.json' : 'data/nrl/rounds.json');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
}

function proxyNRL(res, nrlPath) {
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
  const req = https.request(opts, function(upstream) {
    res.writeHead(upstream.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    upstream.pipe(res);
  });
  req.on('error', function(e) {
    res.writeHead(502);
    res.end(JSON.stringify({error: 'proxy error', detail: e.message}));
  });
  req.end();
}

/* ── HTTP server ───────────────────────────────────────────── */
http.createServer(function(req, res) {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') { jsonRes(res, 204, {}); return; }

  if (url === '/api/players') return serveLocal(res, path.join(__dirname, 'public/players.json'));
  if (url === '/api/rounds')  return serveLocal(res, path.join(__dirname, 'public/rounds.json'));

  /* ── Auth ── */

  if (url === '/api/soo/register' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'Bad request'});
      const email = (body.email||'').trim().toLowerCase();
      const name  = (body.name||'').trim().slice(0,40);
      const pass  = body.password||'';
      if (!email || !name || pass.length < 6)
        return jsonRes(res, 400, {error: 'Name, email and password (min 6 chars) required'});
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return jsonRes(res, 400, {error: 'Invalid email'});
      if (users[email])
        return jsonRes(res, 409, {error: 'Email already registered'});
      const salt   = crypto.randomBytes(16).toString('hex');
      const token  = genToken();
      const userId = genCode(10);
      users[email] = { userId, name, email, salt, hash: hashPwd(pass, salt), token };
      tokens[token] = email;
      saveUsers();
      jsonRes(res, 200, { token, userId, name, email });
      /* Welcome email (async — don't block response) */
      sendEmail(email, 'Welcome to NRL Fantasy! 🏉', `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy 🏉</h2>
          <p>Hey ${name},</p>
          <p>You're all set! Head back to the app to pick your State of Origin team and compete with mates.</p>
          <a href="${APP_URL}" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Go to NRL Fantasy</a>
          <p style="color:#888;font-size:12px;margin-top:24px">Unofficial fan-made game · Not affiliated with the NRL</p>
        </div>
      `).catch(() => {});
    });
    return;
  }

  if (url === '/api/soo/login' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'Bad request'});
      const email = (body.email||'').trim().toLowerCase();
      const pass  = body.password||'';
      const user  = users[email];
      if (!user || hashPwd(pass, user.salt) !== user.hash)
        return jsonRes(res, 401, {error: 'Invalid email or password'});
      const token = genToken();
      if (user.token) delete tokens[user.token];
      user.token = token;
      tokens[token] = email;
      saveUsers();
      jsonRes(res, 200, { token, userId: user.userId, name: user.name, email: user.email, leagueCode: user.leagueCode||null, teamId: user.teamId||null });
    });
    return;
  }

  /* POST /api/soo/forgot-password { email } */
  if (url === '/api/soo/forgot-password' && req.method === 'POST') {
    readBody(req, async (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'Bad request'});
      const email = (body.email||'').trim().toLowerCase();
      /* Always 200 — never reveal whether an email is registered */
      jsonRes(res, 200, {ok: true});
      const user = users[email];
      if (!user) return;
      const tok = genToken();
      resetTokens[tok] = { email, expires: Date.now() + 3600000 }; /* 1 hour */
      const link = APP_URL + '/?resetToken=' + tok;
      await sendEmail(email, 'Reset your NRL Fantasy password', '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="color:#4ade80;margin-bottom:4px">NRL Fantasy 🏉</h2><p>Hi ' + user.name + ',</p><p>Someone requested a password reset for your account. Click below to set a new password — this link expires in <strong>1 hour</strong>.</p><a href="' + link + '" style="display:inline-block;background:#4ade80;color:#071d10;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Reset Password</a><p style="color:#888;font-size:12px">If you did not request this, you can safely ignore this email.</p><p style="color:#888;font-size:11px;word-break:break-all">Or copy this link: ' + link + '</p></div>').catch(() => {});
    });
    return;
  }

  /* POST /api/soo/reset-password { token, password } */
  if (url === '/api/soo/reset-password' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'Bad request'});
      const record = resetTokens[body.token];
      if (!record || Date.now() > record.expires)
        return jsonRes(res, 400, {error: 'Reset link has expired or is invalid. Please request a new one.'});
      if (!body.password || body.password.length < 6)
        return jsonRes(res, 400, {error: 'Password must be at least 6 characters'});
      const user = users[record.email];
      if (!user) return jsonRes(res, 400, {error: 'Account not found'});
      const salt = crypto.randomBytes(16).toString('hex');
      user.salt = salt;
      user.hash = hashPwd(body.password, salt);
      const loginToken = genToken();
      if (user.token) delete tokens[user.token];
      user.token = loginToken;
      tokens[loginToken] = user.email;
      delete resetTokens[body.token];
      saveUsers();
      jsonRes(res, 200, { token: loginToken, userId: user.userId, name: user.name, email: user.email,
        leagueCode: user.leagueCode||null, teamId: user.teamId||null });
    });
    return;
  }

  /* ── League API (all require auth) ── */

  /* POST /api/soo/create  { name, teamName, picks, token } */
  if (url === '/api/soo/create' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const code   = genCode(6);
      const teamId = genCode(10);
      leagues[code] = {
        name: (body.name || 'SoO League').slice(0, 40),
        ownerId: user.userId,
        created: Date.now(),
        teams: [{
          id: teamId,
          userId: user.userId,
          name: (body.teamName || user.name || 'My Team').slice(0, 30),
          picks: body.picks || {}
        }]
      };
      user.leagueCode = code; user.teamId = teamId; saveUsers();
      saveLeagues();
      jsonRes(res, 200, { code, teamId });
    });
    return;
  }

  /* POST /api/soo/join  { code, teamName, picks, token } */
  if (url === '/api/soo/join' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const lg = leagues[body.code];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.teams.length >= 30) return jsonRes(res, 400, {error: 'League full'});
      const existing = lg.teams.find(t => t.userId === user.userId);
      if (existing) return jsonRes(res, 409, {error: 'You already have a team in this league', teamId: existing.id, league: {name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId}});
      const teamId = genCode(10);
      lg.teams.push({
        id: teamId,
        userId: user.userId,
        name: (body.teamName || user.name || 'New Team').slice(0, 30),
        picks: body.picks || {}
      });
      user.leagueCode = body.code; user.teamId = teamId; saveUsers();
      saveLeagues();
      jsonRes(res, 200, { teamId, league: { name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId } });
    });
    return;
  }

  /* GET /api/soo/my-league */
  if (url === '/api/soo/my-league' && req.method === 'GET') {
    const tok = (req.headers['authorization']||'').replace(/^Bearer\s+/i,'');
    const uEmail = tokens[tok];
    const u = uEmail && users[uEmail];
    if (!u || !u.leagueCode) return jsonRes(res, 404, {error: 'No league'});
    const lg = leagues[u.leagueCode];
    if (!lg) return jsonRes(res, 404, {error: 'League not found'});
    jsonRes(res, 200, { leagueCode: u.leagueCode, teamId: u.teamId, league: { name: lg.name, code: u.leagueCode, teams: lg.teams, ownerId: lg.ownerId } });
    return;
  }

  /* GET /api/soo/league/:code */
  const leagueGet = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueGet && req.method === 'GET') {
    const lg = leagues[leagueGet[1]];
    if (!lg) return jsonRes(res, 404, {error: 'Not found'});
    jsonRes(res, 200, { name: lg.name, code: leagueGet[1], teams: lg.teams, ownerId: lg.ownerId });
    return;
  }

  /* POST /api/soo/league/:code/picks */
  const leaguePicks = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)\/picks$/);
  if (leaguePicks && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      const lg = leagues[leaguePicks[1]];
      if (!lg) return jsonRes(res, 404, {error: 'Not found'});
      const team = lg.teams.find(t => t.id === body.teamId);
      if (!team) return jsonRes(res, 404, {error: 'Team not found'});
      team.picks = body.picks || team.picks;
      if (body.teamName) team.name = body.teamName.slice(0, 30);
      saveLeagues();
      jsonRes(res, 200, { ok: true });
    });
    return;
  }

  /* DELETE /api/soo/league/:code/team/:teamId */
  const teamDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)\/team\/([A-Z0-9]+)$/);
  if (teamDel && req.method === 'DELETE') {
    readBody(req, (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const lg = leagues[teamDel[1]];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.ownerId && lg.ownerId !== user.userId) return jsonRes(res, 403, {error: 'Only the league owner can remove teams'});
      const before = lg.teams.length;
      lg.teams = lg.teams.filter(t => t.id !== teamDel[2]);
      if (lg.teams.length === before) return jsonRes(res, 404, {error: 'Team not found'});
      saveLeagues();
      jsonRes(res, 200, { ok: true, teams: lg.teams });
    });
    return;
  }

  /* DELETE /api/soo/league/:code */
  const leagueDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueDel && req.method === 'DELETE') {
    readBody(req, (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const lg = leagues[leagueDel[1]];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.ownerId && lg.ownerId !== user.userId) return jsonRes(res, 403, {error: 'Only the league owner can delete this league'});
      delete leagues[leagueDel[1]];
      saveLeagues();
      jsonRes(res, 200, { ok: true });
    });
    return;
  }

  /* ── SoO Scores API ── */

  if (url === '/api/soo/scores' && req.method === 'GET') {
    jsonRes(res, 200, sooScores);
    return;
  }

  if (url === '/api/soo/scores' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      if (body.secret !== 'SCORESECRET2026') return jsonRes(res, 403, {error: 'Forbidden'});
      const game = parseInt(body.game);
      if (!game || !body.scores) return jsonRes(res, 400, {error: 'game and scores required'});
      Object.entries(body.scores).forEach(([pid, pts]) => {
        sooScores[game + ':' + pid] = Number(pts);
      });
      saveScores();
      jsonRes(res, 200, {ok: true, stored: Object.keys(body.scores).length});
    });
    return;
  }

  if (url.startsWith('/api/soo/scores') && req.method === 'DELETE') {
    const qs = req.url.split('?')[1] || '';
    if (!qs.includes('secret=SCORESECRET2026')) return jsonRes(res, 403, {error: 'Forbidden'});
    const gameMatch = qs.match(/game=(\d)/);
    if (gameMatch) {
      const g = gameMatch[1];
      Object.keys(sooScores).forEach(k => { if(k.startsWith(g+':')) delete sooScores[k]; });
    } else {
      sooScores = {};
    }
    saveScores();
    jsonRes(res, 200, {ok: true});
    return;
  }

  if (url === '/api/soo/admin/wipe-leagues' && req.method === 'GET') {
    const qs = req.url.split('?')[1] || '';
    if (!qs.includes('secret=WIPEIT')) return jsonRes(res, 403, {error: 'Forbidden'});
    leagues = {};
    saveLeagues();
    Object.values(users).forEach(u => { delete u.leagueCode; delete u.teamId; });
    saveUsers();
    jsonRes(res, 200, {ok: true, message: 'All leagues wiped. Users unlinked from leagues.'});
    return;
  }

  if (url === '/soo') {
    res.writeHead(302, { 'Location': '/?soo=1' });
    res.end();
    return;
  }

  /* App shell */
  var file = path.join(__dirname, 'index.html');
  fs.readFile(file, function(err, data) {
    if (err) { res.writeHead(500); res.end('error'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}).listen(PORT, function() { console.log('NRL Fantasy on :' + PORT); });
