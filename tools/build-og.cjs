// 共有用の OG 画像を月ごとに 12 枚つくる（ROADMAP 7.15.1 の 8。K124 の結果カードと共用できるよう、文字は入れず URL だけ）。
//   node tools/build-og.cjs --json     og/og.json だけ書く（ブラウザ不要。tools/build-pages.mjs が読む）
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/build-og.cjs   画像も撮る（og/01.jpg〜12.jpg）
// 絵: 東京（都庁）・各月 15 日 21 時（日本時間）の南の空を、フル版の描画器そのもので撮る（#lat,lon,unixtime で開いて止めた画面）。
// og.json の形（K124 が読む）: { width, height, entryMonth, months: [{ month, file, at, lat, lon, alt, altEn }] }
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OGDIR = path.join(ROOT, 'og');
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOKYO = { lat: 35.69, lon: 139.69 };   // render/prefectures.js の東京都
const YEAR = 2027;

function spec() {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    months.push({ month: m, file: `og/${mm}.jpg`, at: `${YEAR}-${mm}-15T21:00:00+09:00`, lat: TOKYO.lat, lon: TOKYO.lon,
      alt: `${m}月15日21時、東京の南の空`, altEn: `The southern sky over Tokyo at 9 p.m. on ${MON[m - 1]} 15` });
  }
  return { width: 1200, height: 630, entryMonth: 1, note: 'tools/build-og.cjs で作る。K124 の結果カードもこの 12 枚を使ってよい', months };
}

async function shoot(S) {
  const { serve } = require('./serve.cjs');
  const { chromium } = require('playwright');
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: S.width, height: S.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route(/cloudflareinsights|googlesyndication|doubleclick/, (r) => r.abort());
  for (const m of S.months) {
    const ms = Date.parse(m.at), page = await ctx.newPage();   // # だけ変えても読み直さないので、月ごとに新しいページ
    await page.goto(`${base}?probe=off#${m.lat.toFixed(2)},${m.lon.toFixed(2)},${ms / 1000}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.waitForFunction(() => !window.__night.loading(), null, { timeout: 30000 });   // 天の川の画像と月の地図を読み終えるまで
    // 文字は URL と、天の川の画像の出典（ESO の条件: 見える形でクレジット。企画書 74）だけ
    await page.addStyleTag({ content: '.hud,.tonight,.bottom,.corner,.labels,.toast,.dirs,.sheet{display:none!important} .ogmark{position:fixed;right:28px;bottom:22px;margin:0;text-align:right;font:500 22px/1.3 system-ui,sans-serif;color:#9fb2d8;letter-spacing:.02em} .ogmark small{display:block;font-size:14px;opacity:.8}' });
    await page.evaluate(() => { const p = document.createElement('p'); p.className = 'ogmark'; p.innerHTML = 'yorozu-craft.com/hoshizora-night<small>Milky Way: ESO/S. Brunier</small>'; document.body.appendChild(p); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ROOT, m.file), type: 'jpeg', quality: 82 });
    console.log('撮りました', m.file);
    await page.close();
  }
  await browser.close(); srv.close();
}

if (require.main === module) (async () => {
  const S = spec();
  fs.mkdirSync(OGDIR, { recursive: true });
  fs.writeFileSync(path.join(OGDIR, 'og.json'), JSON.stringify(S, null, 2) + '\n');
  if (!process.argv.includes('--json')) await shoot(S);
})().catch((e) => { console.error(e); process.exit(1); });

module.exports = { spec };
