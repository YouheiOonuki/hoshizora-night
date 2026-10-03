'use strict';
/* フル版の見せ方の決まり（ROADMAP 7.15.1 の 10 項目を数値と関数にしたもの）。描画（render/night-gl.js）と画面（app/night.js）から読む。
   天文の計算はここに持たない（engine/ の写しを呼ぶ）。ブラウザでも Node（テスト）でも読める */
(function (root) {
  const A = (typeof module !== 'undefined') ? require('../engine/astro.js') : { sun, altAz, lstRad, DEG };

  /* ---------- 1 空の色 ---------- */
  const SKY = {
    zenith: '#050a1e',
    horizon: '#1b2a52',   // 夜
    twilight: '#3a4a7a',  // 薄明（地平線だけ）
    ground: '#060810',
    twilightMinutes: 20,  // 夜の色 ⇄ 薄明の色 を 20 分で移る
    twilightSunAlt: -6,   // 太陽がこの高度（度）より上なら薄明の色そのもの
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  /** 太陽の高度（度） */
  function sunAltDeg(ms, lat, lon) {
    const S = A.sun(ms);
    return A.altAz(Math.sin(S.dec), Math.cos(S.dec), S.ra, A.lstRad(ms, lon), Math.sin(lat * A.DEG), Math.cos(lat * A.DEG))[0] / A.DEG;
  }
  /** 薄明の重み 0（夜）〜1（薄明の色）。太陽が −6° を下ってから 20 分ぶん動く間に 1 → 0（朝は逆） */
  function twilightWeight(ms, lat, lon) {
    const a = sunAltDeg(ms, lat, lon);
    if (a >= SKY.twilightSunAlt) return 1;
    const rate = Math.abs(sunAltDeg(ms + 60e3, lat, lon) - a);           // 度／分
    const span = Math.max(rate * SKY.twilightMinutes, 1e-6);
    return Math.max(0, Math.min(1, 1 - (SKY.twilightSunAlt - a) / span));
  }

  /* ---------- 2 星 ---------- */
  /** にじみの半径（px、DPR 1）。7.15.1 は 1 等 6・2 等 4・3 等 3・4 等 2・5 等以下 1.5。
      オーナー決定 2026-10-03（「わぁきれい」を優先）で明るい星を大きく: 0 等 10・1 等 7.5・2 等 5・3 等 3.5・4 等 2.5・5 等 1.8・6 等 1.4 */
  function haloRadius(mag) {
    if (mag <= 0.5) return 10;
    if (mag <= 1.5) return 7.5;
    if (mag <= 2.5) return 5;
    if (mag <= 3.5) return 3.5;
    if (mag <= 4.5) return 2.5;
    if (mag <= 5.5) return 1.8;
    return 1.4;
  }
  const MAX_SAT = 0.5;    // 7.15.1 は 20%、2026-10-03 に 35%。企画書 74（オーナー決定 2026-10-03「本物らしい色」）で黒体の色に変え、上限 50%
  /** B−V → 表面温度（K）。Ballesteros (2012) の式 */
  const bvTemp = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  /** 温度 → 黒体の色（sRGB、0〜1、いちばん明るい成分を 1）。Tanner Helland の近似（1,000〜40,000 K） */
  function blackbody(T) {
    const t = Math.max(1000, Math.min(40000, T)) / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const c = [r, g, b].map((x) => Math.max(0, Math.min(255, x)) / 255), m = Math.max(...c);
    return c.map((x) => x / m);
  }
  /** B−V → 色（0〜1）。黒体の色で、彩度（HSV の S）は MAX_SAT まで */
  function starColor(bv) {
    let c = blackbody(bvTemp(Math.max(-0.4, Math.min(2.0, bv))));
    const mx = Math.max(...c), mn = Math.min(...c), s = (mx - mn) / mx;
    if (s > MAX_SAT) { const k = MAX_SAT / s; c = c.map((x) => mx - (mx - x) * k); }   // 白（明るさは同じ）へ寄せる
    return c;
  }
  const saturation = (c) => { const mx = Math.max(...c); return mx ? (mx - Math.min(...c)) / mx : 0; };
  /** またたき: 3 等より明るい星だけ。不透明度 ±10%、0.5〜1 Hz（seed は 0〜1） */
  const TWINKLE = { brighterThan: 3, amp: 0.1, fMin: 0.5, fMax: 1.0 };
  const twinkles = (mag) => mag < TWINKLE.brighterThan;
  const twinkleHz = (seed) => TWINKLE.fMin + (TWINKLE.fMax - TWINKLE.fMin) * seed;

  /* ---------- 3 日周運動 ---------- */
  const SPEED = 60;          // 1 秒 ＝ 1 分

  /* ---------- 4 操作 ---------- */
  const ZOOM = { min: 1, max: 3 };
  const LINE = { color: '#a8c4ff', alpha: 0.7, fadeMs: 1000, widthCss: 1.5 };   // オーナー 2026-10-03「星座の線が見えづらすぎる」で 0.3 → 0.7、太さ 1.5 CSS px

  /* ---------- 9 動かない端末 ---------- */
  const FPS = { probeMs: 3000, min: 24, reducedMag: 4 };

  /* ---------- オーナー決定 2026-10-03 で足したもの（「わぁきれい」） ---------- */
  const STAR_LIMIT = 6.5;                              // 追加の星表（render/catalog-extra.js）まで
  const INTRO = { ms: 3500, duskZenith: '#1a2a5c', duskHorizon: '#6a6fa0' };   // 開いたとき 1 回: 夕方の空から夜へ、星が明るい順に灯る
  const METEOR = { meanSec: 30, peakMeanSec: 10, minAlt: 25, lenDeg: [14, 26], durMs: [700, 1200] };   // 流れ星（極大の夜は多め）
  /** 次の流れ星までの秒（指数分布。u は 0〜1 の乱数） */
  const meteorWait = (u, peak) => -Math.log(1 - Math.min(u, 0.999)) * (peak ? METEOR.peakMeanSec : METEOR.meanSec);
  /** 山並みの高さ（度）。方位 az（ラジアン）の滑らかな関数。0〜約 2.6°。GLSL にも同じ式（render/night-gl.js の HILLS） */
  function hillDeg(az) {
    const h = 0.6 + 0.9 * Math.sin(2 * az + 0.5) + 0.6 * Math.sin(5 * az + 2.1) + 0.35 * Math.sin(11 * az + 4.0) + 0.2 * Math.sin(23 * az + 1.3);
    return Math.max(0, h) * 0.9;
  }
  const LINES_ALL_ALPHA = 0.5;                        // 星座線を全部出すとき（タップした星座は LINE.alpha）


  /* ---------- 企画書 74（オーナー決定 2026-10-03「フル版はすごいものに」）: 大気・天の川・カメラ ---------- */
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /** 昼の空の重み 0（夜）〜1（昼）と、星の見えやすさ。太陽の高度（度）で決める（軽量版 main.js の dayF・starF と同じ区切り） */
  const dayFactor = (sunAlt) => smooth(-9, 5, sunAlt);
  const starFactor = (sunAlt) => 1 - smooth(-9, -1, sunAlt);
  /** 月明かりの強さ 0〜1（光っている割合 × 月の高度 × 夜）。軽量版の moonF と同じ */
  const moonLight = (illum, moonAltDeg, dayF) => illum * smooth(-2, 10, moonAltDeg) * (1 - dayF);
  /** 大気の減光（等級）。空気の量（エアマス）は Young (1994) に近い簡単な式、減光係数 0.25 等／エアマス */
  const EXTINCTION = 0.25;
  function airmass(altRad) { const s = Math.max(0, Math.sin(altRad)); return Math.min(40, 1 / (s + 0.025 * Math.exp(-11 * s))); }
  const extinctionMag = (altRad) => EXTINCTION * (airmass(altRad) - 1);
  /** 見える限界の等級: 月明かりで 1.3 等（軽量版と同じ）、薄明で暗い星から消える */
  const limitMag = (base, moonF, starF) => base - 1.3 * moonF - (1 - starF) * 4.6;
  /** 銀河座標 ← J2000 赤道座標（IAU 1958 の定義を J2000 にしたもの。行優先）。天の川の画像（銀河座標の正距円筒図法）を貼るのに使う */
  const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];
  /** J2000 の単位ベクトル → [銀経, 銀緯]（ラジアン） */
  function galactic(v) {
    const g = [0, 1, 2].map((i) => GAL[i * 3] * v[0] + GAL[i * 3 + 1] * v[1] + GAL[i * 3 + 2] * v[2]);
    return [((Math.atan2(g[1], g[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), Math.asin(Math.max(-1, Math.min(1, g[2])))];
  }
  /** 画像の上の位置（0〜1。左上が 0,0）。ESO の画像は中央が銀経 0°、左へ銀経が増える */
  function milkyUV(v) { const [l, b] = galactic(v); return [((0.5 - l / (2 * Math.PI)) % 1 + 1) % 1, 0.5 - b / Math.PI]; }
  /** 出典（画面に見える形で出す。ESO の条件） */
  const CREDITS = { milky: { ja: '天の川: ESO/S. Brunier', en: 'Milky Way: ESO/S. Brunier', href: 'https://www.eso.org/public/images/eso0932a/' },
    moon: { ja: '月: NASA SVS', en: 'Moon: NASA SVS', href: 'https://svs.gsfc.nasa.gov/4720/' } };
  /** カメラを寄せる: 時間（ミリ秒）と、0〜1 の進み → 0〜1（ゆっくり出て、ゆっくり止まる）。reduced motion では 0 秒 */
  const FLY = { ms: 1100, zoomTo: 1.6 };
  const flyEase = (u) => { const t = Math.max(0, Math.min(1, u)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  /** 方位の差を −π〜π に（近いほうへ回る） */
  const wrapPi = (a) => { const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return t - Math.PI; };
  /** 地表から見る月: 地平座標 h（東・北・天頂）の高度を 視差 × cos 高度 だけ下げる（軽量版 main.js の mAlt -= M.parallax*cos(mAlt) と同じ）。方位は変えない */
  function moonTopo(h, parallax) {
    const alt = Math.asin(Math.max(-1, Math.min(1, h[2]))), a2 = alt - parallax * Math.cos(alt), c = Math.cos(a2), hz = Math.hypot(h[0], h[1]) || 1;
    return [h[0] / hz * c, h[1] / hz * c, Math.sin(a2)];
  }
  /** 速さ（倍）。軽量版の時間たびと同じ 60・600・3600 */
  const SPEEDS = [60, 600, 3600];

  /* ---------- 場所の表示（位置情報なら最寄りの都道府県庁＋「付近」と緯度経度） ---------- */
  function coordText(lat, lon, en) {
    const a = Math.abs(lat).toFixed(1), o = Math.abs(lon).toFixed(1);
    return en ? `${a}°${lat >= 0 ? 'N' : 'S'} ${o}°${lon >= 0 ? 'E' : 'W'}` : `${lat >= 0 ? '北緯' : '南緯'}${a}° ${lon >= 0 ? '東経' : '西経'}${o}°`;
  }
  const kmBetween = (a, b) => {
    const r = Math.PI / 180, x = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r);
    return 6371 * Math.acos(Math.max(-1, Math.min(1, x)));
  };
  /** { main, sub }。prefs は都道府県庁の一覧。150 km より遠ければ緯度経度だけ */
  function placeText(p, prefs, en) {
    if (p.id !== 'here' && p.id !== 'shared') return { main: en ? p.en : p.name, sub: '' };
    let best = null, bd = Infinity;
    for (const q of prefs) { const d = kmBetween(p, q); if (d < bd) { bd = d; best = q; } }
    const c = coordText(p.lat, p.lon, en);
    if (!best || bd > 150) return { main: c, sub: '' };
    return { main: en ? `${L_TEXT.en.near} ${best.en}` : `${best.name}${L_TEXT.ja.near}`, sub: c };
  }
  function median(xs) {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  /** 段階: 'full'（全星）→ 'reduced'（4 等まで）→ 'light'（通常版へのリンクを中央に）。WebGL が無ければ最初から通常版へ（gate.js） */
  function nextStage(stage, medianFps) {
    if (medianFps >= FPS.min) return stage;
    return stage === 'full' ? 'reduced' : 'light';
  }

  /* ---------- 8 共有（#lat,lon,unixtime） ---------- */
  function formatHash(lat, lon, ms) {
    return `#${(+lat).toFixed(2)},${(+lon).toFixed(2)},${Math.floor(ms / 1000)}`;
  }
  function parseHash(h) {
    const m = String(h || '').replace(/^#/, '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d{1,12})$/);
    if (!m) return null;
    const lat = +m[1], lon = +m[2], ms = +m[3] * 1000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, ms };
  }
  /** その土地の暦の月（1〜12） */
  function localMonth(ms, tz) {
    try { return +new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(new Date(ms)); } catch (e) { return new Date(ms).getUTCMonth() + 1; }
  }
  /** 共有の URL。月ごとのページ（m/MM/。OG 画像がその月のもの）に # を付ける */
  function shareUrl(origin, lang, ms, tz, lat, lon) {
    const mm = String(localMonth(ms, tz)).padStart(2, '0');
    return `${origin}/hoshizora-night/${lang === 'en' ? 'en/' : ''}m/${mm}/${formatHash(lat, lon, ms)}`;
  }

  /* ---------- 7 今夜の見どころ（official-events.js の写しから。文は官製の表の語） ---------- */
  // 流星群の名前。通常版の tools/calendar-pages.js（SHOWERS）・calendar-pages-en.js（SHOWERS_EN）と同じ（tools/sync-from-sanpo.mjs --check が突き合わせる）
  const SHOWERS = {
    perseids: ['ペルセウス座流星群', 'Perseids'],
    geminids: ['ふたご座流星群', 'Geminids'],
    quadrantids: ['しぶんぎ座流星群', 'Quadrantids'],
    orionids: ['オリオン座流星群', 'Orionids'],
    leonids: ['しし座流星群', 'Leonids'],
    lyrids: ['4月こと座流星群', 'Lyrids'],
    'eta-aquariids': ['みずがめ座η（エータ）流星群', 'Eta Aquariids'],
    'delta-aquariids-s': ['みずがめ座δ（デルタ）南流星群', 'Southern Delta Aquariids'],
    'taurids-s': ['おうし座南流星群', 'Southern Taurids'],
    'taurids-n': ['おうし座北流星群', 'Northern Taurids'],
  };
  const PLANET_KIND = {
    ja: { opposition: (p) => `${p}が衝`, 'elong-east': (p) => `${p}が東方最大離角`, 'elong-west': (p) => `${p}が西方最大離角`, brightest: (p) => `${p}が最大光度` },
    en: { opposition: (p) => `${p} at opposition`, 'elong-east': (p) => `${p} at greatest eastern elongation`, 'elong-west': (p) => `${p} at greatest western elongation`, brightest: (p) => `${p} at greatest brilliancy` },
  };
  const JST = 9 * 3600e3;
  const jstDate = (ms) => new Date(ms + JST).toISOString().slice(0, 10);
  /** 「その夜」の日付（日本時間で正午から翌日の正午までを 1 晩とする） */
  const nightOf = (ms) => jstDate(ms - 12 * 3600e3);

  /**
   * その夜の見どころ（流星群の極大・満月・惑星）を 3 件まで。
   * O: official-events.js の中身、BODY: data.js の BODY_INFO（惑星の名前）
   * 流星群は「見る時刻」（view）、満月は満月の瞬間、惑星は日付でその夜に割り当てる（日本時間）
   */
  function tonight(ms, O, BODY, lang) {
    const key = nightOf(ms), en = lang === 'en', out = [];
    for (const m of O.METEOR_PEAKS) {
      if (nightOf(Date.parse(m.view)) !== key) continue;
      const s = SHOWERS[m.shower]; if (!s) continue;
      out.push({ kind: 'meteor', title: en ? `${s[1]} peak` : `${s[0]}が極大`, src: m.src });
    }
    for (const r of O.MOON_PHASES) {
      if (r.type !== 'full' || nightOf(Date.parse(r.at)) !== key) continue;
      const note = (O.MOON_NOTES || []).find((n) => n.date === jstDate(Date.parse(r.at)));
      const base = en ? 'Full moon' : '満月';
      out.push({ kind: 'full', title: note ? `${base}（${en ? note.en : note.note}）`.replace(/（(.*)）$/, en ? ' ($1)' : '（$1）') : base, src: r.src });
    }
    for (const p of O.PLANET_EVENTS) {
      if (p.date !== key) continue;
      const name = BODY[p.planet] ? (en ? BODY[p.planet].en : BODY[p.planet].jp) : p.planet;
      const f = PLANET_KIND[en ? 'en' : 'ja'][p.kind]; if (!f) continue;
      out.push({ kind: 'planet', title: f(name), src: p.src });
    }
    return out.slice(0, 3);
  }

  /* ---------- 5 文字（UI の文字列。説明文は置かない） ---------- */
  // 企画書 74 で足したボタン・パネルの文字は、軽量版の index.html・en/index.html の同じ部品の文字のまま（日本語は [おとな, ひらがな]）
  const TEXT = {
    ja: { now: 'いま', pause: '止める', play: '動かす', share: 'この空を共有', copied: 'コピーしました', here: '現在地', light: '軽い版',
      time: '時刻', close: '閉じる', about: '運営者情報', privacy: 'プライバシーポリシー', guide: '使い方', geoFail: '位置情報を使えませんでした',
      dirs: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'], near: '付近', lines: '星座線',
      bLines: ['星座線', 'せいざの せん'], bNames: ['名まえ', 'なまえ'], bTime: ['時間たび', 'じかんたび'], bQuiz: ['クイズ', 'クイズ'], bKids: ['ひらがなモード', 'ひらがなモード'],
      bAst: ['大三角', 'さんかく'], bRed: ['赤いライト', 'あかい ライト'], bShare: ['この空を共有', 'このそらを おくる'], hint: ['ヒント', 'ヒント'],
      monthPrev: ['−1ヶ月', '−1かげつ'], dayPrev: ['−1日', '−1にち'], dayNext: ['＋1日', '＋1にち'], monthNext: ['＋1ヶ月', '＋1かげつ'], backNow: ['いまに戻る', 'いまに もどる'],
      whose: ['どこの空を見る？', 'どこの そらを みる？'], locHere: ['📍 いまいる場所の空', '📍 いま いる ばしょの そら'],
      locNote: ['位置情報は星空の計算にだけ使い、どこにも送信しません。', 'いる ばしょは ほしぞらの けいさんに だけ つかうよ。'],
      skyLabel: '星空。ドラッグで見まわし、ピンチで拡大、星座をタップで解説。矢印キーでも動かせます',
      helpLabel: 'つかいかた', helpStart: ['はじめる', 'はじめる'], sheetLabel: 'くわしい説明', timePanel: '時間たび', placePanel: '場所', menu: 'メニュー',
      help: [['ドラッグ', '空を見まわす（スマホは指でスワイプ）'], ['ピンチ / ホイール', 'ズームイン・ズームアウト'], ['タップ', '星座・星・月・惑星の説明がひらきます'],
        ['時間たび', '時間を動かすと、星と太陽・月が動きます'], ['場所', 'シドニーに行くと南十字星が見えます'], ['赤いライト', '夜の屋外で目が暗さに慣れたまま使えます']],
      helpKana: [['ゆびで なぞる', 'そらを みまわす'], ['2ほんゆび', 'おおきく したり ちいさく したり'], ['タップ', 'せいざや つき の おはなしが ひらくよ'],
        ['じかんたび', 'じかんを うごかすと、ほしと たいようが うごく！'], ['ばしょ', 'シドニーに いくと みなみじゅうじせいが みえる']],
      links: { zukan: '星座図鑑', calendar: '天文カレンダー', tsuki: '月の出・月の入り', shinwa: 'ギリシャ神話', hayamiban: '星座早見盤を作る', poster: '星空ポスター' } },
    en: { now: 'Now', pause: 'Pause', play: 'Play', share: 'Share', copied: '✓', here: 'Here', light: 'Light version',
      time: 'Time', close: 'Close', about: 'About', privacy: 'Privacy policy', guide: 'How it works', geoFail: 'Location unavailable',
      dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], near: 'Near', lines: 'Lines',
      bLines: 'Lines', bNames: 'Names', bTime: 'Time', bMoon: 'Moon phase', bQuiz: 'Quiz', bAst: 'Asterisms', bRed: 'Red light', bShare: 'Share', hint: 'Hint',
      monthPrev: '−1 month', dayPrev: '−1 day', dayNext: '+1 day', monthNext: '+1 month', backNow: 'Back to now',
      whose: 'Whose sky?', locHere: '📍 Use my location', lat: 'Latitude (south is −)', lon: 'Longitude (west is −)', go: 'Go',
      locNote: 'Your location is used only to calculate the sky and is never sent anywhere. For your location or typed coordinates, times use your device’s time zone.',
      skyLabel: 'Night sky. Drag to look around, pinch to zoom, tap a constellation for notes. Arrow keys also work.',
      helpLabel: 'How to use', helpStart: 'Start', sheetLabel: 'Details', timePanel: 'Time travel', placePanel: 'Place', menu: 'Menu',
      help: [['Drag', 'Look around (swipe on a phone)'], ['Pinch / wheel', 'Zoom in and out'], ['Tap', 'Open notes on a constellation, star, the Moon or a planet'],
        ['Time', 'Move time and watch the stars, Sun and Moon move'], ['Place', 'Pick a city or type a latitude and longitude'], ['Red light', 'Keeps your eyes used to the dark outdoors']],
      links: { calendar: 'Sky calendar', planisphere: 'Printable planisphere' } },
  };
  const L_TEXT = TEXT;
  /** 英語の語数（空白で区切り、英字を含むものを数える。方位の 1 文字も 1 語。記号の ✓ は数えない） */
  function wordCount(dict) {
    let n = 0;
    for (const v of Object.values(dict)) for (const s of [].concat(v)) n += String(s).trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
    return n;
  }

  /* ---------- 空の上の名前と画面の文字の重なり（K132 の続き: スマホで左上の文字と星座名が重なって読めない） ----------
     名前の札（box: x,y,w,h）が、よけるべき画面の部品（avoid: x,y,r,b の矩形）にかかるとき、上下に少しずらして逃がす。
     ずらす量が LABEL_AVOID.shift を超えるなら隠す（null）。かからなければ 0 */
  const LABEL_AVOID = { pad: 4, shift: 26 };
  function hitRect(box, a, pad) { return box.x < a.r + pad && a.x - pad < box.x + box.w && box.y < a.b + pad && a.y - pad < box.y + box.h; }
  function avoidShift(box, avoid, opt) {
    const pad = (opt && opt.pad != null) ? opt.pad : LABEL_AVOID.pad, max = (opt && opt.shift != null) ? opt.shift : LABEL_AVOID.shift;
    const hits = avoid.filter((a) => hitRect(box, a, pad));
    if (!hits.length) return 0;
    const cands = [];
    for (const a of hits) { cands.push(a.b + pad - box.y + 0.5); cands.push(a.y - pad - (box.y + box.h) - 0.5); }
    cands.sort((p, q) => Math.abs(p) - Math.abs(q));
    for (const dy of cands) {
      if (Math.abs(dy) > max) break;
      const moved = { x: box.x, y: box.y + dy, w: box.w, h: box.h };
      if (!avoid.some((a) => hitRect(moved, a, pad))) return dy;
    }
    return null;
  }

  const api = { bvTemp, blackbody, smooth, dayFactor, starFactor, moonLight, EXTINCTION, airmass, extinctionMag, limitMag, GAL, galactic, milkyUV, CREDITS, FLY, flyEase, wrapPi, SPEEDS, moonTopo,
    SKY, hex, sunAltDeg, twilightWeight, haloRadius, starColor, saturation, MAX_SAT, TWINKLE, twinkles, twinkleHz, SPEED, ZOOM, LINE,
    FPS, median, nextStage, STAR_LIMIT, INTRO, METEOR, meteorWait, hillDeg, LINES_ALL_ALPHA, coordText, placeText, kmBetween, formatHash, parseHash, localMonth, shareUrl, SHOWERS, tonight, nightOf, TEXT, wordCount, LABEL_AVOID, avoidShift };
  if (typeof module !== 'undefined') module.exports = api; else root.NightLook = api;
})(typeof window !== 'undefined' ? window : globalThis);
