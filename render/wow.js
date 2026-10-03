'use strict';
/* フル版だけの機能（企画書 75「軽量版と差別化する 8 つ」、オーナー決定 2026-10-03）の決まり。
   描画（render/night-gl.js）と画面（app/night.js）から読む。天文の計算はここに持たない（engine/ の写しを呼ぶ）。
   ブラウザでも Node（テスト）でも読める。
     1 ジャイロ（端末の向き → 見る方位・高度。磁北 → 真北は WMM2025 の偏角）
     2 街明かり（空の明るさ → 見える星の限界・天の川・空の色）
     3 星座絵（ヘヴェリウス 1690。位置合わせと網は tools/build-art.py → render/art.js。押したときに初めて読む）
     4 星雲・星団へのズーム（ESA/Hubble の実写。tools/build-dso.py → render/dso.js。画像の向きと大きさを空に合わせる）
     5 星の軌跡（時間を早回しし、星を別の絵に描きためて少しずつ暗くする。動きを減らす設定では 2 時間分を 1 枚に）
     6 双眼鏡・望遠鏡（円い視野で拡大し、限界等級を口径の分だけ上げる。暗い星はヒッパルコス星表 render/hip.js を押したときに読む）
     7 イベントの再生（次の皆既月食・流星群の極大。日付は engine/official-events.js（国立天文台の発表の写し）、欠けの時刻はこのサイトの計算）
   （8 は順に足す） */
(function (root) {
  const W = (typeof module !== 'undefined') ? require('./wmm.js') : root.NightWMM;
  // eslint-disable-next-line no-undef
  const A = (typeof module !== 'undefined') ? require('../engine/astro.js') : { sun, moon, altAz, lstRad, precessor, DEG };
  const D = Math.PI / 180;

  /* ---------- 1 ジャイロ ---------- */

  /**
   * 地磁気の偏角（度。東が正）。WMM2025（render/wmm.js、NOAA NCEI）の 12 次の球面調和関数をそのまま計算する。
   * lat・lon は測地緯度・経度（度）、hKm は楕円体からの高さ（km）、year は年（小数。例 2026.75）
   * 戻り値 { decl, incl, X, Y, Z }（nT は北・東・下）
   */
  function magnetic(lat, lon, hKm, year) {
    const N = 12, a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), Re = 6371.2;
    const phi = lat * D, lam = lon * D;
    const rc = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const p = (rc + hKm) * Math.cos(phi), z = (rc * (1 - e2) + hKm) * Math.sin(phi);
    const r = Math.hypot(p, z), phc = Math.asin(z / r);            // 地心緯度
    const dt = year - W.EPOCH;
    const g = [], h = [];
    for (let n = 0; n <= N; n++) { g.push(new Array(N + 1).fill(0)); h.push(new Array(N + 1).fill(0)); }
    for (const [n, m, gv, hv, gd, hd] of W.COF) { g[n][m] = gv + gd * dt; h[n][m] = hv + hd * dt; }
    // シュミットの準正規化ルジャンドル関数（余緯度 θ）とその θ 微分
    const ct = Math.sin(phc), st = Math.cos(phc);                   // cos θ・sin θ
    const P = [], dP = [], S = [];
    for (let n = 0; n <= N; n++) { P.push(new Array(N + 1).fill(0)); dP.push(new Array(N + 1).fill(0)); S.push(new Array(N + 1).fill(0)); }
    P[0][0] = 1; S[0][0] = 1;
    for (let n = 1; n <= N; n++) {
      S[n][0] = S[n - 1][0] * (2 * n - 1) / n;
      for (let m = 1; m <= n; m++) S[n][m] = S[n][m - 1] * Math.sqrt((n - m + 1) * (m === 1 ? 2 : 1) / (n + m));
      for (let m = 0; m <= n; m++) {
        if (n === m) { P[n][m] = st * P[n - 1][m - 1]; dP[n][m] = st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1]; }
        else if (n === 1) { P[n][m] = ct * P[n - 1][m]; dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m]; }
        else {
          const K = n > 1 ? ((n - 1) ** 2 - m * m) / ((2 * n - 1) * (2 * n - 3)) : 0;
          P[n][m] = ct * P[n - 1][m] - (m > n - 2 ? 0 : K * P[n - 2][m]);
          dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m] - (m > n - 2 ? 0 : K * dP[n - 2][m]);
        }
      }
    }
    let Bt = 0, Bp = 0, Br = 0;
    for (let n = 1; n <= N; n++) {
      const ar = Math.pow(Re / r, n + 2);
      for (let m = 0; m <= n; m++) {
        const cm = Math.cos(m * lam), sm = Math.sin(m * lam), gs = g[n][m] * S[n][m], hs = h[n][m] * S[n][m];
        const pnm = P[n][m] * ar, dpnm = dP[n][m] * ar;
        Br += (n + 1) * (gs * cm + hs * sm) * pnm;
        Bt -= (gs * cm + hs * sm) * dpnm;
        Bp += m * (gs * sm - hs * cm) * pnm / (st || 1e-12);
      }
    }
    // 地心（北 = −Bt、東 = Bp、下 = −Br）→ 測地
    const Xc = -Bt, Yc = Bp, Zc = -Br, psi = phc - phi;
    const X = Xc * Math.cos(psi) - Zc * Math.sin(psi), Y = Yc, Z = Xc * Math.sin(psi) + Zc * Math.cos(psi);
    return { decl: Math.atan2(Y, X) / D, incl: Math.atan2(Z, Math.hypot(X, Y)) / D, X, Y, Z };
  }
  /** 日時（UNIX ミリ秒）→ 年（小数） */
  function decimalYear(ms) {
    const d = new Date(ms), y = d.getUTCFullYear(), a = Date.UTC(y, 0, 1), b = Date.UTC(y + 1, 0, 1);
    return y + (ms - a) / (b - a);
  }
  /** 偏角（度）。WMM2025 の期間（2025.0〜2030.0）の外は期間の端の値（それでも 0.5° も変わらない） */
  const declination = (lat, lon, ms) => magnetic(lat, lon, 0, Math.max(W.EPOCH, Math.min(W.EPOCH + 5, decimalYear(ms)))).decl;

  /**
   * 端末の向き（DeviceOrientationEvent の alpha・beta・gamma。度）→ 背面カメラが向く方位・高度（ラジアン）。
   * W3C「DeviceOrientation Event」の回転の順（Z-X'-Y''）。alpha の基準が北なら方位は北からの角度（東回り）。
   * screen は画面の回転（screen.orientation.angle、度）。画面の向きにかかわらず「背面が向く所」は同じなので、
   * 方位・高度には効かないが、画面の上の向き（roll）を返すのに使う
   */
  function deviceView(alpha, beta, gamma, screen = 0) {
    const a = alpha * D, b = beta * D, c = gamma * D;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    // R = Rz(a)·Rx(b)·Ry(c)（端末 → 地表: x 東・y 北・z 天頂）
    const R = [
      ca * cc - sa * sb * sc, -sa * cb, ca * sc + sa * sb * cc,
      sa * cc + ca * sb * sc, ca * cb, sa * sc - ca * sb * cc,
      -cb * sc, sb, cb * cc,
    ];
    const back = [-R[2], -R[5], -R[8]];                             // 端末の −z（背面）
    const alt = Math.asin(Math.max(-1, Math.min(1, back[2])));
    let az = Math.atan2(back[0], back[1]);
    // 真上・真下に近いと方位が決まらないので、端末の上（+y、画面の回転を入れる）の向きで決める
    const s = screen * D, up = [R[1] * Math.cos(s) - R[0] * Math.sin(s), R[4] * Math.cos(s) - R[3] * Math.sin(s), R[7] * Math.cos(s) - R[6] * Math.sin(s)];
    if (Math.hypot(back[0], back[1]) < 0.05) az = Math.atan2(up[0], up[1]) + (back[2] > 0 ? Math.PI : 0);
    return { az: ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), alt, up };
  }

  /**
   * iPhone（webkitCompassHeading）: alpha の基準が起動時の向きなので、磁北からの方位 heading との差を足す。
   * 端末を水平に近く持ったとき（|beta|・|gamma| が 35° 未満）だけ差を測り直し、なめらかに追う（コンパスのぶれを抑える）
   * 戻り値は新しい差（度）。prev が null なら初めの値
   */
  function compassOffset(prev, alpha, beta, gamma, heading, k = 0.15) {
    if (heading == null || !isFinite(heading)) return prev;
    const flat = Math.abs(beta) < 35 && Math.abs(gamma) < 35;
    if (!flat && prev != null) return prev;
    const want = (((360 - heading) - alpha) % 360 + 540) % 360 - 180;
    if (prev == null) return want;
    const d = ((want - prev) % 360 + 540) % 360 - 180;
    return prev + d * k;
  }
  /** コンパスの精度（webkitCompassAccuracy、度。負は不明）が悪いときは 8 の字に回して直す案内を出す */
  const GYRO = { badAccuracy: 25, noEventMs: 1500, smooth: 0.25 };
  const needCalibration = (acc) => acc != null && (acc < 0 || acc > GYRO.badAccuracy);
  /** 角度のなめらかな追従（方位は近いほうへ回る） */
  function follow(cur, want, k, wrap) {
    if (!wrap) return cur + (want - cur) * k;
    let d = ((want - cur + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return ((cur + d * k) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  }

  /* ---------- 2 街明かり ----------
     つまみ u（0 = 田舎 … 1 = 都会）→ 空の明るさ（等級/平方秒角、V に近い値として扱う）→ 肉眼の限界等級。
     限界等級の式は Schaefer (1990) PASP 102:212 を K. Fisher（Unihedron）がまとめたもの:
       NELM = 7.93 − 5·log10(10^(4.316 − B/5) + 1)  （http://unihedron.com/projects/darksky/NELM2BCalc.html、2026-10-03 に確認）
     天の川の見え方・空の色の付け方は、このサイトの近似（出典のある値ではない）。 */
  const LIGHT = { dark: 21.9, city: 17.5, steps: 20 };
  /** u → 空の明るさ（等級/平方秒角） */
  const skyMag = (u) => LIGHT.dark + (LIGHT.city - LIGHT.dark) * Math.max(0, Math.min(1, u));
  /** 空の明るさ → 肉眼の限界等級（Schaefer 1990） */
  const nelm = (B) => 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - B / 5) + 1);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /**
   * 街明かりの効き方。limit: 限界等級、milky: 天の川の濃さ（0〜1）、glow: 空の明るさの増え方（0〜1。自然の空 21.9 からの比を対数で）
   * label: 0 田舎・1 郊外・2 都会（表示用）
   */
  function lightPollution(u) {
    const B = skyMag(u), lim = nelm(B);
    const excess = Math.pow(10, -0.4 * (B - LIGHT.dark)) - 1, max = Math.pow(10, -0.4 * (LIGHT.city - LIGHT.dark)) - 1;
    return { sky: B, limit: lim, milky: smooth(4.6, 6.2, lim), glow: Math.log10(1 + excess) / Math.log10(1 + max), label: u < 0.34 ? 0 : u < 0.67 ? 1 : 2 };
  }

  /* ---------- 4 星雲・星団へのズーム ---------- */
  const vecRD = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  /**
   * 画像（render/dso.js の 1 件: ra・dec・w・h（度）・rot（北が画像の上から反時計回り、度））の中心と、
   * 右の辺の中点・上の辺の中点の J2000 の向き。描くときはこの 3 点を画面に写して四角を決める（小さい天体なので平らとみなせる）
   */
  function photoCorners(rec) {
    const ra = rec.ra * D, dec = rec.dec * D, r = rec.rot * D;
    const c = vecRD(ra, dec), E = [-Math.sin(ra), Math.cos(ra), 0], N = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
    const at = (dE, dN) => { const v = c.map((x, i) => x + dE * E[i] + dN * N[i]), m = Math.hypot(...v); return v.map((x) => x / m); };
    const hw = rec.w / 2 * D, hh = rec.h / 2 * D;
    return { c, right: at(-Math.cos(r) * hw, -Math.sin(r) * hw), top: at(-Math.sin(r) * hh, Math.cos(r) * hh) };
  }
  const ZOOM_DEEP = 160;   // ズーム・双眼鏡のときの拡大の上限（ふだんは 3 倍）
  /** 天体がちょうど画面に収まる拡大（画面の短い辺の 9 割に、天体の長い辺の 1.25 倍）。描画器と同じ縮尺の式 */
  const zoomFor = (rec, fovDeg) => Math.min(ZOOM_DEEP, 0.9 * 4 * Math.tan(fovDeg * Math.PI / 720) / (Math.max(rec.w, rec.h) * 1.25 * D));
  /** 天体の高度（度）。J2000 → その日（engine の precessor） */
  function altOf(ms, lat, lon, raDeg, decDeg) {
    const [ra, dec] = A.precessor(ms)(raDeg * D, decDeg * D);
    return A.altAz(Math.sin(dec), Math.cos(dec), ra, A.lstRad(ms, lon), Math.sin(lat * D), Math.cos(lat * D))[0] / D;
  }
  function sunAlt(ms, lat, lon) { const S = A.sun(ms); return A.altAz(Math.sin(S.dec), Math.cos(S.dec), S.ra, A.lstRad(ms, lon), Math.sin(lat * D), Math.cos(lat * D))[0] / D; }
  /**
   * いま見やすいか（高度 25° 以上・太陽 −12° 以下）。見にくければ 36 時間のうちで見やすい最初の時刻（10 分きざみ）、無ければ null
   */
  function viewTime(ms, lat, lon, raDeg, decDeg) {
    const ok = (t) => altOf(t, lat, lon, raDeg, decDeg) >= 25 && sunAlt(t, lat, lon) <= -12;
    if (ok(ms)) return ms;
    for (let t = ms + 600e3; t <= ms + 36 * 3600e3; t += 600e3) if (ok(t)) return t + 1800e3 <= ms + 36 * 3600e3 && ok(t + 1800e3) ? t + 1800e3 : t;
    return null;
  }

  /* ---------- 5 星の軌跡 ---------- */
  // speed: 時間の進み（倍）、fadePerSec: 1 秒に暗くする量（0〜1。8 ビットの絵なので 1/255 ずつ）、static: 動きを減らす設定のとき 1 枚に描く時間（時間）と回数
  const TRAIL = { speed: 600, fadePerSec: 0.08, staticHours: 2, staticSteps: 120 };
  /** 暗くする量を 1/255 単位にためて返す（acc は持ち越し）。dt は秒 */
  function trailFade(acc, dt) {
    const a = acc + TRAIL.fadePerSec * Math.max(0, Math.min(0.25, dt)), n = Math.floor(a * 255);
    return { fade: n / 255, acc: a - n / 255 };
  }
  /** 動きを減らす設定のときの、1 枚に描く時刻（ms の配列。いまから過去へ） */
  const trailTimes = (ms) => Array.from({ length: TRAIL.staticSteps + 1 }, (_, k) => ms - k * TRAIL.staticHours * 3600e3 / TRAIL.staticSteps);

  /* ---------- 6 双眼鏡・望遠鏡 ----------
     限界等級は、肉眼（瞳 7 mm）より光を集める面積が (口径/7)² 倍なので 5·log10(口径/7) 等だけ暗い星まで（等級の定義からの換算）。
     ただし描ける星はヒッパルコス星表の 8.5 等まで（catalogLimit）。実視界は双眼鏡 7°（7×50 の一般的な値）、望遠鏡 1.2° */
  const SCOPE = { modes: { bino: { power: 7, aperture: 50, field: 7.0 }, tele: { power: 40, aperture: 80, field: 1.2 } },
    eyePupil: 7, catalogLimit: 8.5, frac: 0.45, hipparcos: true };
  const scopeLimit = (eyeLimit, aperture) => Math.min(SCOPE.catalogLimit, eyeLimit + 5 * Math.log10(aperture / SCOPE.eyePupil));
  /** 円い視野（画面の短い辺 × frac の半径）にちょうど実視界が入る拡大。描画器と同じ縮尺の式 */
  const scopeZoom = (field, fovDeg) => 2 * SCOPE.frac * 4 * Math.tan(fovDeg * Math.PI / 720) / (field * D);
  /** render/hip.js の base64 → [{ v: J2000 の単位ベクトル, mag, bv }]。decode は atob か Buffer */
  function decodeHip(H, decode) {
    const bin = decode(H.b64), out = [];
    for (let i = 0; i < H.n; i++) {
      const o = i * 6, ra = ((bin[o] | (bin[o + 1] << 8)) / 65536) * 2 * Math.PI;
      let de = bin[o + 2] | (bin[o + 3] << 8); if (de > 32767) de -= 65536;
      const dec = de / 32767 * Math.PI / 2, mag = 6 + bin[o + 4] / 100, b = bin[o + 5] > 127 ? bin[o + 5] - 256 : bin[o + 5];
      out.push({ v: vecRD(ra, dec), mag, bv: b / 50 });
    }
    return out;
  }

  /* ---------- 7 イベントの再生 ----------
     月食: 地球の影の大きさはダンジョンの規則（大気の分で 1/50 大きく）:
       本影の半径 = 1.02 ×（月の視差 − 太陽の視半径 + 太陽の視差）、半影の半径 = 1.02 ×（月の視差 + 太陽の視半径 + 太陽の視差）
     月と太陽の位置は engine/astro.js（通常版の写し）。2026-03-03 の皆既月食で国立天文台の発表（欠け始め 18:49.8・皆既 20:04.0〜21:03.4・
     終わり 22:17.6・食分 1.156。official-events.js の tokyo）と数分以内・食分 0.03 以内になることを tests/wow.test.js で確かめる */
  const ECL = { k: 1.02, sunSemi: 0.2666, sunPar: 8.794 / 3600, moonK: 0.2725 };
  function eclipseAt(ms) {
    const S = A.sun(ms), M = A.moon(ms);
    const ar = S.ra + Math.PI, ad = -S.dec;   // 影の中心（太陽の反対）
    const c = Math.sin(ad) * Math.sin(M.dec) + Math.cos(ad) * Math.cos(M.dec) * Math.cos(M.ra - ar);
    const sep = Math.acos(Math.max(-1, Math.min(1, c))) / D, pm = M.parallax / D;
    const ss = ECL.sunSemi / S.dist, ps = ECL.sunPar / S.dist;
    let dra = ar - M.ra; dra = Math.atan2(Math.sin(dra), Math.cos(dra));
    return { sep, umbra: ECL.k * (pm - ss + ps), penumbra: ECL.k * (pm + ss + ps), moonR: ECL.moonK * pm,
      dE: dra * Math.cos(M.dec) / D, dN: (ad - M.dec) / D };
  }
  /** その日（日本時間）の前後で月食の各時刻（UNIX ミリ秒）。u1 欠け始め・u2 皆既の始まり・max 食の最大・u3 皆既の終わり・u4 終わり、mag 食分 */
  function eclipseContacts(date) {
    const t0 = Date.parse(date + 'T00:00:00+09:00') - 12 * 3600e3;
    let best = null;
    for (let t = t0; t < t0 + 48 * 3600e3; t += 120e3) { const e = eclipseAt(t); if (!best || e.sep < best.sep) best = { t, sep: e.sep }; }
    for (let t = best.t - 120e3; t <= best.t + 120e3; t += 5e3) { const e = eclipseAt(t); if (e.sep < best.sep) best = { t, sep: e.sep }; }
    const e0 = eclipseAt(best.t), out = { max: best.t, mag: (e0.umbra + e0.moonR - e0.sep) / (2 * e0.moonR) };
    const cross = (f, dir) => {   // 最大から dir の向きに、f が 0 を越える時刻
      let a = best.t, fa = f(eclipseAt(a));
      if (fa > 0) return null;
      for (let t = best.t + dir * 60e3; Math.abs(t - best.t) < 5 * 3600e3; t += dir * 60e3) {
        const ft = f(eclipseAt(t));
        if (ft > 0) { let lo = a, hi = t; for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (f(eclipseAt(m)) > 0) hi = m; else lo = m; } return Math.round((lo + hi) / 2); }
        a = t;
      }
      return null;
    };
    const outer = (e) => e.sep - (e.umbra + e.moonR), inner = (e) => e.sep - (e.umbra - e.moonR);
    out.u1 = cross(outer, -1); out.u4 = cross(outer, 1); out.u2 = cross(inner, -1); out.u3 = cross(inner, 1);
    return out;
  }
  /** 月の欠け具合（0〜1。1 = 欠けていない）。月明かりを弱めるのに使う（本影にかかった割合の近似） */
  function eclipseLight(e) {
    if (e.sep > e.penumbra + e.moonR) return 1;
    const umb = Math.max(0, Math.min(1, (e.umbra + e.moonR - e.sep) / (2 * e.moonR)));
    const pen = Math.max(0, Math.min(1, (e.penumbra + e.moonR - e.sep) / (2 * e.moonR)));
    return Math.max(0.02, 1 - 0.97 * umb - 0.25 * pen * (1 - umb));
  }
  // 放射点（J2000 の赤経・赤緯、度）。通常版の tools/calendar-pages.js の SHOWERS の radiant と同じ（tools/sync-from-sanpo.mjs --check が突き合わせる）。
  // 通常版に放射点の無い流星群は再生しない（向きを作らない）
  const RADIANTS = { perseids: [48, 58], geminids: [112, 33], quadrantids: [230, 49] };
  /** これからのイベント: 次の皆既月食（日本で見えるかは表のまま）と、放射点のある流星群の極大の次の 3 件 */
  function upcoming(nowMs, O) {
    const today = new Date(nowMs + 9 * 3600e3).toISOString().slice(0, 10), out = [];
    const ecl = O.ECLIPSES.find((e) => e.body === 'moon' && e.type === '皆既月食' && e.date >= today);
    if (ecl) out.push({ kind: 'eclipse', date: ecl.date, type: ecl.type, japan: ecl.japan, src: ecl.src, c: eclipseContacts(ecl.date) });
    for (const m of O.METEOR_PEAKS) {
      if (!RADIANTS[m.shower] || Date.parse(m.view) < nowMs - 6 * 3600e3) continue;
      out.push({ kind: 'meteor', shower: m.shower, peak: m.peak, view: Date.parse(m.view), rate: m.rate, src: m.src, radiant: RADIANTS[m.shower] });
      if (out.filter((x) => x.kind === 'meteor').length >= 3) break;
    }
    return out;
  }
  /** 「1時間に60個程度」→ 60（範囲なら大きいほう）。読めなければ 10 */
  const ratePerHour = (txt) => { const m = String(txt || '').match(/(\d+)(?:〜(\d+))?個/); return m ? +(m[2] || m[1]) : 10; };
  /** 再生中の流れ星の間隔（秒）: 1 時間あたりの数 × 早回しの倍率。速すぎ・遅すぎは 0.35〜3 秒に収める */
  const meteorGap = (perHour, speed) => Math.max(0.35, Math.min(3, 3600 / (perHour * speed)));
  /** 放射点 R（地平座標の単位ベクトル）から出る流れ星: 放射点から 8〜55° の点 p と、放射点から遠ざかる向き q */
  function radiantMeteor(R, u1, u2) {
    const d = (8 + 47 * u1) * D, az = u2 * 2 * Math.PI;
    let a = Math.abs(R[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm3(cross3(R, a)), e2 = cross3(R, e1);
    const p = [0, 1, 2].map((i) => R[i] * Math.cos(d) + (e1[i] * Math.cos(az) + e2[i] * Math.sin(az)) * Math.sin(d));
    const cd = R[0] * p[0] + R[1] * p[1] + R[2] * p[2];
    return { p, q: norm3(p.map((x, i) => x * cd - R[i])) };
  }
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (v) => { const m = Math.hypot(...v); return v.map((x) => x / m); };
  const EVENT = { eclipseSpeed: 600, meteorSpeed: 600, meteorBeforeH: 2, meteorAfterH: 1, eclipseLeadMin: 20, eclipseZoom: 10 };

  /* ---------- 文字（新しい UI の文字列。英語は k132-wow2-en-review.md でオーナーの承認待ち） ---------- */
  const TEXT = {
    ja: {
      bGyro: ['ジャイロ', 'ジャイロ'],
      gyroOn: ['スマホを空にかざすと、その方向の星が出ます', 'スマホを そらに むけてね'],
      gyroOff: ['ジャイロを止めました。ドラッグで見まわせます', 'ジャイロを とめたよ'],
      gyroDenied: ['向きのセンサーが使えないので、ドラッグのままです', 'むきの センサーが つかえないよ'],
      gyroCalib: ['方位がずれるときは、スマホを 8 の字に回してください', 'スマホを 8の じに まわしてね'],
      gyroRelative: ['北の向きが分からない端末なので、いまの向きを基準にします', 'いまの むきから うごかすよ'],
      bLight: ['街明かり', 'まちの あかり'],
      lightLabels: [['田舎', '郊外', '都会'], ['いなか', 'まちの そと', 'まち']],
      lightRead: [(B, m) => `空の明るさ ${B.toFixed(1)} 等/平方秒角 · 見える星 ${m.toFixed(1)} 等まで`, (B, m) => `みえる ほしは ${m.toFixed(1)}とう まで`],
      lightNote: ['限界等級は Schaefer (1990) の式。天の川と空の色は目安です', 'まちが あかるいと くらい ほしは みえないよ'],
      bArt: ['星座絵', 'せいざの え'],
      artToast: ['ヘヴェリウスの星座絵（1690 年）を重ねました。オリオン・ふたご・しし・おおぐま', 'むかしの せいざの えを かさねたよ'],
      bDso: ['星雲・星団', 'せいうん'],
      dsoTitle: ['ズームする天体', 'ズームする てんたい'],
      dsoPhoto: ['実写の画像（ESA/Hubble、CC BY 4.0）。星の点は星表の位置で重ねています', 'ほんものの しゃしんだよ'],
      dsoCredit: ['画像', 'しゃしん'],
      dsoChanged: ['（注記の線と文字を消して使用）', '（せんと もじを けしたよ）'],
      dsoMoved: ['いまは見にくいので、見やすい時刻へ移りました', 'みやすい じかんに うごいたよ'],
      dsoNone: ['この 36 時間は見やすい時刻がありません', 'しばらく みえないよ'],
      dsoBack: ['もとの広さに戻る', 'もとに もどる'],
      bTrail: ['星の軌跡', 'ほしの きせき'],
      trailOn: ['時間を 600 倍で進めて、星の動いたあとを光の筋で残します', 'ほしの うごいた あとが ひかりの すじに なるよ'],
      trailStatic: ['動きを減らす設定なので、2 時間分の軌跡を 1 枚で出します', '2じかんぶんの ほしの あとだよ'],
      trailSlow: ['この端末では使えません（描くのが追いつかないため）', 'この たんまつでは つかえないよ'],
      bScope: ['双眼鏡', 'そうがんきょう'],
      bScopeTele: ['望遠鏡', 'ぼうえんきょう'],
      scopeBino: [(m) => `双眼鏡（7×50・実視界 7°）。${m.toFixed(1)} 等の星まで`, (m) => `そうがんきょう。${m.toFixed(1)}とうの ほしまで みえるよ`],
      scopeTele: [(m) => `望遠鏡（口径 80 mm・40 倍・実視界 1.2°）。${m.toFixed(1)} 等の星まで`, (m) => `ぼうえんきょう。${m.toFixed(1)}とうの ほしまで みえるよ`],
      scopeOff: ['肉眼に戻りました', 'めで みる そらに もどったよ'],
      scopeCap: ['（描ける星は星表の 8.5 等まで）', ''],
      hipCredit: ['暗い星: ヒッパルコス星表（Credit: ESA、CC BY-NC 3.0 IGO）', 'くらい ほし: ESA'],
      bEvent: ['天文イベント', 'てんもん イベント'],
      evTitle: ['イベントを早回しで見る', 'はやまわしで みる'],
      evEclipse: ['皆既月食', 'かいきげっしょく'],
      evJapan: ['日本で見える', 'にほんで みえる'],
      evEclTimes: [(a, b, c, d) => `欠け始め ${a} → 皆既 ${b}〜${c} → 終わり ${d}（日本時間。このサイトの計算で目安、国立天文台の発表と数分ずれることがあります）`, (a, b, c, d) => `かけはじめ ${a}、ぜんぶ かくれる ${b}〜${c}、おわり ${d}`],
      evPeak: ['が極大', 'が いちばん おおい'],
      evRate: [(r) => `${r}（国立天文台）`, (r) => r],
      evPlay: ['再生', 'さいせい'],
      evStop: ['止める', 'とめる'],
      evPlaying: [(n) => `再生中: ${n}`, (n) => `さいせいちゅう: ${n}`],
      evDone: ['再生が終わりました', 'おわったよ'],
      evReduced: ['動きを減らす設定なので、いちばんの見どころの時刻で止めて見せます', 'いちばんの ところを みせるよ'],
      evNone: ['この先の予定は、国立天文台の発表を写した表にまだありません', 'まだ よていが ないよ'],
    },
    en: {
      bGyro: 'Gyro',
      gyroOn: 'Hold your phone up to the sky to see the stars in that direction',
      gyroOff: 'Gyro off. Drag to look around',
      gyroDenied: 'The motion sensor is not available, so drag to look around',
      gyroCalib: 'If the direction is off, move your phone in a figure 8',
      gyroRelative: 'This device does not report north, so your current view is the starting direction',
      bLight: 'City lights',
      lightLabels: ['Countryside', 'Suburbs', 'City'],
      lightRead: (B, m) => `Sky brightness ${B.toFixed(1)} mag/arcsec² · stars to magnitude ${m.toFixed(1)}`,
      lightNote: 'Limiting magnitude from Schaefer (1990). The Milky Way and sky color are approximate.',
      bArt: 'Constellation art',
      artToast: 'Showing Hevelius’s constellation art (1690): Orion, Gemini, Leo and Ursa Major',
      bDso: 'Nebulae',
      dsoTitle: 'Zoom to',
      dsoPhoto: 'Real photo (ESA/Hubble, CC BY 4.0). Star dots are drawn at their catalog positions.',
      dsoCredit: 'Image',
      dsoChanged: '(annotations removed)',
      dsoMoved: 'It is hard to see now, so the time moved to when it is easier to see',
      dsoNone: 'No good time to see it in the next 36 hours',
      dsoBack: 'Zoom back out',
      bTrail: 'Star trails',
      trailOn: 'Time runs 600× faster and the stars leave streaks of light',
      trailStatic: 'Reduced motion is on, so two hours of trails are shown as one still picture',
      trailSlow: 'Not available on this device (it cannot draw fast enough)',
      bScope: 'Binoculars',
      bScopeTele: 'Telescope',
      scopeBino: (m) => `Binoculars (7×50, 7° field). Stars to magnitude ${m.toFixed(1)}`,
      scopeTele: (m) => `Telescope (80 mm, 40×, 1.2° field). Stars to magnitude ${m.toFixed(1)}`,
      scopeOff: 'Back to naked eye',
      scopeCap: '(the star catalog goes to magnitude 8.5)',
      hipCredit: 'Faint stars: Hipparcos Catalogue (Credit: ESA, CC BY-NC 3.0 IGO)',
      bEvent: 'Sky events',
      evTitle: 'Watch an event in fast motion',
      evEclipse: 'Total lunar eclipse',
      evJapan: 'visible from Japan',
      evEclTimes: (a, b, c, d) => `Partial begins ${a} → total ${b}–${c} → ends ${d} (Japan time; calculated by this site, may differ from NAOJ by a few minutes)`,
      evPeak: ' peak',
      evRate: () => 'Meteors fly out from the radiant in fast motion',
      evPlay: 'Play',
      evStop: 'Stop',
      evPlaying: (n) => `Playing: ${n}`,
      evDone: 'Replay finished',
      evReduced: 'Reduced motion is on, so the sky is shown at the key moment without motion',
      evNone: 'No upcoming events in the published table yet',
    },
  };

  const api = { magnetic, decimalYear, declination, deviceView, compassOffset, GYRO, needCalibration, follow, LIGHT, skyMag, nelm, lightPollution, photoCorners, ZOOM_DEEP, zoomFor, altOf, sunAlt, viewTime, TRAIL, trailFade, trailTimes, SCOPE, scopeLimit, scopeZoom, decodeHip, ECL, eclipseAt, eclipseContacts, eclipseLight, RADIANTS, upcoming, ratePerHour, meteorGap, radiantMeteor, EVENT, TEXT };
  if (typeof module !== 'undefined') module.exports = api; else root.NightWow = api;
})(typeof window !== 'undefined' ? window : globalThis);
