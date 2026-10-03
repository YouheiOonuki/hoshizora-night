'use strict';
// 企画書 75（フル版だけの 8 つの機能、オーナー決定 2026-10-03）の決まりを数値で確かめる。render/wow.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../render/wow.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const D = Math.PI / 180;
const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

/* ---------- 1 ジャイロ ---------- */
test('1 偏角: WMM2025 の公式の検算値（NOAA の WMM2025_TestValues.txt、100 点）と偏角・伏角が 0.01° 以内', () => {
  let n = 0;
  for (const l of read('tests/fixtures/WMM2025_TestValues.txt').split('\n')) {
    if (!l.trim() || l[0] === '#') continue;
    const f = l.trim().split(/\s+/).map(Number);
    const r = W.magnetic(f[2], f[3], f[1], f[0]);
    assert.ok(angDiff(r.decl, f[4]) < 0.01, `${f[2]},${f[3]} 偏角 ${r.decl} ≠ ${f[4]}`);
    assert.ok(Math.abs(r.incl - f[5]) < 0.01, `${f[2]},${f[3]} 伏角`);
    n++;
  }
  assert.strictEqual(n, 100);
  // 日本は西偏（磁北が真北より西）: 東京 約 −8°、札幌は東京より大きく、那覇は小さい
  const ms = Date.parse('2026-10-03T00:00:00Z');
  const tokyo = W.declination(35.69, 139.69, ms), sapporo = W.declination(43.06, 141.35, ms), naha = W.declination(26.21, 127.68, ms);
  assert.ok(tokyo < -7 && tokyo > -9, String(tokyo));
  assert.ok(sapporo < tokyo && naha > tokyo, `${sapporo} ${naha}`);
  // 係数は生成物（出典と取得日つき）
  const src = read('render/wmm.js');
  assert.ok(src.includes('WMM-2025') && src.includes('ncei.noaa.gov') && src.includes('パブリックドメイン'));
  assert.strictEqual(require('../render/wmm.js').COF.length, 90);
});

test('1 端末の向き → 方位・高度: 立てて北に向ける・東へ回す・真上・画面の回転', () => {
  const v = (a, b, g, s) => { const r = W.deviceView(a, b, g, s); return [r.az / D, r.alt / D]; };
  const close = ([az, alt], [az2, alt2], msg) => { assert.ok(angDiff(az, az2) < 0.01 && Math.abs(alt - alt2) < 0.01, `${msg}: ${az},${alt}`); };
  close(v(0, 90, 0), [0, 0], '縦に立てて北（背面が北）');
  // alpha は反時計回り（W3C）: alpha 90 は端末の上が西 → 立てると背面は西（方位 270）
  close(v(90, 90, 0), [270, 0], 'alpha 90');
  close(v(270, 90, 0), [90, 0], 'alpha 270 は東');
  close(v(0, 135, 0), [0, 45], '45° 見上げる');
  assert.ok(v(0, 180, 0)[1] > 89.9, '画面を下に向けると背面は真上');
  close(v(0, 0, 0), [0, -90], '机に置くと背面は真下');   // 方位は端末の上（北）の向きで決める（少し起こすと北の地平線へ続く）
  // 横持ち（画面を 90° 回す）でも、背面が向く所は同じ
  close(v(0, 90, 0, 90), [0, 0], '横持ち');
});

test('1 iPhone のコンパス: 水平に近いときだけ差を測り直し、なめらかに追う。精度が悪いと 8 の字の案内', () => {
  assert.strictEqual(W.compassOffset(null, 10, 5, 5, 350), 0);          // 360 − 350 − 10
  assert.strictEqual(W.compassOffset(null, 0, 5, 5, 90), -90);
  assert.strictEqual(W.compassOffset(12, 0, 80, 0, 90), 12, '立てているときは前の差のまま');
  const o = W.compassOffset(0, 0, 0, 0, 350);                           // 10 へ 15% だけ寄る
  assert.ok(Math.abs(o - 1.5) < 1e-9, String(o));
  assert.strictEqual(W.compassOffset(5, 0, 0, 0, null), 5);
  assert.ok(W.needCalibration(-1) && W.needCalibration(40) && !W.needCalibration(10) && !W.needCalibration(null));
  // 追従: 方位は近いほうへ（350° → 10° は 0° を越えて回る）
  const a = W.follow(350 * D, 10 * D, 0.5, true) / D;
  assert.ok(Math.abs(a - 0) < 1e-9 || Math.abs(a - 360) < 1e-9, String(a));
});

test('1 画面: iPhone は押したときに許可を求め、拒否・非対応・イベントが来ないならドラッグのまま。磁北に偏角を足す', () => {
  const app = read('app/night.js');
  assert.ok(app.includes('DOE.requestPermission()') && app.includes("toast(wt('gyroDenied'))"));
  assert.ok(app.includes('WOW.declination(place.lat, place.lon, sim)'));
  assert.ok(app.includes("'deviceorientationabsolute'") && app.includes('webkitCompassHeading'));
  assert.ok(/WOW\.GYRO\.noEventMs/.test(app), 'イベントが来ないときの時間切れ');
  assert.ok(app.includes('const k = reduce.matches ? 1 : WOW.GYRO.smooth'), 'reduced motion ではなめらかに追わない');
  for (const p of ['index.html', 'en/index.html']) assert.ok(read(p).includes('id="gyro"') && read(p).includes('render/wow.js') && read(p).includes('render/wmm.js'), p);
});

/* ---------- 2 街明かり ---------- */
test('2 街明かり: 空の明るさ → 限界等級は Schaefer (1990) の式。田舎は今までと同じ 6.5 等まで、都会ほど暗い星と天の川が消える', () => {
  // 式の検算（Unihedron の換算表の式: NELM = 7.93 − 5·log10(10^(4.316 − B/5) + 1)）
  assert.ok(Math.abs(W.nelm(21.9) - 6.579) < 0.001 && Math.abs(W.nelm(18.0) - 3.968) < 0.001, `${W.nelm(21.9)} ${W.nelm(18.0)}`);
  const dark = W.lightPollution(0), city = W.lightPollution(1);
  assert.ok(dark.limit >= 6.5, '田舎（つまみの左端）は追加の星表の 6.5 等まで全部（今までと同じ見え方）');
  assert.strictEqual(dark.milky, 1); assert.strictEqual(dark.glow, 0);
  assert.ok(city.limit < 4 && city.milky === 0 && city.glow === 1);
  // 明るくするほど、限界等級・天の川は下がり、空の光は増える（逆転しない）
  for (let i = 0; i < W.LIGHT.steps; i++) {
    const a = W.lightPollution(i / W.LIGHT.steps), b = W.lightPollution((i + 1) / W.LIGHT.steps);
    assert.ok(b.limit < a.limit && b.milky <= a.milky && b.glow > a.glow, String(i));
  }
  // 画面: 限界等級に効かせ、天の川の濃さ・空の色にも
  const app = read('app/night.js'), gl = read('render/night-gl.js');
  assert.ok(app.includes('lp.limit + 0.1') && app.includes('* lp.milky') && app.includes('city: lp.glow'));
  assert.ok(gl.includes('uniform float uCity') && gl.includes('if (uCity > 0.0)'));
  for (const p of ['index.html', 'en/index.html']) assert.ok(read(p).includes('id="lightSlider"') && read(p).includes('id="lightPanel"'), p);
});

/* ---------- 共通 ---------- */
test('文字: 日英で項目が揃い、英語はすべて k132-wow2-en-review.md の承認待ちの文（新しく書いた英語はここだけ）', () => {
  assert.deepStrictEqual(Object.keys(W.TEXT.en).sort(), Object.keys(W.TEXT.ja).sort());
  for (const [k, v] of Object.entries(W.TEXT.ja)) assert.ok(Array.isArray(v) && v.length === 2, `${k} は [おとな, ひらがな]`);
  const ok = (v) => (typeof v === 'string' && /[A-Za-z]/.test(v)) || (typeof v === 'function' && /[A-Za-z]/.test(v(1, 2, 3))) || (Array.isArray(v) && v.every(ok));
  for (const [k, v] of Object.entries(W.TEXT.en)) assert.ok(ok(v), k);
});

test('保存しない・音なし・外向きの要求なし（render/wow.js）', () => {
  const src = read('render/wow.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|new Audio|AudioContext|\bfetch\s*\(|XMLHttpRequest|https?:\/\//.test(src));
});
