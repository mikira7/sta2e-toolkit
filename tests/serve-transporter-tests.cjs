// Uses the installed Foundry shader classes and PIXI; never connects to a world database.
// node tests/serve-transporter-tests.cjs [Foundry resources/app directory]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const foundryRoot = path.resolve(process.argv[2] || 'C:/Program Files/Foundry Virtual Tabletop/resources/app');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let base = root, relative = decodeURIComponent(url.pathname);
  if (relative.startsWith('/foundry/')) { base = path.join(foundryRoot, 'client'); relative = relative.slice(8); }
  else if (relative === '/vendor/pixi.js') { base = path.join(foundryRoot, 'node_modules/pixi.js/dist'); relative = '/pixi.js'; }
  const target = path.resolve(base, '.' + relative);
  if (!target.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.hbs':'text/plain' };
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); res.end(data);
  });
});
server.listen(3188, '127.0.0.1', () => console.log('Transporter verification: http://127.0.0.1:3188/tests/transporter-browser.html'));
