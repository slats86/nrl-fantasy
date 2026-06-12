/* Tiny zero-dependency static server — Railway/Render/anything compatible */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  // single-page app: everything serves index.html
  const file = path.join(__dirname, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); res.end('error'); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
}).listen(PORT, () => console.log('Fantasy Footy NRL listening on :' + PORT));
