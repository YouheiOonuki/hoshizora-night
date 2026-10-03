// 空の上の名前（星座名・星名・惑星・大三角）が、左上の文字（日時・場所・向き）・右上の今夜の出来事・下のボタン列に重ならないことを確かめる。
// CI では走らせない（ブラウザが要る）。ずらす・隠す決まりそのものは tests/look.test.js（L.avoidShift）で node --test が見る。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-overlap.cjs [スクショの出力先]
// スマホ（iPhone 13 の 390×844・360×740）と PC（1440×900）で、季節（2・4・8・12 月）と向き（北・東・南・西・天頂寄り）を変えて見る。
// 失敗すると終了コード 1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { serve } = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'k132ov'));
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick|google-analytics|googletagmanager/;
const ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const DEVICES = {
  iphone: { ...devices['iPhone 13'] },
  small: { ...devices['iPhone 13'], viewport: { width: 360, height: 740 } },
  pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
// 東京の夜（unixtime）と向き（?view=方位°,高度°）
const CASES = [
  { name: 'dec-s', t: 1797256800, view: '180,30' },   // 2026-12-14 23:00 南（ぎょしゃ座・オリオン座が上の方）
  { name: 'dec-n', t: 1797256800, view: '0,40' },
  { name: 'feb-e', t: 1801823400, view: '90,35' },    // 2027-02-05 19:30 東
  { name: 'apr-w', t: 1807356600, view: '270,30' },   // 2027-04-10 20:30 西
  { name: 'aug-s', t: 1786536000, view: '180,55' },   // 2026-08-12 21:00 南の高い所（夏の大三角）
];
const over = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ARGS });
  const bad = [], rows = [];
  for (const [dev, opt] of Object.entries(DEVICES)) {
    const ctx = await browser.newContext({ ...opt, reducedMotion: 'reduce' });   // 演出を止め、時刻を固定する
    await ctx.route(BLOCK, (r) => r.abort());
    const p = await ctx.newPage();
    for (const c of CASES) for (const lang of ['ja', ...(c.name === 'dec-s' ? ['en'] : [])]) {
      await p.goto(`${base}${lang === 'en' ? 'en/' : ''}?probe=off&view=${c.view}#35.69,139.69,${c.t}`);
      await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await p.waitForTimeout(900);
      const { ui, labels } = await p.evaluate(() => window.__night.labelRects());
      const hits = [];
      for (const l of labels) for (const u of ui) if (over(l, u)) hits.push(l.t);
      const id = `${dev}-${c.name}${lang === 'en' ? '-en' : ''}`;
      rows.push(`${id}: 名前 ${labels.length} 個・UI ${ui.length} 個・重なり ${hits.length}`);
      if (hits.length) bad.push(`${id}: ${[...new Set(hits)].join('、')}`);
      await p.screenshot({ path: path.join(OUT, `${id}.png`) });
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(rows.join('\n'));
  if (bad.length) { console.error('重なりあり:\n' + bad.join('\n')); process.exit(1); }
  console.log(`OK（スクショ: ${OUT}）`);
})().catch((e) => { console.error(e); process.exit(1); });
