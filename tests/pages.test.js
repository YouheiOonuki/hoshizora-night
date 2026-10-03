'use strict';
// ページの決まり（ACCEPTANCE A4・ROADMAP 7.15.1 の受け入れのうち、ファイルを読めば確かめられるもの）。
// 画面の動き（reduced motion・外向きの要求・iPhone の表示・fps の段階）は tools/check-k132.cjs（Playwright）で見る
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const L = require('../render/look.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const APP = ['index.html', 'en/index.html', ...MONTHS.map((m) => `m/${m}/index.html`), ...MONTHS.map((m) => `en/m/${m}/index.html`)];
const POSTER = ['poster/index.html'];   // K43（企画書 72）
const LAB = ['tech/index.html', 'sketches/a.html', 'sketches/b.html', 'sketches/c.html'];
const BEACON = `data-cf-beacon='{"token": "b79bf821e1fd4b6683866d493b1de426"}'`;
const BASE = 'https://yorozu-craft.com/hoshizora-night/';
const meta = (html, prop) => { const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)); return m && m[1]; };

for (const p of [...APP, ...POSTER, ...LAB]) {
  test(`${p}: 広告の script なし・所有確認の meta・計測のビーコン`, () => {
    const html = read(p);
    assert.ok(!/adsbygoogle|pagead2\.googlesyndication|doubleclick/.test(html), '広告の script がある');
    assert.strictEqual(html.split('<meta name="google-adsense-account" content="ca-pub-5375267956079717">').length, 2);
    assert.strictEqual(html.split(BEACON).length, 2);
    // 外へ読みに行く script は Cloudflare のビーコンだけ
    const ext = [...html.matchAll(/<script[^>]+src=['"](https?:)?\/\/([^'"/]+)/g)].map((m) => m[2]);
    assert.deepStrictEqual(ext, ['static.cloudflareinsights.com']);
  });
}

test('試し描き・技術確認は検索に出さない', () => {
  for (const p of LAB) assert.ok(/<meta name="robots" content="noindex/.test(read(p)), p);
});

test('入口（日英）は検索に出す: index, follow・canonical・hreflang 3 行・OGP・JSON-LD', () => {
  for (const [p, self] of [['index.html', BASE], ['en/index.html', `${BASE}en/`]]) {
    const html = read(p);
    assert.strictEqual(meta(html, 'robots'), 'index, follow', p);
    assert.ok(html.includes(`<link rel="canonical" href="${self}">`), p);
    for (const [hl, href] of [['ja', BASE], ['en', `${BASE}en/`], ['x-default', BASE]]) assert.ok(html.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`), `${p} ${hl}`);
    assert.strictEqual(meta(html, 'og:url'), self);
    assert.ok(meta(html, 'og:image').startsWith(`${BASE}og/`));
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.strictEqual(ld['@type'], 'WebApplication');
    assert.ok(meta(html, 'description').length > 20);
  }
});

test('月ごとのページ（共有の URL）は検索に出さず、canonical は入口。OG 画像はその月', () => {
  for (const m of MONTHS) for (const en of [false, true]) {
    const p = `${en ? 'en/' : ''}m/${m}/index.html`, html = read(p);
    assert.strictEqual(meta(html, 'robots'), 'noindex, follow', p);
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}${en ? 'en/' : ''}">`), p);
    assert.strictEqual(meta(html, 'og:image'), `${BASE}og/${m}.jpg`, p);
    assert.strictEqual(meta(html, 'og:url'), `${BASE}${en ? 'en/' : ''}m/${m}/`, p);
  }
});

test('ページはひな形（tools/build-pages.mjs）から作ったものと同じ', async () => {
  const { outputs } = await import('../tools/build-pages.mjs');
  for (const [rel, body] of outputs()) assert.strictEqual(read(rel), body, `${rel} が古い（node tools/build-pages.mjs）`);
});

test('sitemap: 入口の日英とポスター（月ごとのページは載せない）・hreflang つき', () => {
  const xml = read('sitemap.xml');
  assert.deepStrictEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [BASE, `${BASE}en/`, `${BASE}poster/`]);
  assert.ok(!xml.includes('/m/'));
  assert.ok(xml.includes('hreflang="en"'));
});

test('OG 画像: 月ごとに 12 枚、1200×630 の JPEG、合わせて 1 MB 以内', () => {
  const og = JSON.parse(read('og/og.json'));
  assert.strictEqual(og.months.length, 12);
  let total = 0;
  for (const m of og.months) {
    const buf = fs.readFileSync(path.join(ROOT, m.file));
    total += buf.length;
    assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${m.file} は JPEG ではない`);
    // SOF0/SOF2 から寸法を読む
    let i = 2, size = null;
    while (i < buf.length) {
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) { size = [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; break; }
      i += 2 + len;
    }
    assert.deepStrictEqual(size, [1200, 630], m.file);
  }
  assert.ok(total <= 1024 * 1024, `${total} バイト`);
  console.log(`  OG 画像 12 枚 合計 ${(total / 1024).toFixed(0)} KB`);
});

test('初回の読み込み: JS は gzip 後 600 KB 以内、画像は 1 MB 以内', () => {
  const html = read('index.html');
  let js = 0, raw = 0;
  for (const m of html.matchAll(/<script src="\/hoshizora-night\/([^"]+)"/g)) {
    const b = fs.readFileSync(path.join(ROOT, m[1])); raw += b.length; js += zlib.gzipSync(b, { level: 9 }).length;
  }
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) js += zlib.gzipSync(Buffer.from(m[1])).length;
  js += zlib.gzipSync(Buffer.from(html)).length;
  assert.ok(js <= 600 * 1024, `${js} バイト`);
  // 画面が読む画像はアイコンだけ（OG 画像は SNS が読む。上の試験で別に 1 MB 以内）
  const imgs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="\/hoshizora-night\/([^"]+)"/g)].map((m) => fs.statSync(path.join(ROOT, m[1])).size);
  const img = imgs.reduce((a, b) => a + b, 0);
  assert.ok(img <= 1024 * 1024, `${img} バイト`);
  console.log(`  JS ${(raw / 1024).toFixed(0)} KB → gzip 後 ${(js / 1024).toFixed(0)} KB（HTML を含む）、画像 ${(img / 1024).toFixed(0)} KB`);
});

test('外向きの要求を出すコードが無い（fetch・XMLHttpRequest・sendBeacon・WebSocket・EventSource）', () => {
  for (const f of ['app/night.js', 'app/poster.js', 'render/poster.js', 'render/look.js', 'render/night-gl.js', 'render/sky.js', 'render/gate.js', 'render/prefectures.js', 'render/catalog-extra.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\//.test(src), f);
  }
});

test('通常版と相互リンク: 「軽い版」は日本語 → /hoshizora-sanpo/、英語 → /hoshizora-sanpo/en/', () => {
  assert.ok(read('index.html').includes('<a id="light" href="/hoshizora-sanpo/">軽い版</a>'));
  assert.ok(read('en/index.html').includes('<a id="light" href="/hoshizora-sanpo/en/">Light version</a>'));
});

test('英語の画面の文字は TEXT.en（20 語以内）のものだけ', () => {
  const html = read('en/index.html');
  const body = html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  const texts = [...body.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter((s) => s && s !== '·' && s !== '×');
  const attrs = [...body.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set([...Object.values(L.TEXT.en).flat(), '日本語']);
  for (const s of [...texts, ...attrs]) assert.ok(allowed.has(s), `TEXT.en に無い文字列: ${s}`);
  assert.ok(L.wordCount(L.TEXT.en) <= 20);
});

test('WebGL を使うページはすべて gate.js で通常版へ送れる', () => {
  for (const p of [...APP, ...LAB]) {
    const html = read(p), en = p.startsWith('en/');
    assert.ok(html.includes('render/gate.js') && html.includes('id="nogl"') && html.includes(`href="${en ? '/hoshizora-sanpo/en/' : '/hoshizora-sanpo/'}"`), p);
  }
});

test('ページは engine/ の写しを読む（通常版の計算を別に持たない）', () => {
  for (const p of [...APP, ...POSTER, ...LAB]) {
    const html = read(p);
    assert.ok(/engine\/astro\.js/.test(html) && /engine\/catalog\.js/.test(html), p);
  }
  for (const f of ['render/sky.js', 'render/look.js', 'render/night-gl.js', 'app/night.js', 'render/poster.js', 'app/poster.js']) {
    assert.ok(!/2306\.2181|18\.697374558|24\.0657098|125\.1228|0\.9856474/.test(read(f)), `${f} に天文計算の定数がある`);
  }
});

test('ポスター（K43）: 検索に出す・canonical・名前などの文字を URL に書くコードが無い・フル版の描画器と星表を読む', () => {
  const html = read('poster/index.html');
  assert.strictEqual(meta(html, 'robots'), 'index, follow');
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}poster/">`));
  for (const f of ['render/night-gl.js', 'render/sky.js', 'engine/catalog.js', 'render/catalog-extra.js', 'render/poster.js', 'app/poster.js']) assert.ok(html.includes(`/hoshizora-night/${f}"`), f);
  const src = read('app/poster.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/history\.(push|replace)State|location\.hash\s*=|location\.(href|search)\s*=|localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), 'URL・保存に書くコードがある');
  // 日本語の入口から 1 行でつなぐ
  assert.ok(read('index.html').includes('<a href="/hoshizora-night/poster/">星空ポスター</a>'));
  assert.ok(!read('en/index.html').includes('/poster/'));
});
