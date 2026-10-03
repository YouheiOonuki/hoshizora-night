// K43 生まれた日の星空ポスター（企画書 72）の受け入れの確かめ（Playwright）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-k43.cjs [出力先]
// 1 PDF を実際にダウンロードして、寸法（mm）・塗り足しの箱・画像の画素数（= dpi）を読む（A4・A3・B5、300・350 dpi、塗り足し）
// 2 PNG をダウンロードして、pHYs の dpi・画素数と、名前の付いた明るい星が予測した画素に光っているか（同じ星が同じ位置）
// 3 外向きの要求が無い（Cloudflare のビーコンは止めて数える）・題名が URL に出ない
// 4 画面のスクショ（スマホ 390×844・PC 1280×900）と見本（白・B5・ゴシック）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./serve.cjs');
const PO = require('../render/poster.js');
const readPdf = (b) => PO.readPdf(new Uint8Array(b));

const OUT = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'check-k43'));
const AT = '1990-12-24T21:00:00+09:00';   // 東京・1990-12-24 21:00（冬の星座が南東に上がる）
const HASH = `#35.69,139.69,${Date.parse(AT) / 1000}`;
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'OK ' : 'NG '} ${name}${detail ? ` — ${detail}` : ''}`); };

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/poster/`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const outside = [];
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === '127.0.0.1') return r.continue();
    outside.push(u.hostname); return r.abort();   // Cloudflare のビーコン・広告も止める（計測を汚さない。ROADMAP 7.16）
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + HASH);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  const st0 = await page.evaluate(() => { const s = window.__poster.state(); return { date: document.getElementById('date').value, time: document.getElementById('time').value, place: document.getElementById('place').value, maxD: window.__poster.maxD, lat: s.lat }; });
  ok('# で開く（フル版の共有と同じ #lat,lon,unixtime）', st0.date === '1990-12-24' && st0.time === '21:00' && st0.place === 'pref-13', JSON.stringify(st0));
  await page.screenshot({ path: path.join(OUT, 'mobile-top.png') });
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.fill('#title', 'テストの題名');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'mobile-full.png'), fullPage: true });
  ok('題名は URL に出ない', !decodeURIComponent(page.url()).includes('テスト') && page.url().endsWith(HASH), page.url());

  async function set(o) {
    await page.check(`input[name=paper][value=${o.paper}]`, { force: true });
    await page.selectOption('#dpi', String(o.dpi));
    await page.setChecked('#bleed', !!o.bleed);
    if (o.theme) await page.selectOption('#theme', o.theme);
    if (o.font) await page.selectOption('#font', o.font);
    await page.waitForTimeout(200);
  }
  async function download(btn) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click(btn)]);
    const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); return f;
  }

  // 1 PDF
  const CASES = [{ paper: 'A4', dpi: 350 }, { paper: 'A3', dpi: 350, bleed: true }, { paper: 'B5', dpi: 300 }, { paper: 'A3', dpi: 300 }, { paper: 'A4', dpi: 300, bleed: true }];
  const mm = (pt) => pt / 72 * 25.4;
  for (const c of CASES) {
    await set(c);
    const t0 = Date.now(), f = await download('#pdf'), sec = ((Date.now() - t0) / 1000).toFixed(1);
    const r = readPdf(fs.readFileSync(f)), P = PO.PAPERS[c.paper], b = c.bleed ? 3 : 0;
    const lay = PO.layout(c);
    const wMm = mm(r.media[2]), hMm = mm(r.media[3]);
    const imgW = r.imgs[0][0], imgH = r.imgs.reduce((a, x) => a + x[1], 0);
    const dpiW = imgW / ((P.w + 2 * b) / 25.4), dpiH = imgH / ((P.h + 2 * b) / 25.4);
    const trimOk = c.bleed ? Math.abs(mm(r.trim[2] - r.trim[0]) - P.w) < 0.01 && Math.abs(mm(r.trim[3] - r.trim[1]) - P.h) < 0.01 && Math.abs(mm(r.trim[0]) - 3) < 0.01 : r.trim === null;
    const pass = r.xrefOk && Math.abs(wMm - (P.w + 2 * b)) < 0.01 && Math.abs(hMm - (P.h + 2 * b)) < 0.01 && trimOk && imgW === lay.pageW && imgH === lay.pageH && Math.abs(dpiW - c.dpi) < 0.5 && Math.abs(dpiH - c.dpi) < 0.5;
    ok(`PDF ${c.paper}・${c.dpi} dpi${c.bleed ? '・塗り足し' : ''}`, pass,
      `${wMm.toFixed(2)}×${hMm.toFixed(2)} mm${c.bleed ? `（仕上がり ${mm(r.trim[2] - r.trim[0]).toFixed(2)}×${mm(r.trim[3] - r.trim[1]).toFixed(2)}）` : ''}、画像 ${imgW}×${imgH} px（帯 ${r.imgs.length}）＝ ${dpiW.toFixed(1)}×${dpiH.toFixed(1)} dpi、${(fs.statSync(f).size / 1e6).toFixed(1)} MB、${sec} 秒`);
  }

  // 2 PNG と、星の位置
  await set({ paper: 'A4', dpi: 300, theme: 'navy' });
  await page.setChecked('#lines', false); await page.setChecked('#names', false);   // 線と文字を消して星だけで確かめる
  const pngFile = await download('#png');
  const png = new Uint8Array(fs.readFileSync(pngFile));
  const dv = Buffer.from(png);
  const pw = dv.readUInt32BE(16), ph = dv.readUInt32BE(20);
  ok('PNG A4・300 dpi の画素数と pHYs', pw === 2480 && ph === 3508 && PO.pngDpi(png) === 300, `${pw}×${ph} px、pHYs ${PO.pngDpi(png)} dpi`);
  // アルデバランは外す: ヒアデス星団の中にあり、6 px 先の白い星の芯の方が明るい（赤い星の芯は白く飽和しない）。光の中心は予測と 0〜2 px（2026-10-03 に画素で確かめた）
  const names = ['シリウス', 'ベテルギウス', 'リゲル', 'プロキオン', 'カペラ', 'ポルックス', 'カストル', 'ベガ', 'デネブ', 'アルタイル', 'レグルス', 'スピカ', 'アークトゥルス', 'アンタレス', 'フォーマルハウト'];
  const where = await page.evaluate((ns) => ns.map((n) => [n, window.__poster.where(n, 300)]), names);
  const b64 = png.length ? Buffer.from(png).toString('base64') : '';
  const found = await page.evaluate(async ({ b64, where }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    return where.filter(([, p]) => p && p.alt > 3).map(([n, p]) => {
      // 予測した点のまわり 12 px の中（となりの星を拾わない広さ。1 等星の白い芯は半径 8 px ほど）
      const R = 12, d = g.getImageData(Math.round(p.x) - R, Math.round(p.y) - R, 2 * R + 1, 2 * R + 1).data;
      // 明るい星の芯は白く飽和した円盤なので、最大値の 97% 以上の画素の重心を芯の位置とする
      let best = -1; const v = (x, y) => { const i = (y * (2 * R + 1) + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
      for (let y = 0; y <= 2 * R; y++) for (let x = 0; x <= 2 * R; x++) best = Math.max(best, v(x, y));
      let sx = 0, sy = 0, k = 0;
      for (let y = 0; y <= 2 * R; y++) for (let x = 0; x <= 2 * R; x++) if (v(x, y) >= best * 0.97) { sx += x - R; sy += y - R; k++; }
      const bx = sx / k, by = sy / k;
      return { n, dist: Math.hypot(bx + Math.round(p.x) - p.x, by + Math.round(p.y) - p.y), best, alt: p.alt };
    });
  }, { b64, where });
  // 空の色（2 回目以降の描画で空が黒くなる不具合の見張り。描画器の属性の切り忘れ。2026-10-03 に直した）: 円の中の空の中央値が濃紺（青 > 25）
  const lay300 = PO.layout({ paper: 'A4', dpi: 300 });
  const skyBlue = await page.evaluate(async ({ b64, c }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const vals = []; for (let i = 0; i < 200; i++) { const a = i * 2.4, r = c.d * 0.45 * Math.sqrt(i / 200); vals.push(g.getImageData(Math.round(c.cx + r * Math.cos(a)), Math.round(c.cy + r * Math.sin(a)), 1, 1).data[2]); }
    vals.sort((p, q) => p - q); return vals[100];
  }, { b64, c: lay300.circle });
  ok('空の色が濃紺（書き出しの空が黒くない）', skyBlue > 25, `円の中の青の中央値 ${skyBlue}`);
  const far = found.filter((f) => f.dist > 3 || f.best < 600);
  ok('同じ星が同じ位置（予測した画素から 3 px 以内に星の芯）', found.length >= 6 && !far.length,
    found.map((f) => `${f.n} ${f.dist.toFixed(1)}px`).join('・'));

  // 4 見本のスクショ（白・B5・ゴシック、A3 濃紺）
  await page.setChecked('#lines', true); await page.setChecked('#names', true);
  for (const [o, file] of [[{ paper: 'B5', dpi: 300, theme: 'white', font: 'gothic' }, 'preview-b5-white.png'], [{ paper: 'A3', dpi: 350, theme: 'navy', font: 'mincho' }, 'preview-a3-navy.png']]) {
    await set(o); await page.waitForTimeout(300);
    await page.locator('#preview').screenshot({ path: path.join(OUT, file) });
  }
  const desk = await ctx.newPage();
  await desk.setViewportSize({ width: 1280, height: 900 });
  await desk.goto(base); await desk.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  await desk.screenshot({ path: path.join(OUT, 'desktop.png') });
  ok('外向きの要求はビーコンだけ（止めた）・スクリプトの誤り無し', outside.every((h) => h === 'static.cloudflareinsights.com') && !errors.length, `外: ${[...new Set(outside)].join(', ') || 'なし'}、誤り ${errors.length}`);

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  await browser.close(); srv.close();
  const ng = results.filter((r) => !r.pass).length;
  console.log(ng ? `${ng} 件 NG` : 'すべて OK'); process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
