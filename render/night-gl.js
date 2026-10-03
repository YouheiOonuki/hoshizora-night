'use strict';
/* フル版の描画器（試し描き A の方向: 濃紺・にじむ光点・日周運動。ROADMAP 7.15.1 と、オーナー決定 2026-10-03「わぁきれい」）。
   ・空（天頂 → 地平線の色・地面・山並み・天の川）は全画面の 1 枚の三角形で、画素ごとに立体射影を逆に解いて向きを出す
     天の川は通常版の data.js の中心線（MW: 赤経・赤緯・幅・濃さ）からの距離で濃さを決め、3 次元のノイズでむらを付ける（新しいデータは持たない）
   ・星は加算合成の点。位置は render/sky.js の行列 1 つ（星ごとの計算は GPU）。半径・色・またたきは render/look.js の決まり
   ・惑星は同じ点の描き方、月は満ち欠けつきの円、星座線は「全部」と「選んだ星座」、流れ星は画面の上の細い帯
   ・K43 のポスター（印刷用の高解像度）は、同じ draw を大きな canvas（preserveDrawingBuffer）に向ければ出せる（初版では出さない）
   ブラウザ専用（window.NightSky・window.NightLook を使う） */
(function (root) {
  const L = root.NightLook, S = root.NightSky;
  const MWN = 32;   // 天の川の中心線の点の数の上限（data.js は 28 点。閉じるために 1 点足す）

  // 山並み（render/look.js の hillDeg と同じ式）。h は地平座標（東・北・天頂）
  const HILLS = `
float hillRad(vec3 h){
  float az = atan(h.x, h.y);
  float m = 0.6 + 0.9 * sin(2.0 * az + 0.5) + 0.6 * sin(5.0 * az + 2.1) + 0.35 * sin(11.0 * az + 4.0) + 0.2 * sin(23.0 * az + 1.3);
  return max(m, 0.0) * 0.9 * 0.01745329;
}
bool behindHills(vec3 h){ return asin(clamp(h.z, -1.0, 1.0)) < hillRad(h); }`;

  const PROJ = `
uniform mat3 uHz; uniform mat3 uView; uniform vec2 uScale; uniform float uHills;
${HILLS}
// 地平座標 h（東・北・天頂）→ 画面。見えなければ z に 0 を返す
vec3 project(vec3 h){
  vec3 p = uView * h;
  if (h.z < 0.0 || p.z < -0.9 || (uHills > 0.5 && behindHills(h))) return vec3(0.0, 0.0, 0.0);
  return vec3(p.xy / (1.0 + p.z) * uScale, 1.0);
}`;

  const BG_VS = `attribute vec2 aXY; varying vec2 vXY; void main(){ vXY = aXY; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const BG_FS = `
precision highp float;
uniform mat3 uViewT; uniform mat3 uStarT; uniform vec2 uScale; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGround;
uniform vec4 uMW[${MWN}]; uniform float uMWd[${MWN}]; uniform int uMWn; uniform float uMWk; uniform float uNoise; uniform float uHills;
varying vec2 vXY;
${HILLS}
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float milky(vec3 v){
  float I = 0.0;
  for (int i = 0; i < ${MWN - 1}; i++) {
    if (i >= uMWn - 1) break;
    vec3 a = uMW[i].xyz, b = uMW[i + 1].xyz, ab = b - a;
    float t = clamp(dot(v - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(v - (a + ab * t));
    float w = mix(uMW[i].w, uMW[i + 1].w, t);
    I = max(I, mix(uMWd[i], uMWd[i + 1], t) * exp(-d * d / (w * w)));
  }
  return I;
}
void main(){
  vec2 q = vXY / uScale; float r2 = dot(q, q);
  vec3 p = vec3(2.0 * q, 1.0 - r2) / (1.0 + r2);   // 立体射影の逆
  vec3 h = uViewT * p;
  if (h.z < 0.0 || (uHills > 0.5 && behindHills(h))) { gl_FragColor = vec4(uGround, 1.0); return; }
  float t = pow(clamp(h.z, 0.0, 1.0), 0.45);         // 高度が上がるほど天頂の色へ
  vec3 col = mix(uHor, uZen, t);
  if (uMWk > 0.001) {
    vec3 v = uStarT * h;                             // J2000 の向き
    float I = milky(v);
    if (I > 0.002) {
      float m = 1.0;
      if (uNoise > 0.5) m = 0.2 + 1.1 * (0.5 * noise(v * 9.0) + 0.3 * noise(v * 23.0) + 0.2 * noise(v * 61.0));
      col += vec3(0.70, 0.76, 0.98) * I * m * uMWk * smoothstep(0.0, 0.35, h.z);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

  const PT_VS = `
attribute vec3 aPos; attribute float aMag; attribute float aRad; attribute vec3 aColor; attribute float aTw; attribute float aHz; attribute float aPh;
uniform float uDpr; uniform float uTime; uniform float uTwinkle; uniform float uLimit; uniform float uDim; uniform float uZoom;
varying vec3 vColor; varying float vAlpha; varying float vGlow;
${PROJ}
void main(){
  vec3 s = project(uHz * aPos);
  if (s.z == 0.0 || aMag > uLimit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(s.xy, 0.0, 1.0);
  float b = pow(10.0, -0.4 * (aMag - 1.0));
  float tw = 1.0 + uTwinkle * aTw * sin(6.2831853 * aHz * uTime + aPh);
  gl_PointSize = 4.0 * aRad * uDpr * sqrt(uZoom);
  vAlpha = clamp(0.28 + 0.72 * sqrt(b), 0.18, 1.0) * clamp(uLimit - aMag + 0.5, 0.0, 1.0) * tw * uDim;
  vGlow = clamp(1.5 - aMag, 0.0, 1.5) / 1.5;          // 1.5 等より明るい星は外側にもう一段淡い光
  vColor = aColor;
}`;
  const PT_FS = `
precision mediump float;
varying vec3 vColor; varying float vAlpha; varying float vGlow;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = max(exp(-r * r * 9.0), 0.95 * (1.0 - smoothstep(0.0, 0.18, r))) + vGlow * 0.28 * exp(-r * r * 2.6) * (1.0 - r);
  if (a < 0.004) discard;
  vec3 c = mix(vColor, vec3(1.0), 0.55 * (1.0 - smoothstep(0.0, 0.22, r)));   // 芯は白く、にじみに色
  gl_FragColor = vec4(c, a * vAlpha);
}`;

  // WebGL の線は 1 物理ピクセル固定（lineWidth は効かない）。uOff だけずらして数回描き、DPR に合った太さにする
  const LN_VS = `attribute vec3 aPos; uniform vec2 uOff; ${PROJ}
varying float vVis;
// 見えない端は画面の外へ飛ばすと線が画面を横切るので、位置はそのまま近くに置き、vVis で線ごと捨てる
void main(){ vec3 s = project(uHz * aPos); vVis = s.z; vec3 p = uView * (uHz * aPos);
  vec2 xy = s.z == 0.0 ? p.xy / max(1.0 + p.z, 0.1) * uScale : s.xy;
  gl_Position = vec4(xy + uOff, 0.0, 1.0); }`;
  const LN_FS = `precision mediump float; uniform vec4 uColor; varying float vVis; void main(){ if (vVis < 0.999) discard; gl_FragColor = uColor; }`;

  const MOON_VS = `attribute vec2 aXY; uniform vec2 uClip; uniform float uSize; void main(){ gl_Position = vec4(uClip, 0.0, 1.0); gl_PointSize = uSize; }`;
  const MOON_FS = `
precision mediump float;
uniform float uK; uniform float uAngle; uniform float uDim;
void main(){
  vec2 d = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);          // 右・上
  float c = cos(uAngle), s = sin(uAngle);
  vec2 q = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / 0.3; // 明るい縁を +x に（円は点の 3 割、外は光の輪）
  float r = length(q);
  float lit = 0.0;
  if (r <= 1.0) { float edge = (1.0 - 2.0 * uK) * sqrt(max(0.0, 1.0 - q.y * q.y)); lit = smoothstep(edge - 0.05, edge + 0.05, q.x); }
  float disc = 1.0 - smoothstep(0.96, 1.03, r);
  float halo = r > 1.0 ? exp(-(r - 1.0) * 1.4) * 0.22 * uK : 0.0;
  float a = disc * (0.07 + 0.93 * lit) + halo;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.97, 0.95, 0.88), a * uDim);
}`;

  // 流れ星: 画面上の帯（4 頂点）。aT は 0（尾）〜1（頭）、aSide は −1〜1（幅の向き）
  const MET_VS = `attribute vec2 aXY; attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const MET_FS = `precision mediump float; uniform float uA; varying float vT; void main(){ gl_FragColor = vec4(0.92, 0.95, 1.0, uA * vT * vT); }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs, names) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {}; names.forEach((n) => { U[n] = gl.getUniformLocation(p, n); });
    return { p, U };
  }

  /** 見る向きの行列（行優先）。方位 az・高度 alt を画面の中心に。行 = 画面の右・上・奥 */
  function viewMatrix(az, alt) {
    const sa = Math.sin(az), ca = Math.cos(az), se = Math.sin(alt), ce = Math.cos(alt);
    const f = [sa * ce, ca * ce, se], r = [ca, -sa, 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return [...r, ...u, ...f];
  }
  const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

  /** 星の属性（CPU で 1 回だけ）。stars: [{v:[x,y,z] (J2000), mag, bv}] */
  function starAttribs(stars) {
    const n = stars.length, pos = new Float32Array(n * 3), mag = new Float32Array(n), rad = new Float32Array(n),
      col = new Float32Array(n * 3), tw = new Float32Array(n), hz = new Float32Array(n), ph = new Float32Array(n);
    stars.forEach((s, i) => {
      pos.set(s.v, i * 3); mag[i] = s.mag; rad[i] = L.haloRadius(s.mag); col.set(s.color || L.starColor(s.bv), i * 3);
      const seed = ((i * 2654435761) >>> 0) % 1000 / 1000;
      tw[i] = L.twinkles(s.mag) ? L.TWINKLE.amp : 0; hz[i] = L.twinkleHz(seed); ph[i] = seed * 40;
    });
    return { n, pos, mag, rad, col, tw, hz, ph };
  }

  /** 天の川の中心線（data.js の MW: [赤経(時), 赤緯(度), 幅(度), 濃さ]）→ uniform の配列。輪に閉じる */
  function milkyUniforms(MW) {
    const pts = MW.concat([MW[0]]).slice(0, MWN), v = new Float32Array(MWN * 4), d = new Float32Array(MWN);
    pts.forEach(([ra, dec, w, k], i) => {
      v.set(S.vec(ra * 15 * Math.PI / 180, dec * Math.PI / 180), i * 4);
      v[i * 4 + 3] = w * 0.62 * Math.PI / 180;   // 通常版は半径 1.35×幅 のぼかし。ここでは正規分布の幅に
      d[i] = k;
    });
    return { v, d, n: pts.length };
  }

  function create(canvas, stars, MW) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl');
    const bg = program(gl, BG_VS, BG_FS, ['uViewT', 'uStarT', 'uScale', 'uZen', 'uHor', 'uGround', 'uMW', 'uMWd', 'uMWn', 'uMWk', 'uNoise', 'uHills']);
    const pt = program(gl, PT_VS, PT_FS, ['uHz', 'uView', 'uScale', 'uHills', 'uDpr', 'uTime', 'uTwinkle', 'uLimit', 'uDim', 'uZoom']);
    const ln = program(gl, LN_VS, LN_FS, ['uHz', 'uView', 'uScale', 'uHills', 'uColor', 'uOff']);
    const mo = program(gl, MOON_VS, MOON_FS, ['uClip', 'uSize', 'uK', 'uAngle', 'uDim']);
    const me = program(gl, MET_VS, MET_FS, ['uA']);
    const mw = MW ? milkyUniforms(MW) : null;

    const buf = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
    const tri = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
    const one = buf(new Float32Array([0, 0]));
    const metXY = buf(new Float32Array(8), gl.DYNAMIC_DRAW), metT = buf(new Float32Array([0, 0, 1, 1]));
    const mk = (a) => ({ n: a.n, pos: buf(a.pos), mag: buf(a.mag), rad: buf(a.rad), col: buf(a.col), tw: buf(a.tw), hz: buf(a.hz), ph: buf(a.ph) });
    const starBufs = mk(starAttribs(stars));
    let bodyBufs = null;
    const lines = { all: { b: null, n: 0 }, pick: { b: null, n: 0 } };

    function bindAttr(prog, name, b, size) {
      const loc = gl.getAttribLocation(prog.p, name); if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    function drawPoints(B, hzCol, c) {
      gl.useProgram(pt.p);
      bindAttr(pt, 'aPos', B.pos, 3); bindAttr(pt, 'aMag', B.mag, 1); bindAttr(pt, 'aRad', B.rad, 1); bindAttr(pt, 'aColor', B.col, 3);
      bindAttr(pt, 'aTw', B.tw, 1); bindAttr(pt, 'aHz', B.hz, 1); bindAttr(pt, 'aPh', B.ph, 1);
      gl.uniformMatrix3fv(pt.U.uHz, false, hzCol); gl.uniformMatrix3fv(pt.U.uView, false, c.view);
      gl.uniform2fv(pt.U.uScale, c.scale); gl.uniform1f(pt.U.uHills, c.hills); gl.uniform1f(pt.U.uDpr, c.dpr); gl.uniform1f(pt.U.uTime, c.time);
      gl.uniform1f(pt.U.uTwinkle, c.twinkle); gl.uniform1f(pt.U.uLimit, c.limit); gl.uniform1f(pt.U.uDim, c.dim); gl.uniform1f(pt.U.uZoom, c.zoom);
      gl.drawArrays(gl.POINTS, 0, B.n);
    }

    /** 惑星（その日の赤道座標の単位ベクトル。地平への行列は H）を差し替える */
    function setBodies(list) {
      const a = starAttribs(list);
      if (bodyBufs) for (const [key, b] of Object.entries(bodyBufs)) if (key !== 'n') gl.deleteBuffer(b);
      bodyBufs = mk(a);
    }
    /** 星座線（J2000 の端点の組）。which: 'all'（全部）／'pick'（選んだ星座） */
    function setLines(segs, which = 'pick') {
      const L2 = lines[which];
      if (L2.b) gl.deleteBuffer(L2.b);
      L2.b = null; L2.n = 0;
      if (!segs || !segs.length) return;
      const f = new Float32Array(segs.length * 6); segs.forEach(([a, b], i) => { f.set(a, i * 6); f.set(b, i * 6 + 3); });
      L2.b = buf(f); L2.n = segs.length * 2;
    }

    /** 画面の縮尺（立体射影 → クリップ座標） */
    function scaleOf(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, m = Math.min(w, h);
      const k = st.zoom / Math.tan(st.fovDeg * Math.PI / 720);
      return [k * m / w, k * m / h];
    }

    /**
     * 1 フレーム描く。st = { starM, H（行優先）, az, alt, zoom, fovDeg, dpr, time, twinkle(0/1), limit, twilight(0..1), dusk(0..1),
     *   milky(0..1), noise(bool), hills(bool), moon:{clip,size,k,angle}|null, lineAlpha, allLines(0..), meteor:{a:[x,y],b:[x,y],w,alpha}|null }
     */
    function draw(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.viewport(0, 0, w, h);
      const V = viewMatrix(st.az, st.alt), scale = scaleOf(st), hills = st.hills ? 1 : 0;
      // 空・山並み・天の川
      gl.disable(gl.BLEND);
      gl.useProgram(bg.p); bindAttr(bg, 'aXY', tri, 2);
      gl.uniformMatrix3fv(bg.U.uViewT, false, S.toColumnMajor(transpose(V)));
      gl.uniformMatrix3fv(bg.U.uStarT, false, S.toColumnMajor(transpose(st.starM)));
      gl.uniform2fv(bg.U.uScale, scale);
      const mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
      let hor = mixc(L.hex(L.SKY.horizon), L.hex(L.SKY.twilight), st.twilight), zen = L.hex(L.SKY.zenith);
      if (st.dusk > 0) { hor = mixc(hor, L.hex(L.INTRO.duskHorizon), st.dusk); zen = mixc(zen, L.hex(L.INTRO.duskZenith), st.dusk); }
      gl.uniform3fv(bg.U.uZen, zen); gl.uniform3fv(bg.U.uHor, hor); gl.uniform3fv(bg.U.uGround, L.hex(L.SKY.ground));
      gl.uniform1f(bg.U.uHills, hills); gl.uniform1f(bg.U.uNoise, st.noise ? 1 : 0);
      if (mw) { gl.uniform4fv(bg.U.uMW, mw.v); gl.uniform1fv(bg.U.uMWd, mw.d); gl.uniform1i(bg.U.uMWn, mw.n); }
      gl.uniform1f(bg.U.uMWk, mw ? 0.42 * st.milky : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 星・惑星（加算合成）
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const common = { view: S.toColumnMajor(V), scale, dpr: st.dpr, time: st.time, twinkle: st.twinkle, zoom: st.zoom, hills,
        limit: Math.min(st.limit, L.STAR_LIMIT + 0.1 - 4.6 * Math.max(st.twilight, st.dusk)), dim: 1 - 0.6 * Math.max(st.twilight, st.dusk) };
      drawPoints(starBufs, S.toColumnMajor(st.starM), common);
      if (bodyBufs) drawPoints(bodyBufs, S.toColumnMajor(st.H), Object.assign({}, common, { limit: 9, twinkle: 0 }));
      // 星座線
      const c = L.hex(L.LINE.color);
      const drawLines = (L2, alpha) => {
        if (!L2.b || alpha <= 0) return;
        gl.useProgram(ln.p); bindAttr(ln, 'aPos', L2.b, 3);
        gl.uniformMatrix3fv(ln.U.uHz, false, S.toColumnMajor(st.starM)); gl.uniformMatrix3fv(ln.U.uView, false, common.view);
        gl.uniform2fv(ln.U.uScale, scale); gl.uniform1f(ln.U.uHills, hills);
        gl.uniform4f(ln.U.uColor, c[0], c[1], c[2], alpha);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // 太さ L.LINE.widthCss（CSS px）× DPR の物理ピクセルぶん、縦横にずらして重ねる
        const px = Math.max(1, Math.round(L.LINE.widthCss * (st.dpr || 1)));
        for (let i = 0; i < px; i++) {
          const d = i - (px - 1) / 2;
          for (const [ox, oy] of (px === 1 ? [[0, 0]] : [[d, 0], [0, d]])) {
            gl.uniform2f(ln.U.uOff, 2 * ox / w, 2 * oy / h);
            gl.drawArrays(gl.LINES, 0, L2.n);
          }
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      };
      drawLines(lines.all, st.allLines || 0);
      drawLines(lines.pick, st.lineAlpha);
      // 流れ星
      if (st.meteor) {
        const m = st.meteor, dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], len = Math.hypot(dx * w, dy * h) || 1;
        const nx = -dy * h / len * m.w / w, ny = dx * w / len * m.w / h;   // 幅の向き（クリップ座標）
        gl.bindBuffer(gl.ARRAY_BUFFER, metXY);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([m.a[0] - nx * 0.2, m.a[1] - ny * 0.2, m.a[0] + nx * 0.2, m.a[1] + ny * 0.2, m.b[0] - nx, m.b[1] - ny, m.b[0] + nx, m.b[1] + ny]));
        gl.useProgram(me.p); bindAttr(me, 'aXY', metXY, 2); bindAttr(me, 'aT', metT, 1);
        gl.uniform1f(me.U.uA, m.alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // 月
      if (st.moon) {
        gl.useProgram(mo.p); bindAttr(mo, 'aXY', one, 2);
        gl.uniform2fv(mo.U.uClip, st.moon.clip); gl.uniform1f(mo.U.uSize, st.moon.size); gl.uniform1f(mo.U.uK, st.moon.k);
        gl.uniform1f(mo.U.uAngle, st.moon.angle); gl.uniform1f(mo.U.uDim, 1);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS, 0, 1);
      }
    }

    /** 地平座標 h → 画面（CSS px）。見えなければ null。描画と同じ式 */
    function project(h, st, cssW, cssH) {
      const V = viewMatrix(st.az, st.alt), p = [0, 1, 2].map((i) => V[i * 3] * h[0] + V[i * 3 + 1] * h[1] + V[i * 3 + 2] * h[2]);
      if (p[2] < -0.9) return null;
      const m = Math.min(cssW, cssH), k = st.zoom / Math.tan(st.fovDeg * Math.PI / 720);
      const x = p[0] / (1 + p[2]) * k * m / 2, y = p[1] / (1 + p[2]) * k * m / 2;
      return { x: cssW / 2 + x, y: cssH / 2 - y, clip: [x / (cssW / 2), y / (cssH / 2)] };
    }

    return { gl, draw, setBodies, setLines, project };
  }

  root.NightRender = { create, viewMatrix, starAttribs, milkyUniforms, MWN };
})(window);
