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

/* ---------- 3 星座絵 ---------- */
test('3 星座絵: ヘヴェリウスの図の星の印が、網を通すと星表の同じ星に 0.15° 以内で重なる（主要 4 星座）', () => {
  const { ART, CREDIT } = require('../render/art.js');
  const { CATALOG } = require('../engine/catalog.js');
  assert.deepStrictEqual(ART.map((a) => a.con), ['ori', 'gem', 'leo', 'uma']);
  const S = require('../render/sky.js');
  for (const a of ART) {
    const n = a.mesh + 1;
    assert.strictEqual(a.verts.length, n * n * 3, a.id);
    assert.ok(a.source.startsWith('https://commons.wikimedia.org/wiki/File:'), a.id);
    const at = (u, v) => {   // 網の上の位置（画像の 0〜1）→ 空の向き（四隅の頂点の双一次補間）
      const x = u * a.mesh, y = v * a.mesh, i = Math.min(a.mesh - 1, Math.floor(x)), j = Math.min(a.mesh - 1, Math.floor(y)), fx = x - i, fy = y - j;
      const V = (ii, jj) => a.verts.slice(((jj * n) + ii) * 3, ((jj * n) + ii) * 3 + 3);
      const p = [0, 1, 2].map((k) => V(i, j)[k] * (1 - fx) * (1 - fy) + V(i + 1, j)[k] * fx * (1 - fy) + V(i, j + 1)[k] * (1 - fx) * fy + V(i + 1, j + 1)[k] * fx * fy);
      const m = Math.hypot(...p); return p.map((x2) => x2 / m);
    };
    for (const s of a.stars) {
      // 組にした星は星表（engine/catalog.js）にある
      let found = false;
      for (let i = 0; i < CATALOG.length; i += 4) if (Math.abs(CATALOG[i] / 1000 * 15 - s.ra) < 0.001 && Math.abs(CATALOG[i + 1] / 100 - s.dec) < 0.001) found = true;
      assert.ok(found, `${a.id} ${s.name} が星表に無い`);
      if (s.px.some((x) => x < 0 || x > 1)) continue;   // 切り出した範囲の外（位置合わせにだけ使った星）
      const want = S.vec(s.ra * D, s.dec * D), got = at(s.px[0], s.px[1]);
      const sep = Math.acos(Math.min(1, want[0] * got[0] + want[1] * got[1] + want[2] * got[2])) / D;
      assert.ok(sep < 0.15, `${a.id} ${s.name} ${sep.toFixed(3)}°`);
    }
    assert.ok(a.residualDeg.median < 1, a.id);
  }
  assert.ok(CREDIT.ja.includes('ヘヴェリウス') && CREDIT.ja.includes('パブリックドメイン') && CREDIT.en.includes('public domain'));
});

test('3 星座絵: 画像は 1024 px 以内・合わせて 600 KB 以内で、押したときに初めて読む（入口の HTML は art.js を読まない）', () => {
  const { ART } = require('../render/art.js');
  let total = 0;
  for (const a of ART) {
    const b = fs.readFileSync(path.join(ROOT, a.file)); total += b.length;
    assert.ok(b[0] === 0xff && b[1] === 0xd8 && a.size[0] <= 1024, a.id);
  }
  assert.ok(total <= 600 * 1024, `${total}`);
  for (const p of ['index.html', 'en/index.html']) {
    const html = read(p);
    assert.ok(!html.includes('src="/hoshizora-night/render/art.js"') && html.includes('id="artBtn"') && html.includes('id="artCredit" hidden'), p);
  }
  const app = read('app/night.js');
  assert.ok(app.includes("sc.src = '/hoshizora-night/render/art.js'") && app.includes('r.loadArt('));
  // 作り方の道具に出典とライセンス
  const tool = read('tools/build-art.py');
  for (const s of ['Firmamentum Sobiescianum', 'Wikimedia Commons', 'Public Domain Mark', '1690']) assert.ok(tool.includes(s), s);
});

/* ---------- 4 星雲・星団へのズーム ---------- */
test('4 実写: ESA/Hubble の 3 枚（M42・M45・M31）。出典は各ページの Credit の文のまま、CC BY 4.0。画像は 2048 px 以内・合わせて 600 KB 以内', () => {
  const { DSO_IMAGES } = require('../render/dso.js');
  assert.deepStrictEqual(DSO_IMAGES.map((d) => d.id), ['m42', 'm45', 'm31']);
  let total = 0;
  for (const d of DSO_IMAGES) {
    assert.ok(/^https:\/\/esahubble\.org\/images\/[a-z0-9]+\/$/.test(d.page), d.id);
    assert.ok(d.credit.includes('NASA') && d.credit.includes('ESA'), d.id);
    const b = fs.readFileSync(path.join(ROOT, d.file)); total += b.length;
    assert.ok(b[0] === 0xff && Math.max(...d.size) <= 2048, d.id);
  }
  assert.ok(total <= 600 * 1024, String(total));
  // 位置と向き: ページの記載（M42 は北が上・30.03′ 角、M31 は北が右へ 125°・140.60′×32.88′）。M45 は星 7 つで決めた（残差 1′ 未満）
  const m42 = DSO_IMAGES[0], m45 = DSO_IMAGES[1], m31 = DSO_IMAGES[2];
  assert.ok(Math.abs(m42.ra - 83.79054) < 1e-4 && Math.abs(m42.dec + 5.41398) < 1e-4 && m42.rot === 0 && Math.abs(m42.w - 0.5005) < 1e-3);
  assert.ok(m31.rot === -125 && Math.abs(m31.w - 140.6 / 60) < 1e-3 && Math.abs(m31.h - 32.88 / 60) < 1e-3);
  assert.ok(m45.changed === true && m45.residualArcsec < 60 && Math.abs(m45.ra - 56.75) < 0.2 && Math.abs(m45.dec - 24.12) < 0.2);
  const tool = read('tools/build-dso.py');
  for (const s of ['esahubble.org/copyright', 'CC BY 4.0', 'heic0601a', 'opo0420a', 'heic2501a']) assert.ok(tool.includes(s), s);
});

test('4 向き: 画像の右の辺は北から東へ回した向き（M31 の長い軸は位置角 約 35°。銀河の長軸 約 38° と合う）、上の辺はそれと直交', () => {
  const { DSO_IMAGES } = require('../render/dso.js');
  const m31 = DSO_IMAGES[2], c = W.photoCorners(m31);
  const ra = m31.ra * D, dec = m31.dec * D, E = [-Math.sin(ra), Math.cos(ra), 0], N = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pa = (v) => { const d = v.map((x, i) => x - c.c[i]); return Math.atan2(dot(d, E), dot(d, N)) / D; };
  assert.ok(Math.abs(pa(c.right) - 35) < 1, String(pa(c.right)));
  assert.ok(Math.abs(Math.abs(pa(c.right) - pa(c.top)) - 90) < 0.5 || Math.abs(Math.abs(pa(c.right) - pa(c.top)) - 270) < 0.5);
  // 中心から右の辺までは幅の半分（度）
  const sep = (a, b) => Math.acos(Math.min(1, dot(a, b))) / D;
  assert.ok(Math.abs(sep(c.c, c.right) - m31.w / 2) < 1e-3 && Math.abs(sep(c.c, c.top) - m31.h / 2) < 1e-3);
  // M42（北が上）: 上の辺は真北、右の辺は西
  const m42 = DSO_IMAGES[0], c2 = W.photoCorners(m42);
  const r2 = m42.ra * D, d2 = m42.dec * D, E2 = [-Math.sin(r2), Math.cos(r2), 0], N2 = [-Math.sin(d2) * Math.cos(r2), -Math.sin(d2) * Math.sin(r2), Math.cos(d2)];
  const up = c2.top.map((x, i) => x - c2.c[i]), right = c2.right.map((x, i) => x - c2.c[i]);
  assert.ok(dot(up, N2) > 0 && Math.abs(dot(up, E2)) < 1e-9 && dot(right, E2) < 0);
});

test('4 拡大と時刻: 天体が画面に収まる拡大（上限 160 倍）、見にくいときは 36 時間のうちの見やすい時刻へ', () => {
  const { DSO_IMAGES } = require('../render/dso.js');
  for (const d of DSO_IMAGES) { const z = W.zoomFor(d, 100); assert.ok(z > 20 && z <= W.ZOOM_DEEP, `${d.id} ${z}`); }
  // 2026-10-03 21:00 JST 東京: M42 はまだ昇っていない → 夜半すぎ（高度 25° 以上・太陽 −12° 以下）へ
  const ms = Date.parse('2026-10-03T21:00:00+09:00'), t = W.viewTime(ms, 35.69, 139.69, 83.82, -5.39);
  assert.ok(t > ms && t < ms + 12 * 3600e3 && W.altOf(t, 35.69, 139.69, 83.82, -5.39) >= 25 && W.sunAlt(t, 35.69, 139.69) <= -12);
  // 北極に近い空では M42 は昇らない → null
  assert.strictEqual(W.viewTime(ms, 80, 0, 83.82, -5.39), null);
  // 画面: 開くと時間を止め、閉じると 3 倍以内へ戻る。点の大きさは 3 倍で止める（何十倍でも星は点）
  const app = read('app/night.js'), gl = read('render/night-gl.js');
  assert.ok(app.includes('deep = d; setPlaying(false)') && app.includes('if (st.zoom > L.ZOOM.max) flyBack()'));
  assert.ok(gl.includes('Math.min(st.zoom, st.pointZoom || 3)'));
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
