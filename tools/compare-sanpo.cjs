// 軽量版（hoshizora-sanpo）とフル版を同じ時刻・場所・向きで撮って並べる（企画書 74 の「明らかに上」を目で比べるため）。CI では走らせない。
//   SANPO_DIR=<軽量版のクローン> NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/compare-sanpo.cjs [出力先]
// 1 枚の PNG に左 = 軽量版・右 = フル版。スマホ（iPhone 13 の設定）と PC（1440×900）、冬（オリオン）と夏（天の川）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, devices } = require('playwright');

const NIGHT = path.resolve(__dirname, '..');
const SANPO = path.resolve(process.env.SANPO_DIR || path.join(NIGHT, '..', 'hoshizora-sanpo'));
const OUT = path.resolve(process.argv[2] || path.join(NIGHT, '..', 'k132p-compare'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick/;
// [名前, ISO 時刻（日本時間）, 向き（方位°）, 高度°]
const SCENES = [['winter', '2027-01-15T21:00+09:00', 180, 40], ['summer', '2027-08-10T21:00+09:00', 180, 30]];

function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [root, pre] = u.startsWith('/hoshizora-sanpo/') ? [SANPO, '/hoshizora-sanpo/'] : u.startsWith('/hoshizora-night/') ? [NIGHT, '/hoshizora-night/'] : [null];
    if (!root) { res.writeHead(404); return res.end(); }
    let f = path.join(root, u.slice(pre.length));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(), origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const DEV = { phone: { ...devices['iPhone 13'] }, pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } };
  const files = [];
  for (const [dev, opt] of Object.entries(DEV)) for (const [name, iso, az, alt] of SCENES) {
    const ms = Date.parse(iso), shots = {};
    for (const which of ['sanpo', 'night']) {
      const ctx = await browser.newContext({ ...opt, reducedMotion: 'reduce' });
      await ctx.route(BLOCK, (r) => r.abort());
      await ctx.addInitScript(() => { try { localStorage.setItem('hzs_seen', '1'); } catch (e) { /* なし */ } });
      const p = await ctx.newPage();
      if (which === 'sanpo') {
        await p.goto(`${origin}/hoshizora-sanpo/?t=${encodeURIComponent(iso)}&loc=tokyo&look=az:${az}`);
        await p.waitForTimeout(1500);
      } else {
        await p.goto(`${origin}/hoshizora-night/?probe=off&view=${az},${alt}#35.69,139.69,${ms / 1000}`);
        await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
        await p.waitForFunction(() => !window.__night.loading || !window.__night.loading(), null, { timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(1200);
      }
      shots[which] = await p.screenshot();
      await ctx.close();
    }
    // 2 枚を横に並べる（ブラウザの canvas で）
    const pg = await browser.newPage();
    const out = await pg.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
      const [A, B] = await Promise.all([load(a), load(b)]);
      const c = document.createElement('canvas'); c.width = A.width + B.width + 16; c.height = Math.max(A.height, B.height);
      const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, c.width, c.height); g.drawImage(A, 0, 0); g.drawImage(B, A.width + 16, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, [shots.sanpo.toString('base64'), shots.night.toString('base64')]);
    await pg.close();
    const f = path.join(OUT, `${dev}-${name}.png`); fs.writeFileSync(f, Buffer.from(out, 'base64')); files.push(f);
  }
  await browser.close(); srv.close();
  console.log(files.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
