'use strict';
/* =================================================================
   フル版の座標の流れ（GPU 向け）。計算そのものは通常版の engine/astro.js を呼ぶだけで、
   定数や式をここに持たない（ROADMAP 7.15 の要件 1「計算と星表は 1 か所」）。

   通常版: 星ごとに precessor(ra,dec) → altAz(...)（CPU で 1 個ずつ）
   フル版: J2000 の単位ベクトル v を GPU に置き、毎フレーム 3×3 行列 M を 1 つ渡すだけ
           h = M v、 M = L(緯度) · Rz(−地方恒星時) · P(歳差)
           h = (東, 北, 天頂)。高度 = asin(h.z)、方位 = atan2(h.x, h.y)（北 0・東 90°。altAz と同じ向き）
   P は astro.precessor に 3 本の基底ベクトルを通して作る（歳差の式を写さない）
   ================================================================= */
(function (root) {
  // ブラウザでは astro.js の const（DEG・norm）は window に載らないので、名前で拾う
  // eslint-disable-next-line no-undef
  const A = (typeof module !== 'undefined') ? require('../engine/astro.js') : { precessor, lstRad, DEG, norm };

  const vec = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];

  /** J2000 → その日の春分点。行列（行優先 9 要素）。列 = 基底の像 */
  function precessionMatrix(ms) {
    const prec = A.precessor(ms);
    const c1 = vec(...prec(0, 0)), c2 = vec(...prec(Math.PI / 2, 0)), c3 = vec(...prec(0, Math.PI / 2));
    return [c1[0], c2[0], c3[0], c1[1], c2[1], c3[1], c1[2], c2[2], c3[2]];
  }

  /** その日の赤道座標 → 地平（東・北・天頂） */
  function horizonMatrix(ms, latDeg, lonDeg) {
    const lst = A.lstRad(ms, lonDeg), c = Math.cos(lst), s = Math.sin(lst);
    const p = latDeg * A.DEG, sp = Math.sin(p), cp = Math.cos(p);
    // Rz(−lst): [c s 0; −s c 0; 0 0 1]、L: [0 1 0; −sp 0 cp; cp 0 sp]
    return [
      -s, c, 0,
      -sp * c, -sp * s, cp,
      cp * c, cp * s, sp,
    ];
  }

  function mul(a, b) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  }

  /** 星（J2000）用: M = H · P */
  function starMatrix(ms, latDeg, lonDeg) { return mul(horizonMatrix(ms, latDeg, lonDeg), precessionMatrix(ms)); }

  function apply(m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  }
  /** h → [高度, 方位]（ラジアン。方位は 0〜2π） */
  function toAltAz(h) {
    const alt = Math.asin(Math.max(-1, Math.min(1, h[2])));
    return [alt, A.norm(Math.atan2(h[0], h[1]))];
  }

  /** 星表（catalog.js の CATALOG）を GPU 用の配列に。xyz は J2000 の単位ベクトル */
  function catalogBuffers(CATALOG) {
    const n = CATALOG.length / 4, xyz = new Float32Array(n * 3), mag = new Float32Array(n), bv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = vec(CATALOG[i * 4] / 1000 * 15 * A.DEG, CATALOG[i * 4 + 1] / 100 * A.DEG);
      xyz.set(v, i * 3); mag[i] = CATALOG[i * 4 + 2] / 100; bv[i] = CATALOG[i * 4 + 3] / 100;
    }
    return { n, xyz, mag, bv };
  }

  /** WebGL の uniform mat3 は列優先 */
  const toColumnMajor = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);

  const api = { vec, precessionMatrix, horizonMatrix, starMatrix, mul, apply, toAltAz, catalogBuffers, toColumnMajor };
  if (typeof module !== 'undefined') module.exports = api; else root.NightSky = api;
})(typeof window !== 'undefined' ? window : globalThis);
