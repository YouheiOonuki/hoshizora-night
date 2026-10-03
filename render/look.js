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
  const MAX_SAT = 0.35;   // 7.15.1 は 20%。オーナー決定 2026-10-03 で 35% まで（色をはっきり）
  /** B−V → 色（0〜1）。彩度（HSV の S）は MAX_SAT まで */
  function starColor(bv) {
    const t = Math.max(0, Math.min(1, (bv + 0.4) / 2.4));
    const blue = [0.62, 0.74, 1.0], white = [1.0, 0.98, 0.95], red = [1.0, 0.62, 0.38];
    const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
    let c = t < 0.3 ? mix(blue, white, t / 0.3) : mix(white, red, (t - 0.3) / 0.7);
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
  const TEXT = {
    ja: { now: 'いま', pause: '止める', play: '動かす', share: '共有', copied: 'コピーしました', here: '現在地', light: '軽い版',
      time: '時刻', close: '閉じる', about: '運営者情報', privacy: 'プライバシーポリシー', guide: '使い方', geoFail: '位置情報を使えませんでした',
      dirs: ['北', '東', '南', '西'], near: '付近', lines: '星座線' },
    en: { now: 'Now', pause: 'Pause', play: 'Play', share: 'Share', copied: '✓', here: 'Here', light: 'Light version',
      time: 'Time', close: 'Close', about: 'About', privacy: 'Privacy', guide: 'Guide', geoFail: 'Location unavailable',
      dirs: ['N', 'E', 'S', 'W'], near: 'Near', lines: 'Constellations' },
  };
  const L_TEXT = TEXT;
  /** 英語の語数（空白で区切り、英字を含むものを数える。方位の 1 文字も 1 語。記号の ✓ は数えない） */
  function wordCount(dict) {
    let n = 0;
    for (const v of Object.values(dict)) for (const s of [].concat(v)) n += String(s).trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
    return n;
  }

  const api = { SKY, hex, sunAltDeg, twilightWeight, haloRadius, starColor, saturation, MAX_SAT, TWINKLE, twinkles, twinkleHz, SPEED, ZOOM, LINE,
    FPS, median, nextStage, STAR_LIMIT, INTRO, METEOR, meteorWait, hillDeg, LINES_ALL_ALPHA, coordText, placeText, kmBetween, formatHash, parseHash, localMonth, shareUrl, SHOWERS, tonight, nightOf, TEXT, wordCount };
  if (typeof module !== 'undefined') module.exports = api; else root.NightLook = api;
})(typeof window !== 'undefined' ? window : globalThis);
