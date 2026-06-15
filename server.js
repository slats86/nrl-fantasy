/* Static server + NRL Fantasy data proxy — Railway compatible */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = process.env.PORT || 3000;

/* Serve a local file as JSON */
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

/* Proxy fallback if local file missing */
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

http.createServer(function(req, res) {
  /* Data API — serve from GitHub Actions-fetched static files */
  if (req.url === '/api/players') return serveLocal(res, path.join(__dirname, 'public/players.json'));
  if (req.url === '/api/rounds')  return serveLocal(res, path.join(__dirname, 'public/rounds.json'));

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
