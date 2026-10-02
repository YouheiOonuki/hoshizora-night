'use strict';
// どのページも広告なし（AdSense は所有確認の meta だけ）・Cloudflare の計測は他のツールと同じ・準備中は noindex（ACCEPTANCE A4）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'tech/index.html', 'sketches/a.html', 'sketches/b.html', 'sketches/c.html'];
const BEACON = `data-cf-beacon='{"token": "b79bf821e1fd4b6683866d493b1de426"}'`;

for (const p of PAGES) {
  test(`${p}: 広告の script なし・meta あり・計測あり・noindex`, () => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(!/adsbygoogle|pagead2\.googlesyndication/.test(html), '広告の script がある');
    assert.ok(html.includes('<meta name="google-adsense-account" content="ca-pub-5375267956079717">'));
    assert.ok(html.includes(BEACON));
    assert.ok(/<meta name="robots" content="noindex/.test(html));
  });
}

test('WebGL を使うページはすべて gate.js で通常版へ送れる', () => {
  for (const p of PAGES.filter((x) => x !== 'index.html')) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(html.includes('render/gate.js') && html.includes('id="nogl"') && html.includes('href="/hoshizora-sanpo/"'), p);
  }
});

test('ページは engine/ の写しを読む（通常版の計算を別に持たない）', () => {
  for (const p of PAGES.filter((x) => x !== 'index.html')) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(html.includes('../engine/astro.js') && html.includes('../engine/catalog.js'), p);
  }
  // render/ に歳差や恒星時の式の定数を持たない
  const sky = fs.readFileSync(path.join(ROOT, 'render/sky.js'), 'utf8');
  assert.ok(!/2306\.2181|18\.697374558|24\.0657098/.test(sky));
});
