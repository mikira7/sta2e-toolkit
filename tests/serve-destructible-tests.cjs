// Local-only browser test harness. Run with node tests/serve-destructible-tests.cjs.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  if (req.url === '/test-results' && req.method === 'POST') {
    let body = ''; req.on('data', data => { body += data; }); req.on('end', () => { console.log(body); res.end('ok'); }); return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.hbs': 'text/plain', '.png': 'image/png' };
  fs.readFile(target, (error, data) => { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store'); res.end(data); });
});
server.listen(3187, '127.0.0.1', () => console.log('Destructible tests: http://127.0.0.1:3187/tests/destructible-browser.html'));
