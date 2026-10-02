'use strict';
/* 星表を WebGL の点で描く最小の描画器（技術確認と試し描き用。作り込みはしない）。
   位置は render/sky.js の行列を毎フレーム 1 つ渡すだけ（星ごとの計算は GPU）。
   opts:
     style   0 = にじむ光点、1 = 硬い点（版画）、2 = 光芒の十字
     view    'south'（南を見上げる。立体射影）/ 'dome'（全天の円。天頂が中心・北が上・東が左）
     bg      背景の色 [r,g,b]（0〜1）
     tint    星の色に混ぜる色 [r,g,b] と割合 tintMix（0 = B−V の色のまま）
     size    点の大きさの倍率
     twinkle またたきの強さ（0 = なし）
   描くときに reveal（0〜1）を渡すと、明るい星から順に灯る */
(function (root) {
  const VS = `
attribute vec3 aPos; attribute float aMag; attribute float aBV; attribute float aSeed;
uniform mat3 uHz; uniform mat3 uView; uniform vec2 uScale; uniform float uSize; uniform float uDpr;
uniform float uTime; uniform float uTwinkle; uniform float uReveal;
varying vec3 vColor; varying float vAlpha;
vec3 bvColor(float bv){
  float t = clamp((bv + 0.4) / 2.4, 0.0, 1.0);
  vec3 blue = vec3(0.62, 0.74, 1.0), white = vec3(1.0, 0.98, 0.95), red = vec3(1.0, 0.62, 0.38);
  return t < 0.3 ? mix(blue, white, t / 0.3) : mix(white, red, (t - 0.3) / 0.7);
}
void main(){
  vec3 h = uHz * aPos;                     // 東・北・天頂
  vec3 p = uView * h;                      // 画面の右・上・奥
  float lim = 6.6 * uReveal;               // reveal に応じて暗い星まで
  if (h.z < 0.0 || p.z < -0.95 || aMag > lim) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 xy = p.xy / (1.0 + p.z);            // 立体射影
  gl_Position = vec4(xy * uScale, 0.0, 1.0);
  float b = pow(10.0, -0.4 * (aMag - 1.0));
  float tw = 1.0 + uTwinkle * sin(uTime * (2.0 + 3.0 * aSeed) + aSeed * 40.0) * smoothstep(0.6, 0.0, h.z);
  gl_PointSize = clamp(uSize * uDpr * (1.6 + 3.2 * sqrt(b)) * tw, 1.0, 64.0);
  vAlpha = clamp(0.35 + 0.65 * sqrt(b), 0.15, 1.0) * clamp((lim - aMag), 0.0, 1.0);
  vColor = bvColor(aBV);
}`;
  const FS = `
precision mediump float;
uniform int uStyle; uniform vec3 uTint; uniform float uTintMix;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a;
  if (uStyle == 0) a = exp(-r * r * 6.0);
  else if (uStyle == 1) a = 1.0 - smoothstep(0.55, 0.75, r);
  else { float core = exp(-r * r * 18.0); float cross = exp(-abs(d.x) * 40.0) * (1.0 - r) + exp(-abs(d.y) * 40.0) * (1.0 - r); a = clamp(core + 0.7 * cross, 0.0, 1.0); }
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vColor, uTint, uTintMix), a * vAlpha);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  /** 見る向きの行列（行優先）。south: 方位 az0・高度 alt0 を中心に。dome: 天頂を中心に北が上・東が左 */
  function viewMatrix(view, az0, alt0) {
    if (view === 'dome') return [-1, 0, 0, 0, 1, 0, 0, 0, 1];
    const sa = Math.sin(az0), ca = Math.cos(az0), se = Math.sin(alt0), ce = Math.cos(alt0);
    const f = [sa * ce, ca * ce, se], r = [ca, -sa, 0], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return [...r, ...u, ...f];
  }

  function create(gl, bufs, opts = {}) {
    const o = Object.assign({ style: 0, view: 'south', bg: [0.02, 0.03, 0.08], tint: [1, 1, 1], tintMix: 0, size: 1, twinkle: 0, az0: Math.PI, alt0: 40 * Math.PI / 180, fovDeg: 100 }, opts);
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const seed = new Float32Array(bufs.n); for (let i = 0; i < bufs.n; i++) seed[i] = ((i * 2654435761) % 1000) / 1000;
    const attr = (name, data, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', bufs.xyz, 3); attr('aMag', bufs.mag, 1); attr('aBV', bufs.bv, 1); attr('aSeed', seed, 1);
    const U = {}; ['uHz', 'uView', 'uScale', 'uSize', 'uDpr', 'uTime', 'uTwinkle', 'uReveal', 'uStyle', 'uTint', 'uTintMix'].forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform1i(U.uStyle, o.style); gl.uniform3fv(U.uTint, o.tint); gl.uniform1f(U.uTintMix, o.tintMix);
    gl.uniform1f(U.uTwinkle, o.twinkle); gl.uniform1f(U.uSize, o.size);
    gl.uniformMatrix3fv(U.uView, false, root.NightSky.toColumnMajor(viewMatrix(o.view, o.az0, o.alt0)));
    if (o.style === 1) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    /** 1 フレーム描く。hz: sky.starMatrix の行列（行優先） */
    function draw(hz, t, reveal = 1) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.viewport(0, 0, w, h);
      gl.clearColor(o.bg[0], o.bg[1], o.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // 立体射影の半径: 中心から視野の半分の角 θ が 画面の短辺の半分になるように
      const k = o.view === 'dome' ? 1 / Math.tan(Math.PI / 4) * 0.96 : 1 / Math.tan(o.fovDeg * Math.PI / 360 / 2);
      const m = Math.min(w, h);
      gl.uniform2f(U.uScale, k * m / w, k * m / h);
      gl.uniform1f(U.uDpr, root.devicePixelRatio || 1);
      gl.uniform1f(U.uTime, t); gl.uniform1f(U.uReveal, reveal);
      gl.uniformMatrix3fv(U.uHz, false, root.NightSky.toColumnMajor(hz));
      gl.drawArrays(gl.POINTS, 0, bufs.n);
    }
    return { draw, opts: o };
  }

  /** canvas を画面いっぱい・端末の画素数に合わせる */
  function fit(canvas) {
    const d = root.devicePixelRatio || 1, w = Math.round(canvas.clientWidth * d), h = Math.round(canvas.clientHeight * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  root.NightGL = { create, fit, viewMatrix };
})(window);
