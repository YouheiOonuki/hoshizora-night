// キーボードで星を選ぶ・クイズに答える（Q-438）の確認。CI では走らせない（ブラウザが要る）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=<ブラウザの置き場> node tools/check-keyboard.cjs
// 1. Tab で空の絵へ → 矢印キーで見まわし（左 → 右で元へ）→ Enter で解説が出る（星 3 つ）。まん中の的は出ていて、マウスで触ると消える
// 2. クイズ: ヒントで答えの星座へ寄せ、空の絵で Enter → 1 問答えて正解が 1 つ増え、次の問いへ
// 3. まん中から選んだもの ＝ 同じ点をマウスで押したときに選ばれるもの（10 の向き）
'use strict';
const { chromium } = require('playwright');
const { serve } = require('./serve.cjs');

const BLOCK = /cloudflareinsights|googlesyndication|doubleclick/;
const Q = '?t=2027-01-15T21:00:00%2B09:00&loc=tokyo&probe=off';
// J2000 の赤経・赤緯（度）
const STARS = [['シリウス', 101.287, -16.716], ['ベテルギウス', 88.793, 7.407], ['リゲル', 78.634, -8.202]];
const VIEWS = [[101.3, -16.7], [88.8, 7.4], [78.6, -8.2], [114.8, 5.2], [79.2, 46.0], [68.98, 16.5], [56.9, 24.1], [113.6, 31.9], [95.0, 20.0], [83.0, -1.0]];

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.route(BLOCK, (r) => r.abort());
  const out = []; let fail = 0;
  const check = (name, ok, info) => { if (!ok) fail++; out.push({ name, ok, ...info }); };
  const open = async () => { await p.goto(base + Q); await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.waitForTimeout(300); };
  const toCanvas = async () => { for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => document.activeElement && document.activeElement.id === 'sky')) return true; } return false; };
  const center = () => p.evaluate(() => { const b = document.getElementById('sky').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const aimShown = () => p.evaluate(() => !document.getElementById('aim').hidden);

  // 1
  await open();
  check('Tab で空の絵へ', await toCanvas(), {});
  check('的が出る', await aimShown(), {});
  for (const [name, ra, dec] of STARS) {
    await p.keyboard.press('Escape');
    if (!(await p.evaluate(() => document.activeElement.id === 'sky'))) await toCanvas();
    await p.evaluate(([a, d]) => window.__night.lookAt(a, d), [ra, dec]);
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(100);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => ({ sheet: window.__night.sheet, picked: window.__night.picked, body: (document.getElementById('sheetBody').textContent || '').slice(0, 30), live: document.getElementById('sheetBody').getAttribute('aria-live') }));
    check(`Enter で解説: ${name}`, r.sheet === 'star' && (r.picked || '').startsWith(name) && r.live === 'polite', r);
  }
  const c = await center();
  await p.mouse.move(c.x + 200, c.y); await p.mouse.down(); await p.mouse.up();
  check('マウスで触ると的が消える', !(await aimShown()), {});

  // 2
  await open();
  await p.click('#quiz');
  await p.waitForFunction(() => !document.getElementById('quizBar').hidden);
  const q1 = await p.textContent('#qNum');
  await p.click('#qHint');
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById('sky').focus());
  await p.keyboard.press('Enter');
  const sc = await p.evaluate(() => window.__night.quizScore());
  await p.waitForFunction((a) => document.getElementById('qNum').textContent !== a, q1, { timeout: 4000 }).catch(() => {});
  const q2 = await p.textContent('#qNum');
  check('クイズに Enter で答える', sc === 1 && q1 !== q2, { q1, q2, score: sc });

  // 3
  await open();
  for (const [ra, dec] of VIEWS) {
    const set = () => p.evaluate(([a, d]) => { window.__night.lookAt(a, d); }, [ra, dec]);
    await p.keyboard.press('Escape'); await set(); await p.waitForTimeout(120);
    await p.evaluate(() => document.getElementById('sky').focus());
    await p.keyboard.press('Enter'); await p.waitForTimeout(80);
    const k = await p.evaluate(() => ({ sheet: window.__night.sheet, picked: window.__night.picked }));
    await p.keyboard.press('Escape'); await set(); await p.waitForTimeout(120);
    const m = await center();
    await p.mouse.move(m.x, m.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(80);
    const t = await p.evaluate(() => ({ sheet: window.__night.sheet, picked: window.__night.picked }));
    check(`まん中 ＝ 押した点 (${ra}, ${dec})`, k.sheet === t.sheet && k.picked === t.picked && !!k.sheet, { key: k, tap: t });
  }

  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  console.log(fail ? `FAIL ${fail}` : 'OK');
  process.exit(fail ? 1 : 0);
})();
