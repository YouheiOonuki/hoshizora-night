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

/* ---------- 5 星の軌跡 ---------- */
test('5 星の軌跡: 600 倍の早回し、暗くする量は 1/255 単位でためて持ち越す（8 ビットの絵でも消え残らない）。動きを減らす設定は 2 時間分を 1 枚に', () => {
  assert.strictEqual(W.TRAIL.speed, 600);
  // 60 fps で 1 秒ためると fadePerSec（0.08）にほぼ等しく、端数は持ち越す
  let acc = 0, total = 0;
  for (let i = 0; i < 60; i++) { const f = W.trailFade(acc, 1 / 60); acc = f.acc; total += f.fade; assert.ok(Math.abs(f.fade * 255 - Math.round(f.fade * 255)) < 1e-9); }
  assert.ok(Math.abs(total + acc - W.TRAIL.fadePerSec) < 1e-9 && acc < 1 / 255);
  // 一番明るい点が消えるまで 1 / 0.08 ≒ 12.5 秒 → 600 倍で 約 2 時間ぶん（30° ほど）の筋
  assert.ok(1 / W.TRAIL.fadePerSec * W.TRAIL.speed / 3600 > 1.5);
  // 長く止まっていた後の 1 フレーム（タブを戻したとき）でも一度に消さない
  assert.ok(W.trailFade(0, 30).fade <= 0.25 * W.TRAIL.fadePerSec + 1 / 255);
  const ts = W.trailTimes(1e12);
  assert.strictEqual(ts.length, W.TRAIL.staticSteps + 1);
  assert.strictEqual(ts[0], 1e12); assert.strictEqual(1e12 - ts[ts.length - 1], W.TRAIL.staticHours * 3600e3);
  // 描画: 明るい方を残す合成（EXT_blend_minmax）・暗くする四角は引き算・前もって掛けた色。画面: 低い端末では使わない、動きを減らす設定では時間を止める
  const gl = read('render/night-gl.js'), app = read('app/night.js');
  assert.ok(gl.includes("gl.getExtension('EXT_blend_minmax')") && gl.includes('gl.FUNC_REVERSE_SUBTRACT') && gl.includes('uPremul > 0.5'));
  assert.ok(app.includes("if (on && st.stage !== 'full') { toast(wt('trailSlow')); return; }"));
  assert.ok(app.includes("if (reduce.matches) { setPlaying(false); toast(wt('trailStatic')); }"));
  assert.ok(app.includes('const twinkleOn = !reduce.matches && !trail;'));
});

/* ---------- 6 双眼鏡・望遠鏡 ---------- */
test('6 双眼鏡・望遠鏡: 限界等級は口径の分だけ（5·log10(口径/7)）上がり星表の 8.5 等で止まる。実視界がちょうど円い視野に入る拡大', () => {
  // 田舎（6.58 等）: 50 mm で +4.27 等 → 星表の 8.5 等で止まる。都会（3.54 等）: 50 mm で 7.81 等
  assert.strictEqual(W.scopeLimit(6.58, 50), 8.5);
  assert.ok(Math.abs(W.scopeLimit(W.lightPollution(1).limit, 50) - (3.5413 + 5 * Math.log10(50 / 7))) < 1e-3);
  assert.ok(W.scopeLimit(3.5, 80) > W.scopeLimit(3.5, 50));
  // 拡大: 描画器の 1° あたりの画素（zoom/tan(fov/4)·短い辺/2·(π/180)/2）× 実視界 ＝ 円の直径（短い辺 × 0.9）
  for (const m of Object.values(W.SCOPE.modes)) {
    const z = W.scopeZoom(m.field, 100), minSide = 390;
    const pxPerDeg = z / Math.tan(100 * Math.PI / 720) * minSide / 2 * (Math.PI / 180) / 2;
    assert.ok(Math.abs(pxPerDeg * m.field - 2 * W.SCOPE.frac * minSide) < 1e-6);
    assert.ok(z <= W.ZOOM_DEEP);
  }
});

test('6 暗い星: ヒッパルコス星表（ESA、CC BY-NC 3.0 IGO）の 6.5〜8.5 等。BSC の星と重ならず、位置の丸めは 0.006° 以内。押したときに読む', () => {
  const { HIP } = require('../render/hip.js');
  const stars = W.decodeHip(HIP, (b) => Buffer.from(b, 'base64'));
  assert.strictEqual(stars.length, HIP.n);
  assert.ok(HIP.n > 50000);
  for (const s of stars) { assert.ok(s.mag > 6.5 && s.mag <= 8.51, String(s.mag)); assert.ok(Math.abs(Math.hypot(...s.v) - 1) < 1e-9); }
  // 明るい順に並ぶ
  for (let i = 1; i < stars.length; i++) assert.ok(stars[i].mag >= stars[i - 1].mag - 1e-9);
  // 丸め: 赤経 360°/65536 ＝ 0.0055°、赤緯 90°/32767 ＝ 0.0027°（どちらも 0.1° より十分小さい）
  assert.ok(360 / 65536 < 0.006 && 90 / 32767 < 0.003);
  const src = read('render/hip.js'), tool = read('tools/build-hip.py');
  assert.ok(src.includes('Credit: ESA') && src.includes('CC BY-NC 3.0 IGO') && tool.includes('I/239') && tool.includes('cosmos.esa.int/web/hipparcos'));
  for (const p of ['index.html', 'en/index.html']) {
    const html = read(p);
    assert.ok(!html.includes('src="/hoshizora-night/render/hip.js"') && html.includes('id="scopeBtn"') && html.includes('id="scopeMask"') && html.includes('id="hipCredit" hidden'), p);
  }
  const app = read('app/night.js');
  assert.ok(app.includes("sc.src = '/hoshizora-night/render/hip.js'") && app.includes("const faintOn = () => faintState === 'ok' && st.stage === 'full'"));
});

/* ---------- 7 イベントの再生 ---------- */
test('7 月食: 2026-03-03 の皆既月食で、計算の各時刻が国立天文台の発表（official-events.js の tokyo）と 5 分以内、食分 0.03 以内', () => {
  const O = require('../engine/official-events.js');
  const e = O.ECLIPSES.find((x) => x.date === '2026-03-03'), t = e.tokyo;
  const at = (hm) => Date.parse(`2026-03-03T${hm.split('.')[0].padStart(5, '0')}:00+09:00`) + Number('0.' + (hm.split('.')[1] || '0')) * 60e3;
  const c = W.eclipseContacts('2026-03-03');
  for (const [k, v] of [['u1', t.start], ['u2', t.totalStart], ['max', t.max], ['u3', t.totalEnd], ['u4', t.end]]) {
    assert.ok(Math.abs(c[k] - at(v)) <= 5 * 60e3, `${k} ${new Date(c[k] + 9 * 3600e3).toISOString().slice(11, 19)} ≠ ${v}`);
  }
  assert.ok(Math.abs(c.mag - Number(t.mag)) < 0.03, String(c.mag));
  // 影の大きさ（ダンジョンの規則）: 本影の半径 約 0.7°、半影 約 1.2°、月の半径 約 0.26°
  const s = W.eclipseAt(c.max);
  assert.ok(s.umbra > 0.65 && s.umbra < 0.75 && s.penumbra > 1.15 && s.penumbra < 1.3 && s.moonR > 0.24 && s.moonR < 0.28);
  // 皆既の間は月明かりがほとんど無く、満月の夜（食でない）は 1
  assert.ok(W.eclipseLight(s) < 0.1);
  assert.strictEqual(W.eclipseLight(W.eclipseAt(Date.parse('2026-10-26T21:00:00+09:00'))), 1);
});

test('7 これからのイベント: 次の皆既月食（2029-01-01、日本で見える）と放射点のある流星群の次の 3 件。放射点は通常版の表と同じ', () => {
  const O = require('../engine/official-events.js');
  const list = W.upcoming(Date.parse('2026-10-03T21:00:00+09:00'), O);
  assert.deepStrictEqual(list.map((e) => e.kind === 'eclipse' ? e.date : e.shower), ['2029-01-01', 'geminids', 'quadrantids', 'perseids']);
  const ecl = list[0];
  assert.strictEqual(ecl.japan, 'visible');
  assert.ok(ecl.c.u1 < ecl.c.u2 && ecl.c.u2 < ecl.c.max && ecl.c.max < ecl.c.u3 && ecl.c.u3 < ecl.c.u4 && ecl.c.mag > 1);
  assert.deepStrictEqual(W.RADIANTS, { perseids: [48, 58], geminids: [112, 33], quadrantids: [230, 49] });
  assert.ok(read('tools/sync-from-sanpo.mjs').includes('W.RADIANTS'), 'sync --check で通常版と突き合わせる');
  // 流れ星の数: 「1時間に60個程度」→ 60、600 倍で 0.35 秒おき（速すぎないように下限）
  assert.strictEqual(W.ratePerHour('1時間に60個程度'), 60); assert.strictEqual(W.ratePerHour('1時間に15〜20個程度'), 20); assert.strictEqual(W.ratePerHour(''), 10);
  assert.strictEqual(W.meteorGap(60, 600), 0.35); assert.strictEqual(W.meteorGap(1, 1), 3);
  // 放射点から遠ざかる流れ星: 点 p は放射点から 8〜55°、向き q は p に直交して放射点と反対へ
  const R = [0, 0.6, 0.8];
  for (let i = 0; i < 50; i++) {
    const m = W.radiantMeteor(R, i / 50, (i * 7 % 50) / 50), d = Math.acos(R[0] * m.p[0] + R[1] * m.p[1] + R[2] * m.p[2]) / D;
    assert.ok(d >= 8 - 1e-9 && d <= 55 + 1e-9, String(d));
    assert.ok(Math.abs(m.q[0] * m.p[0] + m.q[1] * m.p[1] + m.q[2] * m.p[2]) < 1e-9 && R[0] * m.q[0] + R[1] * m.q[1] + R[2] * m.q[2] < 0);
  }
  // 画面: 動きを減らす設定では再生せずに見どころの時刻で止める
  const app = read('app/night.js');
  assert.ok(app.includes("if (motion) setPlaying(true); else { setPlaying(false); toast(wt('evReduced')); }"));
  assert.ok(app.includes("ev && ev.kind === 'meteor' && playing && !reduce.matches"));
});

/* ---------- 8 日の出・日の入りの空の色 ---------- */
test('8 大気散乱の近似: 係数は Bruneton & Neyret (2008)。昼の天頂は青、日の入りは太陽の側の地平線ほど赤く、反対側は暗い。太陽 −12° で 0', () => {
  assert.deepStrictEqual(W.SCAT.betaR, [5.8e-6, 13.5e-6, 33.1e-6]);
  assert.strictEqual(W.SCAT.HR, 8000); assert.strictEqual(W.SCAT.betaM, 2e-5); assert.strictEqual(W.SCAT.mieAlbedo, 0.9); assert.strictEqual(W.SCAT.g, 0.76); assert.strictEqual(W.SCAT.HM, 1200);
  const dir = (az, alt) => [Math.cos(alt * D) * Math.sin(az * D), Math.cos(alt * D) * Math.cos(az * D), Math.sin(alt * D)];
  const noonZen = W.scatter(dir(0, 90), dir(180, 60));
  assert.ok(noonZen[2] > noonZen[1] && noonZen[1] > noonZen[0], `昼の天頂 ${noonZen}`);
  const sun = dir(270, 1), toward = W.scatter(dir(270, 3), sun), away = W.scatter(dir(90, 3), sun);
  assert.ok(toward[0] > toward[2] * 2, `夕焼け ${toward}`);
  assert.ok(toward[0] / toward[2] > noonZen[0] / noonZen[2] * 3);
  assert.ok(away[0] + away[1] + away[2] < toward[0] + toward[1] + toward[2]);
  // 太陽が低いほど赤い（太陽の側の地平線）
  const rb = (a) => { const c = W.scatter(dir(270, 3), dir(270, a)); return c[0] / Math.max(1e-6, c[2]); };
  assert.ok(rb(1) > rb(5) && rb(5) > rb(20) && rb(20) > rb(60));
  // 太陽が −12° より下では 0（夜の色はそのまま）
  assert.deepStrictEqual(W.scatter(dir(270, 3), dir(270, -12.5)), [0, 0, 0]);
  // GLSL も同じ式で、係数は render/wow.js から渡す（1 か所）
  const gl = read('render/night-gl.js');
  assert.ok(gl.includes('vec3 scatterSky(vec3 v, vec3 s)') && gl.includes('(exp(-tau * Xv) - exp(-tau * Xs)) / (tau * dX)') && gl.includes('SC.betaR.map((b) => b * SC.HR)'));
  assert.ok(read('app/night.js').includes('scatter: true'));
  assert.ok(read('render/wow.js').includes('inria-00288758'));
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
