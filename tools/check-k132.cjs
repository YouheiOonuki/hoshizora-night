// K132 の受け入れ（ROADMAP 7.15.1）のうち、ブラウザで動かして確かめるもの。CI では走らせない（ブラウザが要る）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-k132.cjs [スクショと結果の出力先]
// WebKit が手元に無いので、iPhone は Playwright の iPhone の設定（画面の大きさ・DPR・タッチ・UA）を Chromium で使う。
// ヘッドレスの Chromium はソフトウェア描画（SwiftShader）なので、fps は実機の値ではない（段階の切り替えが動くかだけを見る）
//  1 iPhone の画面（日英・場所の一覧・星を選んだところ）: 横にはみ出さない・部品が画面の中で重ならない・時刻 28 px
//  2 prefers-reduced-motion: 止まった状態で開き、時刻も星（またたき）も動かない。設定が無ければ 60 倍で進む
//  3 外向きの要求: ページ自身が出す要求は同じオリジンの静的ファイルだけ（Cloudflare のビーコンは止めて数える）
//  4 動かない端末: CPU を遅くすると 4 等まで → 通常版へのリンク
//  5 WebGL が無い: 通常版へ送る（日本語 → /hoshizora-sanpo/、英語 → /hoshizora-sanpo/en/）
//  6 共有: #lat,lon,unixtime の URL が月ごとのページを指し、開くと同じ時刻・場所で止まっている
//  7 位置情報を拒否しても、都道府県庁の一覧で場所を変えられる。許可すれば「東京都付近」と緯度経度が出る
//  8 オーナー決定 2026-10-03 の演出: 開いたときの演出と流れ星は reduced motion で出ない／出るときは出る。星座線を全部出す切り替え
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { serve } = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'k132-check'));
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick|google-analytics|googletagmanager/;
const ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const IPHONE = devices['iPhone 13'];
const GEM = '#35.69,139.69,1797256800';   // 2026-12-14 23:00 東京（ふたご座流星群の極大の夜）

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const origin = `http://127.0.0.1:${srv.address().port}`, base = `${origin}/hoshizora-night/`;
  const R = { date: new Date().toISOString(), shots: [] };
  const browser = await chromium.launch({ args: ARGS });
  R.browser = `Chromium ${browser.version()}（iPhone 13 の設定: ${IPHONE.viewport.width}×${IPHONE.viewport.height}・DPR ${IPHONE.deviceScaleFactor}）`;
  const ctxOf = async (opt = {}) => { const c = await browser.newContext({ ...IPHONE, ...opt }); await c.route(BLOCK, (r) => r.abort()); return c; };
  const ready = (p) => p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const shot = async (p, name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); R.shots.push(f); };

  /* 1 iPhone の表示 */
  R.layout = {};
  for (const lang of ['ja', 'en']) {
    const ctx = await ctxOf(), p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${base}${lang === 'en' ? 'en/' : ''}?probe=off${GEM}`); await ready(p); await p.waitForTimeout(4300);   // 開いたときの演出（3.5 秒）の後
    await shot(p, `iphone-${lang}.png`);
    const lay = await p.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
      const parts = { clock: box('.clock'), place: box('#place'), tonight: box('#tonight'), bar: box('.bottom'), slider: box('#slider') };
      const inView = Object.entries(parts).filter(([, b]) => b.w > 0).every(([, b]) => b.x >= 0 && b.y >= 0 && b.r <= innerWidth + 0.5 && b.b <= innerHeight + 0.5);
      const over = (a, b) => a.w && b.w && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
      const pairs = [['clock', 'tonight'], ['place', 'tonight'], ['clock', 'bar'], ['tonight', 'bar']].filter(([a, b]) => over(parts[a], parts[b]));
      return { scrollW: document.scrollingElement.scrollWidth, innerW: innerWidth, inView, overlaps: pairs, timePx: getComputedStyle(document.getElementById('time')).fontSize,
        tonight: document.getElementById('tonight').textContent, time: document.getElementById('time').textContent, btn: [...document.querySelectorAll('.bottom .row button, .dock button')].map((b) => b.getBoundingClientRect().height) };
    });
    // 星をタップ（ベテルギウス）
    const pos = await p.evaluate((n) => window.__night.where(n), lang === 'en' ? 'Betelgeuse' : 'ベテルギウス');
    if (pos) { await p.touchscreen.tap(pos.x, pos.y); await p.waitForTimeout(1300); }
    lay.picked = await p.evaluate(() => window.__night.picked);
    lay.sheet = await p.evaluate(() => window.__night.sheet);   // 企画書 74: タップで説明シート
    await shot(p, `iphone-${lang}-tap.png`);
    // 星座線と名前は既定で全部（軽量版と同じ）。タップした星座（オリオン座）は金色の名前
    lay.allLines = await p.evaluate(() => ({ on: window.__night.allLines, names: [...document.querySelectorAll('.labels .con')].filter((e) => !e.hidden).map((e) => e.textContent),
      hot: [...document.querySelectorAll('.labels .con.hot')].filter((e) => !e.hidden).map((e) => e.textContent) }));
    await p.click('#sheetClose'); await p.click('#lines'); await p.waitForTimeout(400);
    lay.linesOff = await p.evaluate(() => window.__night.allLines === false);
    await shot(p, `iphone-${lang}-lines-off.png`);
    await p.click('#lines');
    await p.click('#place'); await p.waitForTimeout(300);
    await shot(p, `iphone-${lang}-places.png`);
    lay.panelScrollW = await p.evaluate(() => document.scrollingElement.scrollWidth);
    lay.errors = errors;
    lay.ok = lay.scrollW <= lay.innerW && lay.panelScrollW <= lay.innerW && lay.inView && !lay.overlaps.length && lay.timePx === '28px' && !errors.length && !!lay.picked
      && lay.sheet === 'star' && lay.allLines.on === true && lay.allLines.names.includes(lang === 'en' ? 'Taurus' : 'おうし座') && lay.allLines.hot.includes(lang === 'en' ? 'Orion' : 'オリオン座') && lay.linesOff;
    R.layout[lang] = lay;
    await ctx.close();
  }

  /* 2 reduced motion */
  R.motion = {};
  for (const reduce of [true, false]) {
    const ctx = await ctxOf({ reducedMotion: reduce ? 'reduce' : 'no-preference' }), p = await ctx.newPage();
    await p.goto(`${base}?probe=off`); await ready(p);
    const introAtStart = await p.evaluate(() => window.__night.intro());   // true = 演出は終わっている（または無い）
    await p.waitForTimeout(reduce ? 800 : 4300);
    const t0 = await p.evaluate(() => [window.__night.sim, performance.now(), window.__night.playing]);
    const a = await p.screenshot({ clip: { x: 0, y: 120, width: 390, height: 400 } });
    await p.waitForTimeout(1500);
    const t1 = await p.evaluate(() => [window.__night.sim, performance.now()]);
    const b = await p.screenshot({ clip: { x: 0, y: 120, width: 390, height: 400 } });
    const rate = (t1[0] - t0[0]) / (t1[1] - t0[1]);
    // 流れ星: 次の 1 本を今すぐにしても、reduced motion なら出ない
    await p.evaluate(() => window.__night.forceMeteor(3000)); await p.waitForTimeout(800);
    const meteor = await p.evaluate(() => window.__night.meteor());
    R.motion[reduce ? 'reduce' : 'normal'] = { playingAtStart: t0[2], speed: Math.round(rate * 10) / 10, sameFrame: Buffer.compare(a, b) === 0, introRunningAtStart: !introAtStart, meteor };
    await ctx.close();
  }
  R.motion.ok = R.motion.reduce.playingAtStart === false && R.motion.reduce.speed === 0 && R.motion.reduce.sameFrame
    && R.motion.reduce.introRunningAtStart === false && R.motion.reduce.meteor === false
    && R.motion.normal.playingAtStart === true && Math.abs(R.motion.normal.speed - 60) < 6 && !R.motion.normal.sameFrame
    && R.motion.normal.introRunningAtStart === true && R.motion.normal.meteor === true;

  /* 3 外向きの要求・読み込んだ量 */
  {
    const ctx = await browser.newContext({ ...IPHONE, permissions: [] });
    const reqs = [];
    ctx.on('request', (q) => reqs.push(q.url()));
    await ctx.route(BLOCK, (r) => r.abort());
    const p = await ctx.newPage();
    const sizes = { js: 0, img: 0 };
    p.on('response', async (res) => { try { const t = res.headers()['content-type'] || ''; const n = (await res.body()).length; if (/javascript/.test(t)) sizes.js += n; if (/^image\//.test(t)) sizes.img += n; } catch (e) { /* 止めた要求 */ } });
    await p.goto(`${base}?probe=off`); await ready(p);
    await p.click('#play'); await p.waitForTimeout(1500); await p.click('#now');
    await p.click('#place'); await p.click('#geo'); await p.waitForTimeout(500);
    await p.click('#placeList button >> nth=0'); await p.waitForTimeout(500);
    await p.locator('#slider').fill('120'); await p.waitForTimeout(300);
    const ext = reqs.filter((u) => !u.startsWith(origin));
    const own = reqs.filter((u) => u.startsWith(origin)).map((u) => u.slice(origin.length));
    R.requests = { external: ext, externalWithoutBeacon: ext.filter((u) => !/cloudflareinsights/.test(u)), own, bytes: sizes };
    R.requests.ok = R.requests.externalWithoutBeacon.length === 0 && own.every((u) => u.startsWith('/hoshizora-night/'));
    await ctx.close();
  }

  /* 4 動かない端末（CPU を 20 倍遅く） */
  {
    const ctx = await ctxOf(), p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
    await p.goto(base); await ready(p);
    const t = Date.now(); let seen = [];
    while (Date.now() - t < 30000) {
      const s = await p.evaluate(() => ({ stage: window.__night.stage, limit: window.__night.limit, fps: window.__night.fps.slice(), slow: !document.getElementById('slow').hidden }));
      if (!seen.length || seen[seen.length - 1].stage !== s.stage) seen.push(s);
      if (s.stage === 'light') break;
      await p.waitForTimeout(500);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await shot(p, 'iphone-ja-slow.png');
    R.degrade = { steps: seen, ok: seen.some((s) => s.stage === 'reduced' && s.limit === 4) && seen.some((s) => s.stage === 'light' && s.slow) };
    // 遅くしないときの値（参考。SwiftShader）
    const p2 = await ctx.newPage(); await p2.goto(base); await ready(p2); await p2.waitForTimeout(7000);
    R.degrade.unthrottled = await p2.evaluate(() => ({ stage: window.__night.stage, fps: window.__night.fps }));
    await ctx.close();
  }

  /* 5 WebGL が無い */
  {
    const b2 = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    R.nogl = {};
    for (const [path_, want] of [['', '/hoshizora-sanpo/'], ['en/', '/hoshizora-sanpo/en/'], ['m/12/', '/hoshizora-sanpo/']]) {
      const c = await b2.newContext(); await c.route(BLOCK, (r) => r.abort());
      const p = await c.newPage(); await p.goto(base + path_); await p.waitForURL((u) => u.pathname.startsWith('/hoshizora-sanpo/'), { timeout: 10000 }).catch(() => {});
      R.nogl[path_ || '/'] = new URL(p.url()).pathname === want;
      await c.close();
    }
    await b2.close();
    R.nogl.ok = Object.values(R.nogl).every(Boolean);
  }

  /* 6 共有 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route(BLOCK, (r) => r.abort());
    await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'share', { value: undefined }); } catch (e) { /* */ } });
    const p = await ctx.newPage();
    await p.goto(`${base}en/?probe=off#43.06,141.35,1800000000`); await ready(p);
    await p.click('#share'); await p.waitForTimeout(300);
    const url = await p.evaluate(() => navigator.clipboard.readText());
    const toast = await p.textContent('#toast');
    const q = await ctx.newPage(); await q.goto(url.replace('https://yorozu-craft.com', origin).replace(/^http:\/\/127[^/]+/, origin)); await ready(q);
    const opened = await q.evaluate(() => ({ sim: window.__night.sim, playing: window.__night.playing, place: window.__night.place, time: document.getElementById('time').textContent }));
    R.share = { url, toast, opened, ok: /\/hoshizora-night\/en\/m\/01\/#43\.06,141\.35,1800000000$/.test(url) && opened.sim === 1800000000000 && opened.playing === false && opened.place === 'pref-01' };
    await shot(q, 'pc-en-shared.png');
    await ctx.close();
  }

  /* 7 位置情報を拒否 */
  {
    const ctx = await ctxOf({ permissions: [] }), p = await ctx.newPage();
    await p.goto(`${base}?probe=off`); await ready(p);
    await p.click('#place'); await p.click('#geo'); await p.waitForTimeout(1200);
    const toast = await p.evaluate(() => !document.getElementById('toast').hidden && document.getElementById('toast').textContent);
    await p.click('#placeList button[data-id="pref-47"]'); await p.waitForTimeout(300);
    R.geoDenied = { toast, place: await p.evaluate(() => window.__night.place), label: await p.textContent('#place'), count: await p.locator('#placeList button').count() };
    R.geoDenied.ok = R.geoDenied.place === 'pref-47' && R.geoDenied.label === '沖縄県' && R.geoDenied.count === 49;   // 都道府県庁 47 か所＋石垣島・シドニー（企画書 74: 軽量版の場所）
    await ctx.close();
  }
  /* 7b 位置情報を許可（渋谷のあたり）→「東京都付近」と緯度経度。英語は Near Tokyo */
  R.geoGranted = {};
  for (const lang of ['ja', 'en']) {
    const ctx = await ctxOf({ permissions: ['geolocation'], geolocation: { latitude: 35.659, longitude: 139.700 } }), p = await ctx.newPage();
    await p.goto(`${base}${lang === 'en' ? 'en/' : ''}?probe=off`); await ready(p);
    await p.click('#place'); await p.click('#geo'); await p.waitForTimeout(1200);
    R.geoGranted[lang] = { label: await p.textContent('#place'), sub: await p.textContent('#placeSub') };
    if (lang === 'ja') { await p.waitForTimeout(3500); await shot(p, 'iphone-ja-here.png'); }
    await ctx.close();
  }
  R.geoGranted.ok = R.geoGranted.ja.label === '東京都付近' && R.geoGranted.ja.sub === '北緯35.7° 東経139.7°' && R.geoGranted.en.label === 'Near Tokyo' && R.geoGranted.en.sub === '35.7°N 139.7°E';

  await browser.close(); srv.close();
  fs.writeFileSync(path.join(OUT, 'check-k132.json'), JSON.stringify(R, null, 2));
  const summary = ['layout.ja', 'layout.en', 'motion', 'requests', 'degrade', 'nogl', 'share', 'geoDenied', 'geoGranted'].map((k) => [k, k.split('.').reduce((o, x) => o[x], R).ok]);
  for (const [k, ok] of summary) console.log(`${ok ? 'OK' : 'NG'}  ${k}`);
  console.log(`結果: ${path.join(OUT, 'check-k132.json')}`);
  if (summary.some(([, ok]) => !ok)) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
