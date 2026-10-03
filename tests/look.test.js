'use strict';
// 見せ方の決まり（ROADMAP 7.15.1 の 10 項目）を数値で確かめる。render/look.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../render/look.js');
const O = require('../engine/official-events.js');
const { BODY_INFO } = require('../engine/data.js');
const P = require('../render/prefectures.js');

const TOKYO = P.PREFS.find((p) => p.name === '東京都');

test('1 空の色: 天頂 #050a1e・地平線 #1b2a52・薄明 #3a4a7a・地面 #060810・20 分', () => {
  assert.deepStrictEqual([L.SKY.zenith, L.SKY.horizon, L.SKY.twilight, L.SKY.ground, L.SKY.twilightMinutes], ['#050a1e', '#1b2a52', '#3a4a7a', '#060810', 20]);
});

test('1 薄明の重み: 昼と薄明は 1、深夜は 0、夜の色に移るのは約 20 分', () => {
  const day = Date.parse('2026-12-15T12:00:00+09:00'), night = Date.parse('2026-12-15T23:00:00+09:00');
  assert.strictEqual(L.twilightWeight(day, TOKYO.lat, TOKYO.lon), 1);
  assert.strictEqual(L.twilightWeight(night, TOKYO.lat, TOKYO.lon), 0);
  // 夕方: 1 → 0 に変わるまでの時間（1 分きざみ）
  let first = null, last = null;
  for (let t = Date.parse('2026-12-15T16:00:00+09:00'); t < Date.parse('2026-12-15T19:00:00+09:00'); t += 60e3) {
    const w = L.twilightWeight(t, TOKYO.lat, TOKYO.lon);
    if (w < 1 && first == null) first = t;
    if (w > 0) last = t;
  }
  const minutes = (last - first) / 60e3 + 1;
  assert.ok(minutes >= 19 && minutes <= 21, `${minutes} 分`);
});

test('2 にじみの半径（オーナー決定 2026-10-03 で 7.15.1 より大きく）: 0 等 10・1 等 7.5・2 等 5・3 等 3.5・4 等 2.5・5 等 1.8・6 等 1.4', () => {
  assert.deepStrictEqual([-1.46, 0, 1, 2, 3, 4, 5, 6, 6.5].map(L.haloRadius), [10, 10, 7.5, 5, 3.5, 2.5, 1.8, 1.4, 1.4]);
  // 明るい星ほど大きい（逆転しない）
  for (let m = -1.5; m < 6.5; m += 0.1) assert.ok(L.haloRadius(m) >= L.haloRadius(m + 0.1));
});

test('2 星の色: B−V から、彩度 35% 以内（オーナー決定 2026-10-03。7.15.1 は 20%）', () => {
  const { CATALOG } = require('../engine/catalog.js');
  const { CATALOG_EXTRA } = require('../render/catalog-extra.js');
  let max = 0;
  for (const C of [CATALOG, CATALOG_EXTRA]) for (let i = 3; i < C.length; i += 4) max = Math.max(max, L.saturation(L.starColor(C[i] / 100)));
  assert.strictEqual(L.MAX_SAT, 0.35);
  assert.ok(max <= L.MAX_SAT + 1e-9, String(max));
  assert.ok(max > 0.3, '色が薄すぎる');
  // 青い星は青寄り、赤い星は赤寄り
  const b = L.starColor(-0.3), r = L.starColor(1.8);
  assert.ok(b[2] > b[0] && r[0] > r[2]);
});

test('2 またたき: 3 等より明るい星だけ、±10%、0.5〜1 Hz', () => {
  assert.strictEqual(L.twinkles(2.99), true);
  assert.strictEqual(L.twinkles(3), false);
  assert.strictEqual(L.TWINKLE.amp, 0.1);
  for (const s of [0, 0.3, 0.999]) { const f = L.twinkleHz(s); assert.ok(f >= 0.5 && f <= 1, String(f)); }
});

test('3 日周運動: 1 秒 ＝ 1 分（60 倍）。4 ピンチは 1〜3 倍。線は #8fb0ff・30%・1 秒', () => {
  assert.strictEqual(L.SPEED, 60);
  assert.deepStrictEqual(L.ZOOM, { min: 1, max: 3 });
  assert.deepStrictEqual(L.LINE, { color: '#a8c4ff', alpha: 0.7, fadeMs: 1000, widthCss: 1.5 });
});

test('場所の表示: 位置情報は最寄りの都道府県庁＋付近と緯度経度、遠ければ緯度経度だけ、選んだ所はその名前', () => {
  assert.deepStrictEqual(L.placeText({ id: 'here', lat: 35.66, lon: 139.7 }, P.PREFS, false), { main: '東京都付近', sub: '北緯35.7° 東経139.7°' });
  assert.deepStrictEqual(L.placeText({ id: 'here', lat: 35.66, lon: 139.7 }, P.PREFS, true), { main: 'Near Tokyo', sub: '35.7°N 139.7°E' });
  assert.deepStrictEqual(L.placeText({ id: 'here', lat: 43.1, lon: 141.3 }, P.PREFS, false).main, '北海道付近');
  assert.deepStrictEqual(L.placeText({ id: 'here', lat: 51.5, lon: -0.1 }, P.PREFS, true), { main: '51.5°N 0.1°W', sub: '' });
  assert.deepStrictEqual(L.placeText({ id: 'shared', lat: -33.87, lon: 151.21 }, P.PREFS, false), { main: '南緯33.9° 東経151.2°', sub: '' });
  assert.deepStrictEqual(L.placeText(P.PREFS[46], P.PREFS, false), { main: '沖縄県', sub: '' });
  assert.ok(Math.abs(L.kmBetween({ lat: 35.69, lon: 139.69 }, { lat: 34.69, lon: 135.52 }) - 397) < 5, '東京〜大阪 約 400 km');
});

test('わぁきれい（オーナー決定 2026-10-03）: 6.5 等まで・演出 3.5 秒・流れ星は平均 30 秒（極大の夜 10 秒）・山並み 0〜3°・星座線を全部', () => {
  assert.strictEqual(L.STAR_LIMIT, 6.5);
  assert.ok(L.INTRO.ms >= 3000 && L.INTRO.ms <= 4000);
  // 指数分布の平均（決まった乱数列で）
  const mean = (peak) => { let s = 0; for (let i = 1; i < 2000; i++) s += L.meteorWait(i / 2000, peak); return s / 1999; };
  assert.ok(Math.abs(mean(false) - 30) < 2 && Math.abs(mean(true) - 10) < 1, `${mean(false)} ${mean(true)}`);
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 2 * Math.PI; a += 0.01) { const h = L.hillDeg(a); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  assert.ok(lo === 0 && hi > 1.5 && hi < 3, `${lo} ${hi}`);
  assert.ok(L.LINES_ALL_ALPHA < L.LINE.alpha);
});

test('5 英語の UI 文字列は 20 語以内', () => {
  const n = L.wordCount(L.TEXT.en);
  assert.ok(n <= 20, `${n} 語`);
  assert.deepStrictEqual(Object.keys(L.TEXT.en).sort(), Object.keys(L.TEXT.ja).sort());
});

test('8 共有の # は #lat,lon,unixtime で、行って戻ると同じ', () => {
  const ms = Date.parse('2026-12-14T23:00:00+09:00');
  const h = L.formatHash(35.69, 139.69, ms);
  assert.strictEqual(h, '#35.69,139.69,1797256800');
  assert.deepStrictEqual(L.parseHash(h), { lat: 35.69, lon: 139.69, ms });
  assert.strictEqual(L.parseHash('#91,0,1'), null);
  assert.strictEqual(L.parseHash('#a,b,c'), null);
  assert.strictEqual(L.parseHash(''), null);
  assert.strictEqual(L.shareUrl('https://yorozu-craft.com', 'ja', ms, 'Asia/Tokyo', 35.69, 139.69), 'https://yorozu-craft.com/hoshizora-night/m/12/#35.69,139.69,1797256800');
  // 月は「その土地の月」: 日本の 1 月 1 日 0 時半は、ロンドンではまだ 12 月
  const ny = Date.parse('2027-01-01T00:30:00+09:00');
  assert.ok(L.shareUrl('', 'en', ny, 'Europe/London', 51.51, -0.13).includes('/en/m/12/'));
  assert.ok(L.shareUrl('', 'ja', ny, 'Asia/Tokyo', 35.69, 139.69).includes('/m/01/'));
});

test('9 動かない端末: 24 fps 未満で 4 等まで → それでも未満なら通常版へ', () => {
  assert.strictEqual(L.nextStage('full', 30), 'full');
  assert.strictEqual(L.nextStage('full', 23.9), 'reduced');
  assert.strictEqual(L.nextStage('reduced', 25), 'reduced');
  assert.strictEqual(L.nextStage('reduced', 10), 'light');
  assert.strictEqual(L.FPS.reducedMag, 4);
  assert.strictEqual(L.FPS.probeMs, 3000);
  assert.strictEqual(L.median([16, 50, 17]), 17);
  assert.strictEqual(L.median([10, 20, 30, 40]), 25);
});

test('7 今夜の見どころ: 官製の表（official-events.js の写し）から、流星群・満月・惑星', () => {
  const at = (iso) => Date.parse(iso);
  assert.deepStrictEqual(L.tonight(at('2026-12-14T22:00:00+09:00'), O, BODY_INFO, 'ja').map((e) => e.title), ['ふたご座流星群が極大']);
  assert.deepStrictEqual(L.tonight(at('2026-12-15T02:00:00+09:00'), O, BODY_INFO, 'ja').map((e) => e.title), ['ふたご座流星群が極大'], '日付が変わっても同じ夜');
  assert.deepStrictEqual(L.tonight(at('2026-10-26T20:00:00+09:00'), O, BODY_INFO, 'ja').map((e) => e.title), ['満月']);
  assert.deepStrictEqual(L.tonight(at('2026-10-04T21:00:00+09:00'), O, BODY_INFO, 'ja').map((e) => e.title), ['土星が衝']);
  assert.deepStrictEqual(L.tonight(at('2026-10-04T21:00:00+09:00'), O, BODY_INFO, 'en').map((e) => e.title), ['Saturn at opposition']);
  assert.deepStrictEqual(L.tonight(at('2026-12-23T21:00:00+09:00'), O, BODY_INFO, 'ja').map((e) => e.title), ['満月（2026年で地球に最も近い満月）']);
  assert.deepStrictEqual(L.tonight(at('2026-12-23T21:00:00+09:00'), O, BODY_INFO, 'en').map((e) => e.title), ['Full moon (Closest full moon of 2026)']);
  assert.deepStrictEqual(L.tonight(at('2027-02-20T21:00:00+09:00'), O, BODY_INFO, 'en').map((e) => e.title), ['Full moon', 'Mars at opposition'], '同じ夜に 2 件');
  assert.deepStrictEqual(L.tonight(at('2026-10-10T21:00:00+09:00'), O, BODY_INFO, 'ja'), []);
  // 満月の瞬間が昼（12/24 10:28）なら前の夜（通常版の fullMoonView と同じ考え）
  // 2026-09-23〜2027-12-31 のどの夜も 3 件まで。流星群は全部どこかの夜に出る
  const seen = new Set();
  for (let t = at('2026-09-23T21:00:00+09:00'); t < at('2027-12-31T21:00:00+09:00'); t += 86400e3) {
    const ev = L.tonight(t, O, BODY_INFO, 'ja');
    assert.ok(ev.length <= 3);
    ev.forEach((e) => seen.add(e.title));
    for (const e of ev) assert.ok(O.SRC[e.src], `出典の無い見どころ ${e.title}`);
  }
  for (const m of O.METEOR_PEAKS) assert.ok(seen.has(`${L.SHOWERS[m.shower][0]}が極大`), m.shower);
});

test('6 場所: 都道府県庁 47 か所（日本の中・名前の重なりなし・確認日あり）', () => {
  assert.strictEqual(P.PREFS.length, 47);
  assert.match(P.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(new Set(P.PREFS.map((p) => p.name)).size, 47);
  assert.strictEqual(new Set(P.PREFS.map((p) => p.en)).size, 47);
  for (const p of P.PREFS) assert.ok(p.lat > 24 && p.lat < 46 && p.lon > 122 && p.lon < 146 && p.tz === 'Asia/Tokyo', p.name);
  assert.deepStrictEqual([P.PREFS[0].name, P.PREFS[46].name], ['北海道', '沖縄県']);
});
