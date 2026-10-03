'use strict';
/* フル版だけの機能（企画書 75「軽量版と差別化する 8 つ」、オーナー決定 2026-10-03）の決まり。
   描画（render/night-gl.js）と画面（app/night.js）から読む。天文の計算はここに持たない（engine/ の写しを呼ぶ）。
   ブラウザでも Node（テスト）でも読める。
     1 ジャイロ（端末の向き → 見る方位・高度。磁北 → 真北は WMM2025 の偏角）
   （2〜8 は順に足す） */
(function (root) {
  const W = (typeof module !== 'undefined') ? require('./wmm.js') : root.NightWMM;
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

  /* ---------- 文字（新しい UI の文字列。英語は k132-wow2-en-review.md でオーナーの承認待ち） ---------- */
  const TEXT = {
    ja: {
      bGyro: ['ジャイロ', 'ジャイロ'],
      gyroOn: ['スマホを空にかざすと、その方向の星が出ます', 'スマホを そらに むけてね'],
      gyroOff: ['ジャイロを止めました。ドラッグで見まわせます', 'ジャイロを とめたよ'],
      gyroDenied: ['向きのセンサーが使えないので、ドラッグのままです', 'むきの センサーが つかえないよ'],
      gyroCalib: ['方位がずれるときは、スマホを 8 の字に回してください', 'スマホを 8の じに まわしてね'],
      gyroRelative: ['北の向きが分からない端末なので、いまの向きを基準にします', 'いまの むきから うごかすよ'],
    },
    en: {
      bGyro: 'Gyro',
      gyroOn: 'Hold your phone up to the sky to see the stars in that direction',
      gyroOff: 'Gyro off. Drag to look around',
      gyroDenied: 'The motion sensor is not available, so drag to look around',
      gyroCalib: 'If the direction is off, move your phone in a figure 8',
      gyroRelative: 'This device does not report north, so your current view is the starting direction',
    },
  };

  const api = { magnetic, decimalYear, declination, deviceView, compassOffset, GYRO, needCalibration, follow, TEXT };
  if (typeof module !== 'undefined') module.exports = api; else root.NightWow = api;
})(typeof window !== 'undefined' ? window : globalThis);
