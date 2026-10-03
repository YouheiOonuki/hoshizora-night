// 企画書 75（フル版だけの 8 つの機能）の画面の確かめとスクショ（スマホ・PC、機能ごと）。CI では走らせない（ブラウザが要る）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-wow2.cjs <出力先> [機能の番号…]
// スマホは Playwright の iPhone 13 の設定を Chromium で（WebKit が無い）。ヘッドレスはソフトウェア描画なので fps は見ない。
// 結果は <出力先>/result.json。OK でない項目があれば終了コード 1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { serve } = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'k132w2'));
const ONLY = process.argv.slice(3).map(Number);
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick|google-analytics|googletagmanager/;
const ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const PHONE = devices['iPhone 13'];
const PC = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const WINTER = '#35.69,139.69,1800021600';  // 2027-01-15 23:00 JST 東京（冬の星座が南に）

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ARGS });
  const R = { date: new Date().toISOString(), browser: `Chromium ${browser.version()}`, features: {} };
  const ctxOf = async (dev, opt = {}) => { const c = await browser.newContext({ ...dev, ...opt }); await c.route(BLOCK, (r) => r.abort()); return c; };
  const ready = (p) => p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const open = async (dev, url, opt) => {
    const ctx = await ctxOf(dev, opt), p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(base + url); await ready(p); await p.waitForTimeout(300);
    return { ctx, p, errors };
  };
  const shot = async (p, name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); return f; };
  const want = (n) => !ONLY.length || ONLY.includes(n);

  /* 1 ジャイロ: 端末の向きのイベント（Android の deviceorientationabsolute）を送って、その方向の星が出るか */
  if (want(1)) {
    const F = { shots: [] };
    const { ctx, p, errors } = await open(PHONE, `?probe=off&gyro=show${WINTER}`, { reducedMotion: 'reduce' });
    F.visible = await p.isVisible('#gyro');
    await p.click('#gyro');
    // alpha 0（端末の上が磁北）・beta 120（30° 見上げる）。東京の偏角 約 −8° を足すので真北から西へ約 8° の方向
    const send = (a, b, g) => p.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: a, beta: b, gamma: g, absolute: true })), [a, b, g]);
    await send(0, 120, 0); await p.waitForTimeout(400);
    F.north = await p.evaluate(() => ({ g: window.__night.gyro, az: window.__night.view.az * 180 / Math.PI, alt: window.__night.view.alt * 180 / Math.PI, toast: window.__night.toast }));
    F.shots.push(await shot(p, '1-gyro-phone-north.png'));
    // 南（alpha 180）を 50° 見上げる → オリオン座の方へ
    await send(180, 140, 0); await p.waitForTimeout(400);
    F.south = await p.evaluate(() => ({ az: window.__night.view.az * 180 / Math.PI, alt: window.__night.view.alt * 180 / Math.PI }));
    F.shots.push(await shot(p, '1-gyro-phone-south.png'));
    // ドラッグでジャイロが止まる
    await p.touchscreen.tap(10, 400);
    const box = await p.locator('#sky').boundingBox();
    await p.mouse.move(box.width / 2, 400); await p.mouse.down(); await p.mouse.move(box.width / 2 + 80, 420, { steps: 5 }); await p.mouse.up();
    F.stoppedByDrag = await p.evaluate(() => window.__night.gyro === null && document.getElementById('gyro').getAttribute('aria-pressed') === 'false');
    // イベントが来ない端末: 時間切れでドラッグのまま
    await p.click('#gyro'); await p.waitForTimeout(1800);
    F.timeout = await p.evaluate(() => ({ pressed: document.getElementById('gyro').getAttribute('aria-pressed'), toast: window.__night.toast }));
    F.errors = errors;
    await ctx.close();
    // PC: ボタンは出ない（マウスの端末）
    const pc = await open(PC, `?probe=off${WINTER}`);
    F.pcHidden = !(await pc.p.isVisible('#gyro'));
    F.shots.push(await shot(pc.p, '1-gyro-pc-hidden.png'));
    await pc.ctx.close();
    const decl = -7.94;
    F.ok = F.visible && F.pcHidden && !errors.length && F.north.g && F.north.g.north === true
      && Math.abs((((F.north.az - (360 + decl)) % 360) + 540) % 360 - 180) < 0.6 && Math.abs(F.north.alt - 30) < 0.6
      && Math.abs((((F.south.az - (180 + decl)) % 360) + 540) % 360 - 180) < 0.6 && Math.abs(F.south.alt - 50) < 0.6
      && F.stoppedByDrag && F.timeout.pressed === 'false';
    R.features[1] = F;
  }

  /* 2 街明かり: つまみで田舎 → 都会。限界等級・天の川が下がり、空が明るくなる（同じ空を並べて撮る） */
  if (want(2)) {
    const F = { shots: [], steps: [] };
    const SUMMER = '#35.69,139.69,1817899200';   // 2027-08-10 21:00 JST 東京（夏の天の川が南に）
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const { ctx, p, errors } = await open(dev, `?probe=off&view=180,45${SUMMER}`, { reducedMotion: 'reduce' });
      await p.click('#lightBtn'); await p.waitForTimeout(200);
      for (const [u, name] of [[0, 'country'], [0.5, 'suburb'], [1, 'city']]) {
        await p.evaluate((u) => window.__night.setLight(u), u); await p.waitForTimeout(300);
        const st = await p.evaluate(() => ({ ...window.__night.light, read: document.getElementById('lightRead').textContent }));
        if (tag === 'phone') F.steps.push(st);
        // 空の明るさ（画面の中ほどの平均の明るさ）
        const buf = await p.screenshot({ clip: { x: 0, y: 140, width: dev.viewport.width, height: 260 } });
        st.png = buf.length;
        F.shots.push(await shot(p, `2-light-${tag}-${name}.png`));
      }
      await p.click('[data-close="lightPanel"]'); await p.waitForTimeout(200);
      F[tag + 'PressedAfterClose'] = await p.evaluate(() => document.getElementById('lightBtn').getAttribute('aria-pressed'));
      F[tag + 'Errors'] = errors;
      await ctx.close();
    }
    const [a, b, c] = F.steps;
    F.ok = a.limit >= 6.5 && b.limit < a.limit && c.limit < 4 && a.milky === 1 && c.milky === 0 && /6\.5/.test(a.read)
      && F.phonePressedAfterClose === 'true' && !F.phoneErrors.length && !F.pcErrors.length;
    R.features[2] = F;
  }

  await browser.close(); srv.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 2));
  const ng = Object.entries(R.features).filter(([, f]) => !f.ok).map(([k]) => k);
  console.log(JSON.stringify(R, null, 1).slice(0, 4000));
  console.log(ng.length ? `NG: ${ng.join(', ')}` : 'すべて OK');
  if (ng.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
