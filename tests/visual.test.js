'use strict';
// 見た目の強化（企画書 74「フル版はすごいものに」）の決まりを数値で確かめる。render/look.js・render/night-gl.js・画像
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../render/look.js');
const S = require('../render/sky.js');
const A = require('../engine/astro.js');
const { LOCS } = require('../engine/data.js');

const ROOT = path.join(__dirname, '..');
const D = Math.PI / 180;
const vecRD = (raDeg, decDeg) => S.vec(raDeg * D, decDeg * D);

test('天の川: J2000 → 銀河座標の行列は回転（直交・行列式 1）で、銀河の中心と北極が IAU の定義の向き', () => {
  const G = L.GAL;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = G[i * 3] * G[j * 3] + G[i * 3 + 1] * G[j * 3 + 1] + G[i * 3 + 2] * G[j * 3 + 2];
    assert.ok(Math.abs(d - (i === j ? 1 : 0)) < 1e-8);
  }
  const det = G[0] * (G[4] * G[8] - G[5] * G[7]) - G[1] * (G[3] * G[8] - G[5] * G[6]) + G[2] * (G[3] * G[7] - G[4] * G[6]);
  assert.ok(Math.abs(det - 1) < 1e-8);
  // 銀河の中心（赤経 266.405°・赤緯 −28.936°）は銀経 0・銀緯 0、銀河の北極（192.859°・+27.128°）は銀緯 90°
  const [l0, b0] = L.galactic(vecRD(266.405, -28.936));
  assert.ok((l0 < 0.01 * D || l0 > 2 * Math.PI - 0.01 * D) && Math.abs(b0) < 0.01 * D);
  assert.ok(Math.abs(L.galactic(vecRD(192.859, 27.128))[1] - Math.PI / 2) < 0.01 * D);
  // 画像の上の位置: 銀河の中心が真ん中。大マゼラン雲（銀経 280.5°・銀緯 −32.9°、赤経 80.9°・赤緯 −69.8°）は右下（画像で見えている所）
  assert.deepStrictEqual(L.milkyUV(vecRD(266.405, -28.936)).map((x) => Math.round(x * 1000) / 1000), [0.5, 0.5]);
  const [u, v] = L.milkyUV(vecRD(80.894, -69.756));
  assert.ok(Math.abs(u - (0.5 + (360 - 280.5) / 360)) < 0.005 && Math.abs(v - (0.5 + 32.9 / 180)) < 0.005, `${u} ${v}`);
});

test('天の川の画像と月の地図: 出典の画像から作った JPEG（4096×2048・1024×512）で、合わせて 1 MB 以内', () => {
  const size = (f) => {
    const b = fs.readFileSync(path.join(ROOT, f)); assert.ok(b[0] === 0xff && b[1] === 0xd8, f);
    let i = 2; while (i < b.length) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5), b.length]; i += 2 + len; }
    return null;
  };
  const mw = size('render/milkyway.jpg'), mo = size('render/moon.jpg');
  assert.deepStrictEqual(mw.slice(0, 2), [4096, 2048]);
  assert.deepStrictEqual(mo.slice(0, 2), [1024, 512]);
  assert.ok(mw[2] + mo[2] <= 1024 * 1024, `${mw[2] + mo[2]} バイト`);
  // 作り方と出典（ESO の CC BY 4.0・NASA SVS のパブリックドメイン）が生成の道具に書いてある
  const tool = fs.readFileSync(path.join(ROOT, 'tools', 'build-textures.py'), 'utf8');
  for (const s of ['eso0932a', 'ESO/S. Brunier', 'CC BY 4.0', 'svs.gsfc.nasa.gov/4720', 'public domain']) assert.ok(tool.includes(s), s);
});

test('出典は画面に見える形で（ESO の条件）: 日英の画面に天の川と月の出典のリンク', () => {
  for (const [p, lang] of [['index.html', 'ja'], ['en/index.html', 'en']]) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(html.includes(`<a href="${L.CREDITS.milky.href}" rel="noopener">${L.CREDITS.milky[lang]}</a>`), p);
    assert.ok(html.includes(`<a href="${L.CREDITS.moon.href}" rel="noopener">${L.CREDITS.moon[lang]}</a>`), p);
  }
  const css = fs.readFileSync(path.join(ROOT, 'night.css'), 'utf8');
  assert.match(css, /\.credit \{[^}]*font-size: 12px/);
});

test('大気: 昼・薄明・夜の区切りは軽量版と同じ（太陽の高度 −9°〜5° で昼の空、−9°〜−1° で星が消える）', () => {
  assert.strictEqual(L.dayFactor(-20), 0); assert.strictEqual(L.dayFactor(10), 1);
  assert.strictEqual(L.starFactor(-20), 1); assert.strictEqual(L.starFactor(0), 0);
  assert.ok(L.dayFactor(-2) > 0 && L.dayFactor(-2) < 1);
  // 月明かり: 満月が高いと強く、新月・地平線の下・昼は 0
  assert.ok(L.moonLight(1, 40, 0) > 0.99 && L.moonLight(0, 40, 0) === 0 && L.moonLight(1, -5, 0) === 0 && L.moonLight(1, 40, 1) === 0);
  // 見える限界: 月明かりで 1.3 等暗く（軽量版と同じ）
  assert.ok(Math.abs(L.limitMag(6.5, 1, 1) - 5.2) < 1e-9);
});

test('大気の減光: 天頂で 0、高度 30° で約 0.25 等、地平線の近くほど大きい（逆転しない）', () => {
  assert.ok(Math.abs(L.extinctionMag(Math.PI / 2)) < 1e-5);   // 式の 0.025·e^(−11) の分だけ 0 からずれる
  assert.ok(Math.abs(L.extinctionMag(30 * D) - 0.25) < 0.02);
  for (let a = 1; a < 90; a++) assert.ok(L.extinctionMag(a * D) >= L.extinctionMag((a + 1) * D));
  assert.ok(L.extinctionMag(2 * D) > 2);
  // GLSL にも同じ式（星の点の頂点シェーダー）
  const gl = fs.readFileSync(path.join(ROOT, 'render', 'night-gl.js'), 'utf8');
  assert.ok(gl.includes('1.0 / (sa + 0.025 * exp(-11.0 * sa))') && gl.includes('0.25 * (X - 1.0)'));
});

test('月の位置: 地表から見る月は視差で低い（軽量版の mAlt -= parallax·cos(mAlt) と 0.1° 以内）', () => {
  for (const iso of ['2027-01-15T21:00:00+09:00', '2027-04-02T04:00:00+09:00', '2027-08-12T23:30:00+09:00']) for (const loc of LOCS) {
    const ms = Date.parse(iso), M = A.moon(ms), lst = A.lstRad(ms, loc.lon), sl = Math.sin(loc.lat * D), cl = Math.cos(loc.lat * D);
    let [alt, az] = A.altAz(Math.sin(M.dec), Math.cos(M.dec), M.ra, lst, sl, cl);
    alt -= M.parallax * Math.cos(alt);
    const h = L.moonTopo(S.apply(S.horizonMatrix(ms, loc.lat, loc.lon), S.vec(M.ra, M.dec)), M.parallax);
    const [a2, z2] = S.toAltAz(h);
    assert.ok(Math.abs(a2 - alt) / D < 0.1, `${iso} ${loc.id} 高度 ${(a2 - alt) / D}`);
    const dz = Math.abs(((z2 - A.norm(az)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (Math.abs(alt) < 89 * D) assert.ok(dz / D < 0.1, `${iso} ${loc.id} 方位`);
  }
});

test('カメラ: 寄せる動きはなめらか（0→1、行き過ぎない）、方位は近いほうへ回る', () => {
  assert.strictEqual(L.flyEase(0), 0); assert.strictEqual(L.flyEase(1), 1); assert.ok(Math.abs(L.flyEase(0.5) - 0.5) < 1e-9);
  for (let u = 0; u < 1; u += 0.01) assert.ok(L.flyEase(u + 0.01) >= L.flyEase(u) && L.flyEase(u) <= 1);
  assert.ok(Math.abs(L.wrapPi(350 * D) - (-10 * D)) < 1e-9 && Math.abs(L.wrapPi(-350 * D) - 10 * D) < 1e-9);
  assert.ok(L.FLY.ms >= 600 && L.FLY.ms <= 1600 && L.FLY.zoomTo <= L.ZOOM.max);
  // reduced motion では飛ばずに向くだけ（app/night.js）
  const app = fs.readFileSync(path.join(ROOT, 'app', 'night.js'), 'utf8');
  assert.ok(/if \(reduce\.matches\) \{ st\.az = target\.az;[^}]*fly = null/.test(app));
});

test('読み込み中も星が出る: 画像は描画器を作った後に読み、読み終えるまでは中心線から天の川を描く', () => {
  const gl = fs.readFileSync(path.join(ROOT, 'render', 'night-gl.js'), 'utf8');
  assert.ok(gl.includes('img.onload') && gl.includes("if (uTexK < 0.999)") && gl.includes('blankTexture'));
  // 4 等までに絞った段階（遅い端末）では天の川を描かない
  assert.ok(fs.readFileSync(path.join(ROOT, 'app', 'night.js'), 'utf8').includes("milky: st.stage === 'full' ?"));
});
