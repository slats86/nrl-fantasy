/* Static server + NRL Fantasy data proxy — Railway compatible */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = process.env.PORT || 3000;

/* ── SoO League storage ───────────────────────────────────── */
const LEAGUE_DIR  = path.join(__dirname, 'data');
const LEAGUE_FILE = path.join(LEAGUE_DIR, 'soo-leagues.json');
let leagues = {};

try {
  fs.mkdirSync(LEAGUE_DIR, { recursive: true });
  leagues = JSON.parse(fs.readFileSync(LEAGUE_FILE, 'utf8'));
} catch(e) { leagues = {}; }

function saveLeagues() {
  try { fs.writeFileSync(LEAGUE_FILE, JSON.stringify(leagues)); } catch(e) {}
}

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
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

  /* CORS preflight */
  if (req.method === 'OPTIONS') { jsonRes(res, 204, {}); return; }

  /* Static data */
  if (url === '/api/players') return serveLocal(res, path.join(__dirname, 'public/players.json'));
  if (url === '/api/rounds')  return serveLocal(res, path.join(__dirname, 'public/rounds.json'));

  /* ── SoO League API ── */

  /* POST /api/soo/create  { name, teamName, picks } → { code, teamId } */
  if (url === '/api/soo/create' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      const code = genCode(6);
      const teamId = genCode(10);
      leagues[code] = {
        name: (body.name || 'SoO League').slice(0, 40),
        created: Date.now(),
        teams: [{
          id: teamId,
          name: (body.teamName || 'My Team').slice(0, 30),
          picks: body.picks || {}
        }]
      };
      saveLeagues();
      jsonRes(res, 200, { code, teamId });
    });
    return;
  }

  /* POST /api/soo/join  { code, teamName, picks } → { teamId, league } */
  if (url === '/api/soo/join' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) return jsonRes(res, 400, {error: 'bad json'});
      const lg = leagues[body.code];
      if (!lg) return jsonRes(res, 404, {error: 'League not found'});
      if (lg.teams.length >= 30) return jsonRes(res, 400, {error: 'League full'});
      const teamId = genCode(10);
      lg.teams.push({
        id: teamId,
        name: (body.teamName || 'New Team').slice(0, 30),
        picks: body.picks || {}
      });
      saveLeagues();
      jsonRes(res, 200, { teamId, league: { name: lg.name, code: body.code, teams: lg.teams } });
    });
    return;
  }

  /* GET /api/soo/league/:code */
  const leagueGet = url.match(/^\/api\/soo\/league\/([A-Z0-9]+)$/);
  if (leagueGet && req.method === 'GET') {
    const lg = leagues[leagueGet[1]];
    if (!lg) return jsonRes(res, 404, {error: 'Not found'});
    jsonRes(res, 200, { name: lg.name, code: leagueGet[1], teams: lg.teams });
    return;
  }

  /* POST /api/soo/league/:code/picks  { teamId, picks } */
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
