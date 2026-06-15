/* Zero-dependency static server + NRL Fantasy API proxy — Railway compatible */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = process.env.PORT || 3000;

function proxyNRL(res, nrlPath) {
  const opts = {
    hostname: 'fantasy.nrl.com',
    path: nrlPath,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': 'https://fantasy.nrl.com/'
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
  if (req.url === '/api/players') return proxyNRL(res, '/data/nrl/players.json');
  if (req.url === '/api/rounds')  return proxyNRL(res, '/data/nrl/rounds.json');

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
