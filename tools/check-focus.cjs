// キーボードのフォーカスの輪の確認（night.css の :focus-visible）。CI では走らせない（ブラウザが要る）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-focus.cjs [スクショの出力先]
// Tab を押すと、フォーカスの来た部品に 2px の輪が出る／マウスのクリックでは出ない、を見る
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'focus-check'));
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick/;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.route(BLOCK, (r) => r.abort());
  const ring = () => p.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, text: (e.textContent || '').trim().slice(0, 20), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }; });
  const out = [];
  let fail = 0;
  for (const url of ['', 'en/']) {
    await p.goto(base + url);
    await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
    for (let i = 1; i <= 3; i++) {
      await p.keyboard.press('Tab');
      const r = await ring();
      const ok = r.style === 'solid' && r.width === '2px' && r.color === 'rgb(255, 217, 138)';
      if (!ok) fail++;
      out.push({ url: url || 'ja', tab: i, ok, ...r });
      if (i === 1) await p.screenshot({ path: path.join(OUT, `tab1-${url ? 'en' : 'ja'}.png`) });
    }
    // マウスのクリックでは輪が出ない
    await p.goto(base + url);
    await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const chip = p.locator('.chip, .dock button').first();
    await chip.click();
    const style = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    const ok = style === 'none';
    if (!ok) fail++;
    out.push({ url: url || 'ja', click: true, ok, style });
  }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  await browser.close(); srv.close();
  console.log(fail ? `FAIL ${fail}` : 'OK');
  process.exit(fail ? 1 : 0);
})();
