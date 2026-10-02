// WebGL の技術確認を Playwright（Chromium）で測る。CI では走らせない（ブラウザが要る）。
//
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=<ブラウザの置き場> node tools/measure-webgl.cjs [スクショの出力先]
//
// 1. tech/ の fps（スマホ 390×844・DPR 3 と PC 1280×800・DPR 1）。ヘッドレスなので GPU ではなくソフトウェア描画
//    （SwiftShader）の参考値。実機の値ではない
// 2. WebGL を切ったブラウザで tech/ と sketches/ を開くと /hoshizora-sanpo/ に送られるか
// 3. 試し描き 3 枚のスクショ
// サーバーは同じ形の URL（/hoshizora-night/… と /hoshizora-sanpo/）をこの場で立てる。依存は playwright だけ
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'k132-shots'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u.startsWith('/hoshizora-sanpo/')) { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end('<!doctype html><title>sanpo</title><p>通常版（測定用の代わり）</p>'); }
    if (!u.startsWith('/hoshizora-night/')) { res.writeHead(404); return res.end(); }
    let f = path.join(ROOT, u.slice('/hoshizora-night/'.length));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  // 外の計測（Cloudflare）は読みに行かない
  const block = (ctx) => ctx.route(/cloudflareinsights|googlesyndication/, (r) => r.abort());
  const result = { date: new Date().toISOString(), fps: {}, fallback: {}, shots: [] };

  // 1. fps
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();
  for (const [name, dev] of Object.entries(DEVICES)) {
    const ctx = await browser.newContext(dev); await block(ctx);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + 'tech/');
    await page.waitForFunction(() => window.__fps > 0, null, { timeout: 20000 });
    const samples = [];
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(2050); samples.push(await page.evaluate(() => window.__fps)); }
    const info = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl && gl.getParameter(gl.RENDERER)), stars: window.__stars, url: location.pathname };
    });
    await page.screenshot({ path: path.join(OUT, `tech-${name}.png`) });
    result.fps[name] = { ...dev.viewport, dpr: dev.deviceScaleFactor, samples: samples.map((x) => +x.toFixed(1)), median: +samples.sort((a, b) => a - b)[2].toFixed(1), ...info, errors };
    result.shots.push(path.join(OUT, `tech-${name}.png`));
    await ctx.close();
  }

  // 3. 試し描き（?t= で止めた瞬間を撮る）
  const STILL = { a: 0, b: 7, c: 1.3 };
  for (const [s, t] of Object.entries(STILL)) for (const [name, dev] of Object.entries(DEVICES)) {
    const ctx = await browser.newContext(dev); await block(ctx);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}sketches/${s}.html?t=${t}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const file = path.join(OUT, `sketch-${s}-${name}.png`);
    await page.screenshot({ path: file });
    result.shots.push(file);
    if (errors.length) result[`errors_${s}_${name}`] = errors;
    await ctx.close();
  }
  await browser.close();

  // 2. WebGL を切ったブラウザ
  const noGL = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  for (const p of ['tech/', 'sketches/a.html', 'sketches/b.html', 'sketches/c.html']) {
    const ctx = await noGL.newContext(DEVICES.phone); await block(ctx);
    const page = await ctx.newPage();
    await page.goto(base + p);
    await page.waitForURL(/\/hoshizora-sanpo\/$/, { timeout: 10000 }).catch(() => {});
    result.fallback[p] = new URL(page.url()).pathname;
    await ctx.close();
  }
  await noGL.close();
  srv.close();

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  const bad = Object.values(result.fallback).some((u) => u !== '/hoshizora-sanpo/');
  process.exit(bad ? 1 : 0);
})();
