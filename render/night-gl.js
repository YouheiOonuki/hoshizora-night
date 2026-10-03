'use strict';
/* フル版の描画器（試し描き A の方向: 濃紺・にじむ光点・日周運動。ROADMAP 7.15.1）。
   ・空（天頂 → 地平線の色・地面）は全画面の 1 枚の三角形で、画素ごとに立体射影を逆に解いて高度を出す
   ・星は加算合成の点。位置は render/sky.js の行列 1 つ（星ごとの計算は GPU）。半径・色・またたきは render/look.js の決まり
   ・惑星は同じ点の描き方、月は満ち欠けつきの円、星座線は選んだ星座だけ
   ・K43 のポスター（印刷用の高解像度）は、同じ draw を大きな canvas（preserveDrawingBuffer）に向ければ出せる（初版では出さない）
   ブラウザ専用（window.NightSky・window.NightLook を使う） */
(function (root) {
  const L = root.NightLook, S = root.NightSky;

  const PROJ = `
uniform mat3 uHz; uniform mat3 uView; uniform vec2 uScale;
// 地平座標 h（東・北・天頂）→ 画面。見えなければ w に 0 を返す
vec3 project(vec3 h){
  vec3 p = uView * h;
  if (h.z < 0.0 || p.z < -0.9) return vec3(0.0, 0.0, 0.0);
  return vec3(p.xy / (1.0 + p.z) * uScale, 1.0);
}`;

  const BG_VS = `attribute vec2 aXY; varying vec2 vXY; void main(){ vXY = aXY; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const BG_FS = `
precision highp float;
uniform mat3 uViewT; uniform vec2 uScale; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGround;
varying vec2 vXY;
void main(){
  vec2 q = vXY / uScale; float r2 = dot(q, q);
  vec3 p = vec3(2.0 * q, 1.0 - r2) / (1.0 + r2);   // 立体射影の逆
  vec3 h = uViewT * p;
  if (h.z < 0.0) { gl_FragColor = vec4(uGround, 1.0); return; }
  float t = pow(clamp(h.z, 0.0, 1.0), 0.45);         // 高度が上がるほど天頂の色へ
  gl_FragColor = vec4(mix(uHor, uZen, t), 1.0);
}`;

  const PT_VS = `
attribute vec3 aPos; attribute float aMag; attribute float aRad; attribute vec3 aColor; attribute float aTw; attribute float aHz; attribute float aPh;
uniform float uDpr; uniform float uTime; uniform float uTwinkle; uniform float uLimit; uniform float uDim; uniform float uZoom;
varying vec3 vColor; varying float vAlpha;
${PROJ}
void main(){
  vec3 s = project(uHz * aPos);
  if (s.z == 0.0 || aMag > uLimit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(s.xy, 0.0, 1.0);
  float b = pow(10.0, -0.4 * (aMag - 1.0));
  float tw = 1.0 + uTwinkle * aTw * sin(6.2831853 * aHz * uTime + aPh);
  gl_PointSize = 4.0 * aRad * uDpr * sqrt(uZoom);
  vAlpha = clamp(0.3 + 0.7 * sqrt(b), 0.22, 1.0) * clamp(uLimit - aMag + 0.5, 0.0, 1.0) * tw * uDim;
  vColor = aColor;
}`;
  const PT_FS = `
precision mediump float;
varying vec3 vColor; varying float vAlpha;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = max(exp(-r * r * 9.0), 0.9 * (1.0 - smoothstep(0.0, 0.2, r)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

  const LN_VS = `attribute vec3 aPos; ${PROJ}
void main(){ vec3 s = project(uHz * aPos); gl_Position = s.z == 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(s.xy, 0.0, 1.0); }`;
  const LN_FS = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;

  const MOON_VS = `attribute vec2 aXY; uniform vec2 uClip; uniform float uSize; void main(){ gl_Position = vec4(uClip, 0.0, 1.0); gl_PointSize = uSize; }`;
  const MOON_FS = `
precision mediump float;
uniform float uK; uniform float uAngle; uniform float uDim;
void main(){
  vec2 d = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);          // 右・上
  float c = cos(uAngle), s = sin(uAngle);
  vec2 q = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / 0.42; // 明るい縁を +x に
  float r = length(q);
  float glow = exp(-max(r - 1.0, 0.0) * 3.0) * 0.18 * smoothstep(1.0, 0.95, r) + exp(-max(r - 1.0, 0.0) * 2.2) * 0.12 * step(1.0, r);
  float lit = 0.0;
  if (r <= 1.0) { float edge = (1.0 - 2.0 * uK) * sqrt(max(0.0, 1.0 - q.y * q.y)); lit = smoothstep(edge - 0.04, edge + 0.04, q.x); }
  float disc = 1.0 - smoothstep(0.96, 1.02, r);
  float a = disc * (0.07 + 0.93 * lit) + glow * uK;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.96, 0.95, 0.89), a * uDim);
}`;

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

  function create(canvas, stars) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl');
    const bg = program(gl, BG_VS, BG_FS, ['uViewT', 'uScale', 'uZen', 'uHor', 'uGround']);
    const pt = program(gl, PT_VS, PT_FS, ['uHz', 'uView', 'uScale', 'uDpr', 'uTime', 'uTwinkle', 'uLimit', 'uDim', 'uZoom']);
    const ln = program(gl, LN_VS, LN_FS, ['uHz', 'uView', 'uScale', 'uColor']);
    const mo = program(gl, MOON_VS, MOON_FS, ['uClip', 'uSize', 'uK', 'uAngle', 'uDim']);

    const buf = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
    const tri = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
    const one = buf(new Float32Array([0, 0]));
    const mk = (a) => ({ n: a.n, pos: buf(a.pos), mag: buf(a.mag), rad: buf(a.rad), col: buf(a.col), tw: buf(a.tw), hz: buf(a.hz), ph: buf(a.ph) });
    const starBufs = mk(starAttribs(stars));
    let bodyBufs = null, lineBuf = null, lineN = 0;

    function bindAttr(prog, name, b, size) {
      const loc = gl.getAttribLocation(prog.p, name); if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    function drawPoints(B, hzCol, common) {
      gl.useProgram(pt.p);
      bindAttr(pt, 'aPos', B.pos, 3); bindAttr(pt, 'aMag', B.mag, 1); bindAttr(pt, 'aRad', B.rad, 1); bindAttr(pt, 'aColor', B.col, 3);
      bindAttr(pt, 'aTw', B.tw, 1); bindAttr(pt, 'aHz', B.hz, 1); bindAttr(pt, 'aPh', B.ph, 1);
      gl.uniformMatrix3fv(pt.U.uHz, false, hzCol); gl.uniformMatrix3fv(pt.U.uView, false, common.view);
      gl.uniform2fv(pt.U.uScale, common.scale); gl.uniform1f(pt.U.uDpr, common.dpr); gl.uniform1f(pt.U.uTime, common.time);
      gl.uniform1f(pt.U.uTwinkle, common.twinkle); gl.uniform1f(pt.U.uLimit, common.limit); gl.uniform1f(pt.U.uDim, common.dim);
      gl.uniform1f(pt.U.uZoom, common.zoom);
      gl.drawArrays(gl.POINTS, 0, B.n);
    }

    /** 惑星（その日の赤道座標の単位ベクトル。地平への行列は H）を差し替える */
    function setBodies(list) {
      const a = starAttribs(list);
      if (bodyBufs) for (const [key, b] of Object.entries(bodyBufs)) if (key !== 'n') gl.deleteBuffer(b);
      bodyBufs = mk(a);
    }
    /** 星座線（J2000 の端点の組） */
    function setLines(segs) {
      if (lineBuf) gl.deleteBuffer(lineBuf);
      lineBuf = null; lineN = 0;
      if (!segs || !segs.length) return;
      const f = new Float32Array(segs.length * 6); segs.forEach(([a, b], i) => { f.set(a, i * 6); f.set(b, i * 6 + 3); });
      lineBuf = buf(f); lineN = segs.length * 2;
    }

    /** 画面の縮尺（立体射影 → クリップ座標） */
    function scaleOf(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, m = Math.min(w, h);
      const k = st.zoom / Math.tan(st.fovDeg * Math.PI / 720);
      return [k * m / w, k * m / h];
    }

    /**
     * 1 フレーム描く。st = { starM, H（行優先）, az, alt, zoom, fovDeg, dpr, time, twinkle(0/1), limit, twilight(0..1), moon:{clip,size,k,angle}|null, lineAlpha }
     */
    function draw(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.viewport(0, 0, w, h);
      const V = viewMatrix(st.az, st.alt), scale = scaleOf(st);
      // 空
      gl.disable(gl.BLEND);
      gl.useProgram(bg.p); bindAttr(bg, 'aXY', tri, 2);
      gl.uniformMatrix3fv(bg.U.uViewT, false, S.toColumnMajor(transpose(V)));
      gl.uniform2fv(bg.U.uScale, scale);
      const hor = L.hex(L.SKY.horizon).map((x, i) => x + (L.hex(L.SKY.twilight)[i] - x) * st.twilight);
      gl.uniform3fv(bg.U.uZen, L.hex(L.SKY.zenith)); gl.uniform3fv(bg.U.uHor, hor); gl.uniform3fv(bg.U.uGround, L.hex(L.SKY.ground));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 星・惑星（加算合成）
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const common = { view: S.toColumnMajor(V), scale, dpr: st.dpr, time: st.time, twinkle: st.twinkle, zoom: st.zoom,
        limit: Math.min(st.limit, 6.6 - 4.6 * st.twilight), dim: 1 - 0.6 * st.twilight };
      drawPoints(starBufs, S.toColumnMajor(st.starM), common);
      if (bodyBufs) drawPoints(bodyBufs, S.toColumnMajor(st.H), Object.assign({}, common, { limit: 9, twinkle: 0 }));
      // 星座線
      if (lineBuf && st.lineAlpha > 0) {
        gl.useProgram(ln.p); bindAttr(ln, 'aPos', lineBuf, 3);
        gl.uniformMatrix3fv(ln.U.uHz, false, S.toColumnMajor(st.starM)); gl.uniformMatrix3fv(ln.U.uView, false, common.view);
        gl.uniform2fv(ln.U.uScale, scale);
        const c = L.hex(L.LINE.color); gl.uniform4f(ln.U.uColor, c[0], c[1], c[2], st.lineAlpha);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.LINES, 0, lineN);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
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
    /** 画面（CSS px）→ 地平座標 h（逆の立体射影） */
    function unproject(px, py, st, cssW, cssH) {
      const m = Math.min(cssW, cssH), k = st.zoom / Math.tan(st.fovDeg * Math.PI / 720);
      const qx = (px - cssW / 2) / (k * m / 2), qy = -(py - cssH / 2) / (k * m / 2), r2 = qx * qx + qy * qy;
      const p = [2 * qx / (1 + r2), 2 * qy / (1 + r2), (1 - r2) / (1 + r2)], V = viewMatrix(st.az, st.alt);
      return [0, 1, 2].map((j) => V[j] * p[0] + V[3 + j] * p[1] + V[6 + j] * p[2]);
    }

    return { gl, draw, setBodies, setLines, project, unproject };
  }

  root.NightRender = { create, viewMatrix, starAttribs };
})(window);
