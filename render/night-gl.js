'use strict';
/* フル版の描画器（試し描き A の方向: 濃紺・にじむ光点・日周運動。ROADMAP 7.15.1、オーナー決定 2026-10-03「わぁきれい」、企画書 74「フル版はすごいものに」）。
   ・空（色・大気・地面・山並み・天の川）は全画面の 1 枚の三角形で、画素ごとに立体射影を逆に解いて向きを出す
     - 大気: 昼の青・薄明の地平線の色（太陽の方位ほど赤い）・月明かり（空全体と月のまわりの光の輪）・地平線のかすみ
     - 天の川: ESO/S. Brunier の全天画像（render/milkyway.jpg、銀河座標）を J2000 → 銀河座標の行列で貼る。読み込むまでは
       通常版の data.js の中心線（MW）からの距離とノイズで描く（読み込み中も空が出る）
   ・星は加算合成の点。位置は render/sky.js の行列 1 つ（星ごとの計算は GPU）。地平線に近いほど大気で暗く赤く（減光）
   ・太陽・月・惑星・星雲は四角形の板（スプライト）: 月は表面の地図（render/moon.jpg、NASA SVS）を貼った球に太陽の向きの光、惑星は満ち欠けと色の円盤
   ・星座線は 2 通り: GPU の細い線（ポスター K43 と互換）と、画面の上で星の手前で切った柔らかい線（app が端点の画面座標を渡す）
   ・K43 のポスター（印刷用の高解像度。app/poster.js）は、同じ draw を大きな canvas（opts.preserve = preserveDrawingBuffer）に向けて出す
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
uniform mat3 uViewT; uniform mat3 uStarT; uniform mat3 uGal; uniform vec2 uScale; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGround;
uniform vec4 uMW[${MWN}]; uniform float uMWd[${MWN}]; uniform int uMWn; uniform float uMWk; uniform float uNoise; uniform float uHills;
uniform sampler2D uTex; uniform float uTexK;
uniform vec3 uSun; uniform float uDay; uniform float uGlow; uniform vec3 uMoon; uniform float uMoonK; uniform float uCity;
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
  float dith = (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;   // 色の段を目立たせない
  vec3 sunH = normalize(uSun); float sunAlt = asin(clamp(sunH.z, -1.0, 1.0)) * 57.29578;
  if (h.z < 0.0 || (uHills > 0.5 && behindHills(h))) {
    // 地面: 夜は黒に近く、昼と月明かりで少し明るい。下ほど暗い
    vec3 g = mix(uGround, vec3(0.16, 0.20, 0.19), uDay) + vec3(0.010, 0.013, 0.020) * uMoonK + vec3(0.030, 0.022, 0.016) * uCity * (1.0 - uDay);
    g *= 0.75 + 0.25 * smoothstep(-0.5, 0.0, h.z);
    gl_FragColor = vec4(g + dith, 1.0); return;
  }
  float t = pow(clamp(h.z, 0.0, 1.0), 0.45);         // 高度が上がるほど天頂の色へ
  vec3 col = mix(uHor, uZen, t);
  // 昼の空
  vec3 day = mix(vec3(0.66, 0.80, 0.93), vec3(0.20, 0.42, 0.80), pow(clamp(h.z, 0.0, 1.0), 0.5));
  col = mix(col, day, uDay);
  // 薄明・朝焼け・夕焼け: 太陽の方位の地平線ほど赤く、上は紫へ
  float g = clamp(1.0 - abs(sunAlt + 4.0) / 14.0, 0.0, 1.0) * uGlow;
  if (g > 0.0) {
    vec2 hz = normalize(h.xy + 1e-5), sz = normalize(sunH.xy + 1e-5);
    float toward = pow(0.5 + 0.5 * dot(hz, sz), 3.0);
    vec3 warm = mix(vec3(1.0, 0.52, 0.26), vec3(0.50, 0.36, 0.66), smoothstep(0.0, 0.35, h.z));
    col += warm * g * (0.12 + 0.55 * toward) * exp(-h.z * 4.5) * (1.0 - 0.5 * uDay);
  }
  // 月明かり: 空全体が青く明るくなり、月のまわりに光の輪
  if (uMoonK > 0.0) {
    float dm = acos(clamp(dot(h, normalize(uMoon)), -1.0, 1.0));
    col += uMoonK * (vec3(0.030, 0.046, 0.085) * (1.0 - 0.45 * h.z) + vec3(0.18, 0.20, 0.25) * exp(-dm / 0.10) * 0.5 + vec3(0.05, 0.06, 0.08) * exp(-dm / 0.45));
  }
  // 地平線のかすみ（夜）
  col += vec3(0.030, 0.040, 0.070) * exp(-h.z * 14.0) * (1.0 - uDay);
  // 街明かり（企画書 75 の 2）: 空全体が明るく、地平線ほど橙がかった光（夜だけ）
  if (uCity > 0.0) col += uCity * (1.0 - uDay) * (vec3(0.060, 0.058, 0.066) + vec3(0.34, 0.22, 0.13) * exp(-h.z * 3.2) + vec3(0.10, 0.07, 0.05) * exp(-h.z * 12.0));
  // 天の川（画像、または中心線から）。地平線に近いほど大気で薄く
  if (uMWk > 0.001) {
    vec3 v = uStarT * h;                             // J2000 の向き
    float sa = max(h.z, 0.0), X = min(40.0, 1.0 / (sa + 0.025 * exp(-11.0 * sa)));
    float ext = pow(10.0, -0.4 * 0.3 * (X - 1.0)) * smoothstep(0.0, 0.06, h.z);   // 地平線に近いほど空気で薄く（天の川は面の光なので星より強く）
    vec3 mw = vec3(0.0);
    if (uTexK < 0.999) {
      float I = milky(v), m = 1.0;
      if (I > 0.002 && uNoise > 0.5) m = 0.2 + 1.1 * (0.5 * noise(v * 9.0) + 0.3 * noise(v * 23.0) + 0.2 * noise(v * 61.0));
      mw += (1.0 - uTexK) * vec3(0.70, 0.76, 0.98) * I * m * 0.42;
    }
    if (uTexK > 0.001) {
      vec3 gv = uGal * v;
      float l = atan(gv.y, gv.x), b = asin(clamp(gv.z, -1.0, 1.0));
      vec3 c = texture2D(uTex, vec2(fract(0.5 - l / 6.2831853), 0.5 - b / 3.1415927)).rgb;
      c = c * c;                                     // 画像は γ 2.2 ほど。暗い所を沈め、明るい所の模様を残す
      c = 0.62 * (vec3(1.0) - exp(-2.0 * c));        // 明るい中心が白く飛ばないように
      mw += uTexK * mix(vec3(dot(c, vec3(0.33))), c, 0.8);   // 色は少し抑える（肉眼の天の川は色が薄い）
    }
    col += mw * uMWk * ext;
  }
  gl_FragColor = vec4(col + dith, 1.0);
}`;

  const PT_VS = `
attribute vec3 aPos; attribute float aMag; attribute float aRad; attribute vec3 aColor; attribute float aTw; attribute float aHz; attribute float aPh;
uniform float uDpr; uniform float uTime; uniform float uTwinkle; uniform float uLimit; uniform float uDim; uniform float uZoom; uniform float uExt; uniform float uMaxPt;
varying vec3 vColor; varying float vAlpha; varying float vGlow;
${PROJ}
void main(){
  vec3 hz = uHz * aPos;
  vec3 s = project(hz);
  // 大気の減光（等級）: 空気の量（エアマス）× 0.25（render/look.js の extinctionMag と同じ式）
  float sa = max(hz.z, 0.0), X = min(40.0, 1.0 / (sa + 0.025 * exp(-11.0 * sa)));
  float dm = uExt * 0.25 * (X - 1.0), mag = aMag + dm;
  if (s.z == 0.0 || mag > uLimit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(s.xy, 0.0, 1.0);
  float b = pow(10.0, -0.4 * (mag - 1.0));
  float tw = 1.0 + uTwinkle * aTw * (1.0 + 1.5 * uExt * smoothstep(0.5, 0.05, sa)) * sin(6.2831853 * aHz * uTime + aPh);   // 地平線の近くほど強くまたたく
  gl_PointSize = min(uMaxPt, 4.0 * aRad * uDpr * sqrt(uZoom) * (1.0 - 0.35 * clamp(dm / 2.0, 0.0, 1.0)));
  vAlpha = clamp(0.28 + 0.72 * sqrt(b), 0.18, 1.0) * clamp(uLimit - mag + 0.5, 0.0, 1.0) * tw * uDim;
  vGlow = clamp(1.5 - mag, 0.0, 2.5) / 1.5;          // 1.5 等より明るい星は外側にもう一段淡い光（さらに明るいと光の筋）
  vColor = mix(aColor, aColor * vec3(1.0, 0.80, 0.58), uExt * clamp(dm / 1.5, 0.0, 1.0));   // 地平線の近くは赤く
}`;
  const PT_FS = `
precision mediump float;
uniform float uPremul;
varying vec3 vColor; varying float vAlpha; varying float vGlow;
void main(){
  vec2 d = (gl_PointCoord - 0.5) * 2.0;
  float r = length(d);
  float a = max(exp(-r * r * 9.0), 0.95 * (1.0 - smoothstep(0.0, 0.18, r))) + min(vGlow, 1.0) * 0.28 * exp(-r * r * 2.6) * (1.0 - r);
  // 0 等より明るい星: 細い光の筋（4 本）
  float spike = clamp(vGlow - 1.0, 0.0, 1.0);
  if (spike > 0.0) a += spike * 0.22 * (exp(-abs(d.y) * 40.0) + exp(-abs(d.x) * 40.0)) * (1.0 - smoothstep(0.2, 1.0, r));
  if (a < 0.004) discard;
  vec3 c = mix(vColor, vec3(1.0), 0.55 * (1.0 - smoothstep(0.0, 0.22, r)));   // 芯は白く、にじみに色
  gl_FragColor = uPremul > 0.5 ? vec4(c * a * vAlpha, 1.0) : vec4(c, a * vAlpha);   // 軌跡（企画書 75 の 5）は明るい方を残す合成なので前もって掛ける
}`;

  // 星の軌跡（企画書 75 の 5）: 星を別の絵（FBO）に描きためる。少しずつ暗くする四角と、画面に重ねる四角
  const TR_VS = `attribute vec2 aXY; varying vec2 vUV; void main(){ vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const FADE_FS = `precision mediump float; uniform float uFade; void main(){ gl_FragColor = vec4(uFade, uFade, uFade, 0.0); }`;
  const COMP_FS = `precision mediump float; uniform sampler2D uTex; uniform float uAlpha; varying vec2 vUV; void main(){ gl_FragColor = vec4(texture2D(uTex, vUV).rgb * uAlpha, 1.0); }`;

  // GPU の細い線（ポスター K43 と互換）。WebGL の線は 1 物理ピクセル固定なので uOff だけずらして数回描く
  const LN_VS = `attribute vec3 aPos; uniform vec2 uOff; ${PROJ}
varying float vVis;
void main(){ vec3 s = project(uHz * aPos); vVis = s.z; vec3 p = uView * (uHz * aPos);
  vec2 xy = s.z == 0.0 ? p.xy / max(1.0 + p.z, 0.1) * uScale : s.xy;
  gl_Position = vec4(xy + uOff, 0.0, 1.0); }`;
  const LN_FS = `precision mediump float; uniform vec4 uColor; varying float vVis; void main(){ if (vVis < 0.999) discard; gl_FragColor = uColor; }`;

  // 画面の上の柔らかい線（四角形）。aV は幅の向き −1〜1、aU は線に沿った長さ（px）。uDash > 0 なら点線
  const QL_VS = `attribute vec2 aXY; attribute float aV; attribute float aU; varying float vV; varying float vU; void main(){ vV = aV; vU = aU; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const QL_FS = `precision mediump float; uniform vec4 uColor; uniform float uCore; uniform float uDash; varying float vV; varying float vU;
void main(){
  if (uDash > 0.0 && fract(vU / uDash) > 0.55) discard;
  float v = abs(vV), a = (1.0 - smoothstep(uCore * 0.6, uCore, v)) + 0.35 * exp(-v * v * 5.0);
  gl_FragColor = vec4(uColor.rgb, uColor.a * min(a, 1.0));
}`;

  // 板（太陽・月・惑星・星雲）。aC は −1〜1 の角
  const SP_VS = `attribute vec2 aC; uniform vec2 uClip; uniform vec2 uHalf; uniform float uRot; varying vec2 vUV;
void main(){ float c = cos(uRot), s = sin(uRot); vUV = aC; vec2 q = vec2(c * aC.x - s * aC.y, s * aC.x + c * aC.y); gl_Position = vec4(uClip + q * uHalf, 0.0, 1.0); }`;
  const SP_FS = `
precision highp float;
uniform int uMode; uniform vec3 uColor; uniform float uAlpha; uniform float uR; uniform vec3 uSunDir; uniform float uAspect; uniform float uRing; uniform float uBands;
uniform sampler2D uTex; uniform float uHasTex; uniform float uEarth; uniform float uOcc; uniform vec4 uShadow;
varying vec2 vUV;
void main(){
  vec2 d = vUV;                                       // 板の上の位置 −1〜1（右・上）。円盤の半径は uR
  float r = length(d);
  if (uMode == 0) {                                   // ぼんやりした光（星雲・銀河・星団）。uAspect で楕円
    vec2 e = vec2(d.x, d.y / max(uAspect, 0.05));
    float a = exp(-dot(e, e) * 4.0) * (1.0 - smoothstep(0.8, 1.0, r));
    gl_FragColor = vec4(uColor, a * uAlpha); return;
  }
  if (uMode == 1) {                                   // 太陽
    float disc = 1.0 - smoothstep(uR * 0.95, uR * 1.05, r);
    float glare = exp(-r / (uR * 1.6)) * 0.55 + exp(-r / (uR * 5.0)) * 0.25;
    vec3 c = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.98, 0.93), disc);
    gl_FragColor = vec4(c, min(1.0, disc + glare * (1.0 - smoothstep(0.7, 1.0, r))) * uAlpha); return;
  }
  // 2 惑星・3 月: 球の表面に太陽の向き（uSunDir: 右・上・手前）からの光
  float halo = (uMode == 3 ? 0.20 : 0.45) * exp(-(r - uR) / (uR * (uMode == 3 ? 0.9 : 1.4))) * (1.0 - smoothstep(0.75, 1.0, r));
  vec3 col = uColor; float a = 0.0;
  // 土星の環（球の後ろ側は球に隠れる）
  float ring = 0.0;
  if (uRing > 0.0) {
    vec2 rq = vec2(d.x, d.y / 0.38);
    float rr = length(rq) / uR;
    ring = smoothstep(1.25, 1.35, rr) * (1.0 - smoothstep(2.15, 2.3, rr)) * (0.55 + 0.25 * sin(rr * 30.0));
  }
  if (r < uR) {
    vec2 q = d / uR; float z = sqrt(max(0.0, 1.0 - dot(q, q)));
    vec3 n = vec3(q, z);
    float lit = dot(n, normalize(uSunDir));
    float lambert = smoothstep(-0.06, 0.12, lit) * (0.35 + 0.65 * max(lit, 0.0));
    vec3 albedo = uColor;
    if (uMode == 3 && uHasTex > 0.5) {               // 月の表面の地図（経度 0° が地球を向く。北が上、東が右）
      float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(n.x, n.z);
      albedo = texture2D(uTex, vec2(0.5 + lon / 6.2831853, 0.5 - lat / 3.1415927)).rgb * 1.35;
      albedo = mix(vec3(dot(albedo, vec3(0.33))), albedo, 0.35);   // 色は控えめに
    }
    if (uBands > 0.0) albedo *= 1.0 - uBands * 0.18 * (0.5 + 0.5 * sin(q.y * 14.0 + 0.6)) * smoothstep(0.85, 0.2, abs(q.y));
    float limb = 0.75 + 0.25 * z;                    // 縁が少し暗い
    col = albedo * (lambert * limb) + albedo * uEarth * (1.0 - lambert);   // 影の側は地球照でうっすら
    if (uMode == 3 && uShadow.z > 0.0) {             // 月食（企画書 75 の 7）: 地球の本影は赤黒く、半影は少し暗く。uShadow = (影の中心 x, y, 本影, 半影)（月の半径が 1）
      float ds = length(q - uShadow.xy);
      float pen = clamp((ds - uShadow.z) / max(uShadow.w - uShadow.z, 0.01), 0.0, 1.0);
      float umb = smoothstep(uShadow.z - 0.06, uShadow.z + 0.06, ds);
      vec3 red = albedo * vec3(0.30, 0.09, 0.04) * (0.6 + 0.4 * smoothstep(0.0, uShadow.z, ds));
      col = mix(red, col * (0.45 + 0.55 * pen), umb);
    }
    a = (1.0 - smoothstep(uR * 0.96, uR * 1.03, r)) * mix(clamp(lambert * 1.6, 0.0, 1.0), 1.0, uOcc);   // 昼は影の側が空に溶ける
    if (uRing > 0.0 && d.y < 0.0) { col = mix(col, uColor * 0.95, ring * 0.8); }   // 手前の環
  } else if (ring > 0.0) { col = uColor * 0.9; a = ring * 0.85; }
  float outA = max(a, halo * uAlpha);
  vec3 outC = a > 0.0 ? col : uColor * 0.9 + 0.1;
  gl_FragColor = vec4(outC, outA * uAlpha);
}`;

  // 星座絵（企画書 75 の 3）: ヘヴェリウスの図を網（J2000 の頂点）で空に貼る。白 = 墨の濃淡を淡い色で加算
  const ART_VS = `attribute vec3 aPos; attribute vec2 aUV; uniform mat3 uHz; uniform mat3 uView; uniform vec2 uScale;
varying vec2 vUV; varying float vAlt; varying float vBack;
void main(){ vec3 h = uHz * aPos; vec3 p = uView * h; vUV = aUV; vAlt = h.z; vBack = p.z;
  gl_Position = vec4(p.xy / max(1.0 + p.z, 0.05) * uScale, 0.0, 1.0); }`;
  const ART_FS = `precision mediump float; uniform sampler2D uTex; uniform vec3 uColor; uniform float uAlpha; uniform vec4 uMask; uniform float uHills;
varying vec2 vUV; varying float vAlt; varying float vBack;
void main(){
  if (vBack < -0.6) discard;
  float ink = texture2D(uTex, vUV).r;
  float m = 1.0 - smoothstep(0.72, 1.0, length((vUV - uMask.xy) / uMask.zw));
  float a = ink * m * smoothstep(-0.005, 0.04, vAlt) * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

  // 星雲・星団の実写（企画書 75 の 4）: 画面の上の四角（中心と、画像の右・上の半分の向きをクリップ座標で）。黒い背景は加算で空に溶ける
  const IMG_VS = `attribute vec2 aC; uniform vec2 uClip; uniform vec2 uBx; uniform vec2 uBy; varying vec2 vUV;
void main(){ vUV = vec2(aC.x * 0.5 + 0.5, 0.5 - aC.y * 0.5); gl_Position = vec4(uClip + aC.x * uBx + aC.y * uBy, 0.0, 1.0); }`;
  const IMG_FS = `precision mediump float; uniform sampler2D uTex; uniform float uAlpha; uniform float uSat; varying vec2 vUV;
void main(){ vec2 e = min(vUV, 1.0 - vUV); float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
  vec3 c = texture2D(uTex, vUV).rgb; c = mix(vec3(dot(c, vec3(0.3, 0.55, 0.15))), c, uSat); gl_FragColor = vec4(c * edge * uAlpha, 1.0); }`;

  // 流れ星: 画面上の帯（4 頂点）。aT は 0（尾）〜1（頭）
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

  /**
   * opts.preserve: 描いた後に 2D の canvas へ写す（ポスター）ときは true
   * opts.textures: { milky: URL, moon: URL }（省略すると画像を読まない。読み込みは後から: 読み込み中も星と空は出る）
   * opts.onTexture(name): 画像を読み終えたとき
   */
  function create(canvas, stars, MW, opts = {}) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('webgl');
    const bg = program(gl, BG_VS, BG_FS, ['uViewT', 'uStarT', 'uGal', 'uScale', 'uZen', 'uHor', 'uGround', 'uMW', 'uMWd', 'uMWn', 'uMWk', 'uNoise', 'uHills',
      'uTex', 'uTexK', 'uSun', 'uDay', 'uGlow', 'uMoon', 'uMoonK', 'uCity']);
    const pt = program(gl, PT_VS, PT_FS, ['uHz', 'uView', 'uScale', 'uHills', 'uDpr', 'uTime', 'uTwinkle', 'uLimit', 'uDim', 'uZoom', 'uExt', 'uMaxPt', 'uPremul']);
    const fd = program(gl, TR_VS, FADE_FS, ['uFade']);
    const cp = program(gl, TR_VS, COMP_FS, ['uTex', 'uAlpha']);
    const minmax = gl.getExtension('EXT_blend_minmax');
    const ln = program(gl, LN_VS, LN_FS, ['uHz', 'uView', 'uScale', 'uHills', 'uColor', 'uOff']);
    const ql = program(gl, QL_VS, QL_FS, ['uColor', 'uCore', 'uDash']);
    const sp = program(gl, SP_VS, SP_FS, ['uClip', 'uHalf', 'uRot', 'uMode', 'uColor', 'uAlpha', 'uR', 'uSunDir', 'uAspect', 'uRing', 'uBands', 'uTex', 'uHasTex', 'uEarth', 'uOcc', 'uShadow']);
    const me = program(gl, MET_VS, MET_FS, ['uA']);
    const im = program(gl, IMG_VS, IMG_FS, ['uClip', 'uBx', 'uBy', 'uTex', 'uAlpha', 'uSat']);
    const ar = program(gl, ART_VS, ART_FS, ['uHz', 'uView', 'uScale', 'uTex', 'uColor', 'uAlpha', 'uMask', 'uHills']);
    const mw = MW ? milkyUniforms(MW) : null;
    const maxPt = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];

    const buf = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
    const tri = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
    const quad = buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    const qlBuf = gl.createBuffer();
    const metXY = buf(new Float32Array(8), gl.DYNAMIC_DRAW), metT = buf(new Float32Array([0, 0, 1, 1]));
    const mk = (a) => ({ n: a.n, pos: buf(a.pos), mag: buf(a.mag), rad: buf(a.rad), col: buf(a.col), tw: buf(a.tw), hz: buf(a.hz), ph: buf(a.ph) });
    const starBufs = mk(starAttribs(stars));
    let bodyBufs = null;
    const lines = { all: { b: null, n: 0 }, pick: { b: null, n: 0 } };

    // 画像（天の川・月）。読み込むまでは 1×1 の黒を貼っておく（uniform の sampler が空にならないように）
    const tex = {};
    function blankTexture() {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      return t;
    }
    const blank = blankTexture();
    const loaded = { milky: 0, moon: 0 };   // 0〜1（読み終えてから 1 秒でなめらかに入れる）
    const loadedAt = {};
    function loadTexture(name, url) {
      if (!url || typeof Image === 'undefined') return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        tex[name] = t; loadedAt[name] = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (opts.onTexture) opts.onTexture(name);
      };
      img.src = url;
    }
    const T0 = opts.textures || {};
    loadTexture('milky', T0.milky); loadTexture('moon', T0.moon);
    function texK(name, now) {
      if (!tex[name]) return 0;
      if (opts.instantTextures) return 1;
      return Math.min(1, (now - loadedAt[name]) / 1000);
    }

    const MAXA = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    function use(prog) { for (let i = 0; i < MAXA; i++) gl.disableVertexAttribArray(i); gl.useProgram(prog.p); }
    function bindAttr(prog, name, b, size, stride = 0, offset = 0) {
      const loc = gl.getAttribLocation(prog.p, name); if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    function drawPoints(B, hzCol, c) {
      use(pt);
      bindAttr(pt, 'aPos', B.pos, 3); bindAttr(pt, 'aMag', B.mag, 1); bindAttr(pt, 'aRad', B.rad, 1); bindAttr(pt, 'aColor', B.col, 3);
      bindAttr(pt, 'aTw', B.tw, 1); bindAttr(pt, 'aHz', B.hz, 1); bindAttr(pt, 'aPh', B.ph, 1);
      gl.uniformMatrix3fv(pt.U.uHz, false, hzCol); gl.uniformMatrix3fv(pt.U.uView, false, c.view);
      gl.uniform2fv(pt.U.uScale, c.scale); gl.uniform1f(pt.U.uHills, c.hills); gl.uniform1f(pt.U.uDpr, c.dpr); gl.uniform1f(pt.U.uTime, c.time);
      gl.uniform1f(pt.U.uTwinkle, c.twinkle); gl.uniform1f(pt.U.uLimit, c.limit); gl.uniform1f(pt.U.uDim, c.dim); gl.uniform1f(pt.U.uZoom, c.zoom);
      gl.uniform1f(pt.U.uExt, c.ext); gl.uniform1f(pt.U.uMaxPt, maxPt); gl.uniform1f(pt.U.uPremul, c.premul ? 1 : 0);
      gl.drawArrays(gl.POINTS, 0, B.n);
    }

    /** 双眼鏡・望遠鏡で足す暗い星（企画書 75 の 6）。押したときに 1 回だけ */
    let faintBufs = null;
    function setFaint(list) { if (!faintBufs) faintBufs = mk(starAttribs(list)); }
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

    /** 星の軌跡（企画書 75 の 5）の描きためる絵。画面の大きさが変わったら作り直す（中身は消える） */
    const trailFb = { fb: null, tex: null, w: 0, h: 0 };
    function trailTarget(w, h) {
      if (trailFb.fb && trailFb.w === w && trailFb.h === h) return false;
      if (trailFb.fb) { gl.deleteFramebuffer(trailFb.fb); gl.deleteTexture(trailFb.tex); }
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      Object.assign(trailFb, { fb, tex: t, w, h });
      return true;
    }

    /** 星座絵（企画書 75 の 3）。list は render/art.js の ART。画像は loadArt を呼んだときに初めて読む（遅延読み込み） */
    const arts = {};
    function setArt(list) {
      for (const a of list) {
        const n = a.mesh + 1, pos = new Float32Array(a.verts), uv = new Float32Array(n * n * 2), idx = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { uv[(j * n + i) * 2] = i / a.mesh; uv[(j * n + i) * 2 + 1] = j / a.mesh; }
        for (let j = 0; j < a.mesh; j++) for (let i = 0; i < a.mesh; i++) { const k = j * n + i; idx.push(k, k + 1, k + n, k + 1, k + n + 1, k + n); }
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
        arts[a.id] = { pos: buf(pos), uv: buf(uv), ib, count: idx.length, mask: a.mask, file: a.file, tex: null, at: 0, loading: false };
      }
    }
    function loadArt(base, onload) {
      for (const a of Object.values(arts)) {
        if (a.tex || a.loading || typeof Image === 'undefined') continue;
        a.loading = true;
        const img = new Image(); img.decoding = 'async';
        img.onload = () => {
          const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          a.tex = t; a.at = (typeof performance !== 'undefined' ? performance.now() : Date.now()); if (onload) onload();
        };
        img.src = base + a.file;
      }
    }
    function drawArt(o, starM, view, scale, hills, now) {
      for (const a of Object.values(arts)) {
        if (!a.tex) continue;
        const k = opts.instantTextures ? 1 : Math.min(1, (now - a.at) / 800);
        use(ar); bindAttr(ar, 'aPos', a.pos, 3); bindAttr(ar, 'aUV', a.uv, 2);
        gl.uniformMatrix3fv(ar.U.uHz, false, starM); gl.uniformMatrix3fv(ar.U.uView, false, view); gl.uniform2fv(ar.U.uScale, scale);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform1i(ar.U.uTex, 0);
        gl.uniform3fv(ar.U.uColor, o.color || [0.62, 0.72, 1.0]); gl.uniform1f(ar.U.uAlpha, (o.alpha == null ? 0.3 : o.alpha) * k);
        gl.uniform4fv(ar.U.uMask, a.mask); gl.uniform1f(ar.U.uHills, hills);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, a.ib); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawElements(gl.TRIANGLES, a.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    /** 実写の画像（企画書 75 の 4）。初めて要るときに読む */
    const photos = {};
    function loadPhoto(id, url, onload) {
      if (photos[id] || typeof Image === 'undefined') return;
      photos[id] = { tex: null, at: 0 };
      const img = new Image(); img.decoding = 'async';
      img.onload = () => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        photos[id].tex = t; photos[id].at = (typeof performance !== 'undefined' ? performance.now() : Date.now()); if (onload) onload(id);
      };
      img.src = url;
    }
    /** o: { id, clip:[x,y], bx:[x,y], by:[x,y]（クリップ座標）, alpha } */
    function drawPhoto(o, now) {
      const ph = photos[o.id]; if (!ph || !ph.tex) return;
      const k = opts.instantTextures ? 1 : Math.min(1, (now - ph.at) / 800);
      use(im); bindAttr(im, 'aC', quad, 2);
      gl.uniform2fv(im.U.uClip, o.clip); gl.uniform2fv(im.U.uBx, o.bx); gl.uniform2fv(im.U.uBy, o.by); gl.uniform1f(im.U.uAlpha, (o.alpha == null ? 1 : o.alpha) * k); gl.uniform1f(im.U.uSat, o.sat == null ? 1 : o.sat);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ph.tex); gl.uniform1i(im.U.uTex, 0);
      gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const photoState = () => Object.fromEntries(Object.entries(photos).map(([k, p]) => [k, !!p.tex]));
    const artState = () => Object.fromEntries(Object.entries(arts).map(([k, a]) => [k, !!a.tex]));

    /** 画面の縮尺（立体射影 → クリップ座標） */
    function scaleOf(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, m = Math.min(w, h);
      const k = st.zoom / Math.tan(st.fovDeg * Math.PI / 720);
      return [k * m / w, k * m / h];
    }

    /** 画面の上の線（CSS px の端点）を四角形に。batch: { segs:[[x1,y1,x2,y2(,端1の隙間,端2の隙間)],…], width(CSS px), color:[r,g,b], alpha, gap(px), dash(px) } */
    function drawQuadLines(batch, cssW, cssH, dpr) {
      const segs = batch.segs; if (!segs || !segs.length || batch.alpha <= 0) return;
      const half = (batch.width || 1.5) * 2.2, gap = batch.gap || 0, out = new Float32Array(segs.length * 6 * 4);
      let n = 0;
      const cx = (x) => x / cssW * 2 - 1, cy = (y) => 1 - y / cssH * 2;
      for (const sg of segs) {
        const [x1, y1, x2, y2] = sg, g1 = sg[4] == null ? gap : sg[4], g2 = sg[5] == null ? gap : sg[5];
        let dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy);
        if (len < g1 + g2 + 2) continue;
        dx /= len; dy /= len;
        const ax = x1 + dx * g1, ay = y1 + dy * g1, bx = x2 - dx * g2, by = y2 - dy * g2, nx = -dy * half, ny = dx * half, L2 = len - g1 - g2;
        const v = [[ax - nx, ay - ny, -1, 0], [ax + nx, ay + ny, 1, 0], [bx - nx, by - ny, -1, L2], [ax + nx, ay + ny, 1, 0], [bx + nx, by + ny, 1, L2], [bx - nx, by - ny, -1, L2]];
        for (const [x, y, s, u] of v) { out[n++] = cx(x); out[n++] = cy(y); out[n++] = s; out[n++] = u; }
      }
      if (!n) return;
      use(ql);
      gl.bindBuffer(gl.ARRAY_BUFFER, qlBuf); gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, n), gl.DYNAMIC_DRAW);
      bindAttr(ql, 'aXY', qlBuf, 2, 16, 0); bindAttr(ql, 'aV', qlBuf, 1, 16, 8); bindAttr(ql, 'aU', qlBuf, 1, 16, 12);
      const c = batch.color || [0.66, 0.77, 1];
      gl.uniform4f(ql.U.uColor, c[0], c[1], c[2], batch.alpha);
      gl.uniform1f(ql.U.uCore, (batch.width || 1.5) / 2 / half * 1.0 + 0.12);
      gl.uniform1f(ql.U.uDash, batch.dash || 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, n / 4);
    }

    /** 板を 1 枚。o: { mode(0 光・1 太陽・2 惑星・3 月), x, y（CSS px）, size（CSS px の一辺の半分）, color, alpha, r（円盤の半径 0〜1）, sun（右・上・手前）, rot, aspect, ring, bands } */
    function drawSprite(o, cssW, cssH, now) {
      use(sp); bindAttr(sp, 'aC', quad, 2);
      gl.uniform2f(sp.U.uClip, o.x / cssW * 2 - 1, 1 - o.y / cssH * 2);
      gl.uniform2f(sp.U.uHalf, o.size / cssW * 2, o.size / cssH * 2);
      gl.uniform1f(sp.U.uRot, o.rot || 0); gl.uniform1i(sp.U.uMode, o.mode); gl.uniform3fv(sp.U.uColor, o.color || [1, 1, 1]);
      gl.uniform1f(sp.U.uAlpha, o.alpha == null ? 1 : o.alpha); gl.uniform1f(sp.U.uR, o.r || 0.3);
      gl.uniform3fv(sp.U.uSunDir, o.sun || [0, 0, 1]); gl.uniform1f(sp.U.uAspect, o.aspect || 1);
      gl.uniform1f(sp.U.uRing, o.ring ? 1 : 0); gl.uniform1f(sp.U.uBands, o.bands || 0); gl.uniform1f(sp.U.uEarth, o.earth || 0); gl.uniform1f(sp.U.uOcc, o.occ == null ? 1 : o.occ); gl.uniform4fv(sp.U.uShadow, o.shadow || [0, 0, 0, 0]);
      gl.activeTexture(gl.TEXTURE0); const mt = o.mode === 3 ? tex.moon : null;
      gl.bindTexture(gl.TEXTURE_2D, mt || blank); gl.uniform1i(sp.U.uTex, 0); gl.uniform1f(sp.U.uHasTex, mt ? texK('moon', now) : 0);
      gl.blendFunc(gl.SRC_ALPHA, o.mode === 0 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * 1 フレーム描く。st = { starM, H（行優先）, az, alt, zoom, fovDeg, dpr, time, twinkle(0/1), limit, twilight(0..1), dusk(0..1),
     *   milky(0..1), noise(bool), hills(bool), moon:{clip,size,k,angle}|null, lineAlpha, allLines(0..), meteor:{a:[x,y],b:[x,y],w,alpha}|null,
     *   企画書 74 で足したもの（省略すると前と同じ夜の空）:
     *   sky: { sun:[h], day, glow, moon:[h], moonK, ext(0/1) }, sprites:[…]（星の前・線の後）, quads:[…]（星座線など。CSS px）, cssW, cssH, now }
     */
    function draw(st) {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, now = st.now || 0;
      const cssW = st.cssW || w / (st.dpr || 1), cssH = st.cssH || h / (st.dpr || 1);
      gl.viewport(0, 0, w, h);
      const V = viewMatrix(st.az, st.alt), scale = scaleOf(st), hills = st.hills ? 1 : 0, sky = st.sky || {};
      // 空・大気・山並み・天の川
      gl.disable(gl.BLEND);
      use(bg); bindAttr(bg, 'aXY', tri, 2);
      gl.uniformMatrix3fv(bg.U.uViewT, false, S.toColumnMajor(transpose(V)));
      gl.uniformMatrix3fv(bg.U.uStarT, false, S.toColumnMajor(transpose(st.starM)));
      gl.uniformMatrix3fv(bg.U.uGal, false, S.toColumnMajor(L.GAL));
      gl.uniform2fv(bg.U.uScale, scale);
      const mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
      let hor = mixc(L.hex(L.SKY.horizon), L.hex(L.SKY.twilight), st.twilight), zen = L.hex(L.SKY.zenith);
      if (st.dusk > 0) { hor = mixc(hor, L.hex(L.INTRO.duskHorizon), st.dusk); zen = mixc(zen, L.hex(L.INTRO.duskZenith), st.dusk); }
      gl.uniform3fv(bg.U.uZen, zen); gl.uniform3fv(bg.U.uHor, hor); gl.uniform3fv(bg.U.uGround, L.hex(L.SKY.ground));
      gl.uniform1f(bg.U.uHills, hills); gl.uniform1f(bg.U.uNoise, st.noise ? 1 : 0);
      if (mw) { gl.uniform4fv(bg.U.uMW, mw.v); gl.uniform1fv(bg.U.uMWd, mw.d); gl.uniform1i(bg.U.uMWn, mw.n); }
      gl.uniform1f(bg.U.uMWk, mw ? st.milky : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.milky || blank); gl.uniform1i(bg.U.uTex, 0);
      gl.uniform1f(bg.U.uTexK, st.milkyTex === false ? 0 : texK('milky', now));
      gl.uniform3fv(bg.U.uSun, sky.sun || [0, 0, -1]); gl.uniform1f(bg.U.uDay, sky.day || 0); gl.uniform1f(bg.U.uGlow, sky.glow || 0);
      gl.uniform3fv(bg.U.uMoon, sky.moon || [0, 0, -1]); gl.uniform1f(bg.U.uMoonK, sky.moonK || 0); gl.uniform1f(bg.U.uCity, sky.city || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 星雲・銀河（星の後ろ）
      gl.enable(gl.BLEND);
      // 実写の画像（星の後ろ。企画書 75 の 4）
      for (const o of st.photos || []) drawPhoto(o, now);
      // 星座絵（星の後ろ。企画書 75 の 3）
      if (st.art && st.art.alpha > 0) drawArt(st.art, S.toColumnMajor(st.starM), S.toColumnMajor(V), scale, hills, now);
      for (const o of st.glows || []) drawSprite(o, cssW, cssH, now);
      // 星・惑星（加算合成）
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      // 点の大きさは拡大 3 倍までで止める（星雲へのズーム・双眼鏡で何十倍にしても、星は点のまま。企画書 75）
      const common = { view: S.toColumnMajor(V), scale, dpr: st.dpr, time: st.time, twinkle: st.twinkle, zoom: Math.min(st.zoom, st.pointZoom || 3), hills, ext: sky.ext ? 1 : 0,
        limit: st.sky ? st.limit : Math.min(st.limit, L.STAR_LIMIT + 0.1 - 4.6 * Math.max(st.twilight, st.dusk)),
        dim: st.sky ? (sky.dim == null ? 1 : sky.dim) : 1 - 0.6 * Math.max(st.twilight, st.dusk) };
      if (st.trail) {
        // 星の軌跡: 描きためる絵へ（明るい方を残す合成。無い端末は足し合わせ）→ 少しずつ暗くする → 画面に足す
        const fresh = trailTarget(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, trailFb.fb); gl.viewport(0, 0, w, h);
        if (st.trail.reset || fresh) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
        else if (st.trail.fade > 0) {
          use(fd); bindAttr(fd, 'aXY', tri, 2); gl.uniform1f(fd.U.uFade, st.trail.fade);
          gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.blendEquation(gl.FUNC_ADD);
        }
        const tc = Object.assign({}, common, { twinkle: 0, premul: true });
        if (minmax) gl.blendEquation(minmax.MAX_EXT); gl.blendFunc(gl.ONE, gl.ONE);
        for (const M of st.trail.steps || [st.starM]) drawPoints(starBufs, S.toColumnMajor(M), tc);
        for (const Hm of st.trail.bodySteps || [st.H]) if (bodyBufs) drawPoints(bodyBufs, S.toColumnMajor(Hm), Object.assign({}, tc, { limit: 9 }));
        gl.blendEquation(gl.FUNC_ADD);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
        use(cp); bindAttr(cp, 'aXY', tri, 2); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trailFb.tex); gl.uniform1i(cp.U.uTex, 0);
        gl.uniform1f(cp.U.uAlpha, 1); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      } else {
        drawPoints(starBufs, S.toColumnMajor(st.starM), common);
        if (st.faint && faintBufs) drawPoints(faintBufs, S.toColumnMajor(st.starM), Object.assign({}, common, { twinkle: 0 }));
        if (bodyBufs) drawPoints(bodyBufs, S.toColumnMajor(st.H), Object.assign({}, common, { limit: 9, twinkle: 0 }));
      }
      // 星座線（GPU の細い線。ポスター）
      const c = L.hex(L.LINE.color);
      const drawLines = (L2, alpha) => {
        if (!L2.b || alpha <= 0) return;
        use(ln); bindAttr(ln, 'aPos', L2.b, 3);
        gl.uniformMatrix3fv(ln.U.uHz, false, S.toColumnMajor(st.starM)); gl.uniformMatrix3fv(ln.U.uView, false, common.view);
        gl.uniform2fv(ln.U.uScale, scale); gl.uniform1f(ln.U.uHills, hills);
        gl.uniform4f(ln.U.uColor, c[0], c[1], c[2], alpha);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
      // 画面の上の柔らかい線（星座線・大三角）
      for (const q of st.quads || []) drawQuadLines(q, cssW, cssH, st.dpr || 1);
      // 流れ星
      for (const m of (st.meteors || []).concat(st.meteor ? [st.meteor] : [])) {
        const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], len = Math.hypot(dx * w, dy * h) || 1;
        const nx = -dy * h / len * m.w / w, ny = dx * w / len * m.w / h;
        gl.bindBuffer(gl.ARRAY_BUFFER, metXY);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([m.a[0] - nx * 0.2, m.a[1] - ny * 0.2, m.a[0] + nx * 0.2, m.a[1] + ny * 0.2, m.b[0] - nx, m.b[1] - ny, m.b[0] + nx, m.b[1] + ny]));
        use(me); bindAttr(me, 'aXY', metXY, 2); bindAttr(me, 'aT', metT, 1);
        gl.uniform1f(me.U.uA, m.alpha);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // 太陽・惑星・月（板）
      for (const o of st.sprites || []) drawSprite(o, cssW, cssH, now);
      // 月（ポスターなど、前の形の指定 {clip,size,k,angle}）: 満ち欠けの角度から太陽の向きを作って同じ球で描く
      if (st.moon) {
        const m = st.moon, ci = 2 * m.k - 1, si = Math.sqrt(Math.max(0, 1 - ci * ci));
        const sizeCss = m.size / (st.dpr || 1) / 2;
        drawSprite({ mode: 3, x: (m.clip[0] + 1) / 2 * cssW, y: (1 - m.clip[1]) / 2 * cssH, size: sizeCss, r: 0.3, color: [0.97, 0.95, 0.88],
          sun: [si * Math.cos(m.angle), si * Math.sin(m.angle), ci], rot: m.north || 0, earth: 0.06, alpha: 1 }, cssW, cssH, now);
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
    /** 画面の 1° が何 CSS px か（画面の中心で） */
    function pxPerDeg(st, cssW, cssH) { return st.zoom / Math.tan(st.fovDeg * Math.PI / 720) * Math.min(cssW, cssH) / 2 * (Math.PI / 180) / 2; }

    return { gl, draw, setBodies, setLines, project, pxPerDeg, setArt, loadArt, artState, loadPhoto, photoState, trailMax: !!minmax, setFaint, faintCount: () => (faintBufs ? faintBufs.n : 0), textures: () => ({ milky: !!tex.milky, moon: !!tex.moon }) };
  }

  root.NightRender = { create, viewMatrix, starAttribs, milkyUniforms, MWN };
})(window);
