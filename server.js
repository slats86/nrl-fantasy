/* Static server + NRL Fantasy data proxy — Railway compatible */
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const PORT   = process.env.PORT || 3000;

/* ── Data storage ─────────────────────────────────────────── */
const DATA_DIR    = path.join(__dirname, 'data');
const LEAGUE_FILE = path.join(DATA_DIR, 'soo-leagues.json');
const USERS_FILE  = path.join(DATA_DIR, 'soo-users.json');
let leagues = {};
let users   = {};  /* keyed by email (lowercase) */
let tokens  = {};  /* token → email */

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
try { leagues = JSON.parse(fs.readFileSync(LEAGUE_FILE, 'utf8')); } catch(e) {}
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  Object.values(users).forEach(u => { if(u.token) tokens[u.token] = u.email; });
} catch(e) {}

function saveLeagues() { try { fs.writeFileSync(LEAGUE_FILE, JSON.stringify(leagues)); } catch(e) {} }
function saveUsers()   { try { fs.writeFileSync(USERS_FILE,  JSON.stringify(users));   } catch(e) {} }

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
      /* store league association on user */
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
      /* One team per user per league */
      const existing = lg.teams.find(t => t.userId === user.userId);
      if (existing) return jsonRes(res, 409, {error: 'You already have a team in this league', teamId: existing.id, league: {name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId}});
      const teamId = genCode(10);
      lg.teams.push({
        id: teamId,
        userId: user.userId,
        name: (body.teamName || user.name || 'New Team').slice(0, 30),
        picks: body.picks || {}
      });
      /* store league association on user */
      user.leagueCode = body.code; user.teamId = teamId; saveUsers();
      saveLeagues();
      jsonRes(res, 200, { teamId, league: { name: lg.name, code: body.code, teams: lg.teams, ownerId: lg.ownerId } });
    });
    return;
  }

  /* GET /api/soo/my-league — returns the league the authed user belongs to */
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

  /* POST /api/soo/league/:code/picks  { teamId, picks, token } */
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

  /* DELETE /api/soo/league/:code/team/:teamId  — owner removes a team */
  const teamDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)\/team\/([A-Z0-9]+)$/);
  if (teamDel && req.method === 'DELETE') {
    readBody(req, (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const lg = leagues[teamDel[1]];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.ownerId !== user.userId) return jsonRes(res, 403, {error: 'Only the league owner can remove teams'});
      const before = lg.teams.length;
      lg.teams = lg.teams.filter(t => t.id !== teamDel[2]);
      if (lg.teams.length === before) return jsonRes(res, 404, {error: 'Team not found'});
      saveLeagues();
      jsonRes(res, 200, { ok: true, teams: lg.teams });
    });
    return;
  }

  /* DELETE /api/soo/league/:code  — owner deletes entire league */
  const leagueDel = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueDel && req.method === 'DELETE') {
    readBody(req, (err, body) => {
      if (err) body = {};
      const user = authUser(req, body);
      if (!user) return jsonRes(res, 401, {error: 'Login required'});
      const lg = leagues[leagueDel[1]];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.ownerId !== user.userId) return jsonRes(res, 403, {error: 'Only the league owner can delete this league'});
      delete leagues[leagueDel[1]];
      saveLeagues();
      jsonRes(res, 200, { ok: true });
    });
    return;
  }

  /* /soo — redirect to standalone */
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
