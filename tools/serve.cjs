// 手元の確かめ用のサーバー（本番と同じ形の URL: /hoshizora-night/… と、通常版の代わりの /hoshizora-sanpo/…）。依存なし
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml' };

function serve(port = 0) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u.startsWith('/hoshizora-sanpo/')) { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end('<!doctype html><title>sanpo</title><p>通常版（確かめ用の代わり）</p>'); }
    if (!u.startsWith('/hoshizora-night/')) { res.writeHead(404); return res.end(); }
    let f = path.join(ROOT, u.slice('/hoshizora-night/'.length));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}
module.exports = { serve, ROOT };
if (require.main === module) serve(+process.argv[2] || 8765).then((s) => console.log(`http://127.0.0.1:${s.address().port}/hoshizora-night/`));
