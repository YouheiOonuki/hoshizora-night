'use strict';
/* ほしぞらさんぽ フル版の画面（ROADMAP 7.15.1、企画書 74: 軽量版の画面の機能を全部・見せ方を上に）。
   描画は render/night-gl.js、決まりは render/look.js、説明シートの中身は render/info.js、計算と文は engine/（通常版の写し）。
   ・入力（場所・時刻）は端末の外に出さない。保存（localStorage）はしない。場所と時刻は URL の # だけ（#lat,lon,unixtime）
   ・?probe=off で最初の fps の測定を止める（スクショ・計測用）。?view=<方位°>,<高度°> で向きを決めて開く（確かめ用） */
(function () {
  const L = window.NightLook, S = window.NightSky, R = window.NightRender, O = window.NightEvents, P = window.NightPrefs.PREFS, I = window.NightInfo, WOW = window.NightWow;
  const $ = (id) => document.getElementById(id);
  const EN = document.documentElement.lang === 'en';
  const T = L.TEXT[EN ? 'en' : 'ja'];
  const canvas = $('sky');
  if (!window.NightGate.guard({ document, location }).ok) return;

  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const params = new URLSearchParams(location.search);
  let kids = false;
  let X = I.ctx(EN ? 'en' : 'ja', false);          // 文（軽量版の text.js の T と同じ。ひらがなモードで作り直す）
  const TT = (k, ...a) => X.T(k, ...a);
  const WT = WOW.TEXT[EN ? 'en' : 'ja'];
  /** 企画書 75 の文字（日本語は [おとな, ひらがな]） */
  const wt = (k) => { const v = WT[k]; return Array.isArray(v) ? v[kids ? 1 : 0] : v; };

  /* ---------------- 星と名前 ---------------- */
  const stars = [];
  for (let i = 0; i < CATALOG.length; i += 4) {
    stars.push({ v: S.vec(CATALOG[i] / 1000 * 15 * DEG, CATALOG[i + 1] / 100 * DEG), mag: CATALOG[i + 2] / 100, bv: CATALOG[i + 3] / 100 });
  }
  // 追加の星表（6.5 等まで。オーナー決定 2026-10-03）。通常版の星表には手を付けない
  const EXTRA = window.CATALOG_EXTRA || [];
  for (let i = 0; i < EXTRA.length; i += 4) {
    stars.push({ v: S.vec(EXTRA[i] / 1000 * 15 * DEG, EXTRA[i + 1] / 100 * DEG), mag: EXTRA[i + 2] / 100, bv: EXTRA[i + 3] / 100 });
  }
  const enStar = (jp) => STAR_EN[String(jp).split('（')[0]] || '';
  // タップで選べる星（星座の星・星座に入っていない明るい星）。軽量版の stars の名前つきのものと同じ
  const picks = [];
  CONS.forEach((c) => {
    c.pi = c.ss.map((s) => { picks.push({ v: S.vec(s[0] * 15 * DEG, s[1] * DEG), mag: s[2], bv: s[3] == null ? 0.3 : s[3], raw: s[4] || '', ly: s[5] || 0, con: c, flag: s[6] || '',
      name: s[4] ? (EN ? enStar(s[4]) || '' : s[4].split('（')[0]) : '' }); return picks.length - 1; });
    let v = [0, 0, 0]; c.pi.forEach((i) => { v = v.map((x, k) => x + picks[i].v[k]); });
    const n = Math.hypot(...v); c.cv = v.map((x) => x / n);
  });
  LONE.forEach((s) => picks.push({ v: S.vec(s[0] * 15 * DEG, s[1] * DEG), mag: s[2], bv: s[3], raw: s[4], ly: s[5], conName: s[6], lone: EN ? (CON_EN_EXTRA[s[6]] || '') : s[6],
    name: EN ? enStar(s[4]) : s[4] }));
  const DSOS = DSO.map((d) => ({ ...d, v: S.vec(d.ra * 15 * DEG, d.dec * DEG) }));
  const ASTERS = ASTER.map((a) => ({ ...a, vs: a.pts.map((p) => S.vec(p[0] * 15 * DEG, p[1] * DEG)) }));

  /* ---------------- 状態 ---------------- */
  // 英語版は世界の都市（通常版の英語と同じ表。日本の都市は都道府県庁の一覧と重なるので外す）＋都道府県庁
  // 日本語版は都道府県庁 47 か所＋通常版の場所のうち県庁から遠いもの（石垣島・シドニー。軽量版の「シドニーに行くと南十字星」）
  const WORLD = LOCS_WORLD.filter((l) => l.tz !== 'Asia/Tokyo');
  const FAR = LOCS.filter((l) => !P.some((p) => L.kmBetween(p, l) < 150));
  const LOCS_ALL = EN ? [...WORLD, ...P] : [...P, ...FAR];
  const st = { az: Math.PI, alt: (innerHeight > innerWidth ? 47 : 30) * DEG, zoom: 1, fovDeg: 100, limit: L.STAR_LIMIT + 0.1, stage: 'full' };
  let place = P.find((p) => p.id === 'pref-13');
  let sim = Date.now(), playing = !reduce.matches, lastReal = performance.now(), speedIdx = 0;
  let showLines = true, showNames = true, showAster = false, red = false;
  // 企画書 75: 星雲・星団へのズーム中の天体（deep）。ズーム中は拡大の上限を上げる
  const DSOI = (window.NightDso && window.NightDso.DSO_IMAGES) || [];
  let deep = null;
  let scope = null;   // 双眼鏡・望遠鏡（企画書 75 の 6）: { mode, zoom, prevZoom }
  const zMax = () => (scope ? scope.zoom : deep ? WOW.ZOOM_DEEP : (ev && ev.kind === 'eclipse') ? WOW.EVENT.eclipseZoom : L.ZOOM.max);
  let selected = null, picked = null, quiz = null, quizSeq = 0, sheetKind = null, fly = null;
  const placeName = (p) => p.name && !EN && kids && p.kana ? p.kana : L.placeText(p, P, EN).main;

  function deviceTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch (e) { return 'Asia/Tokyo'; } }
  if (EN) {   // 英語版は端末のタイムゾーンの都市を既定に（通常版の英語と同じ考え方）
    const tz = deviceTz(), w = WORLD.find((l) => l.tz === tz);
    if (w) place = w;
  }

  /* ---------------- 時刻（その土地の時刻） ---------------- */
  function parts(ms, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
    const o = {}; f.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: o.weekday };
  }
  /** 軽量版の localParts と同じ形（text.js の linkedToast などに渡す） */
  const lp = (ms) => { const p = parts(ms, place.tz); return { year: String(p.y), month: String(p.m).padStart(2, '0'), day: String(p.d).padStart(2, '0'), hour: String(p.h).padStart(2, '0'), minute: String(p.min).padStart(2, '0') }; };
  /** その土地のその日の 0 時からの分 → UNIX ミリ秒。nextIfPast なら過ぎていれば翌日 */
  function atLocal(ms, tz, minutes, nextIfPast) {
    const p = parts(ms, tz);
    let guess = Date.UTC(p.y, p.m - 1, p.d) + minutes * 60e3;
    for (let k = 0; k < 3; k++) { const q = parts(guess, tz); guess += ((p.d === q.d ? 0 : Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(q.y, q.m - 1, q.d)) + (minutes - q.h * 60 - q.min) * 60e3); }
    if (nextIfPast && guess < ms) guess = atLocal(ms + 86400e3, tz, minutes, false);
    return guess;
  }
  /** その土地の「YYYY-MM-DDTHH:MM」→ UNIX ミリ秒（軽量版 fromLocal と同じ考え方） */
  function fromLocal(str) {
    const want = Date.parse(str + 'Z'); if (!isFinite(want)) return NaN;
    let ms = want;
    for (let i = 0; i < 2; i++) { const p = parts(ms, place.tz); ms += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min); }
    return ms;
  }
  const sunAlt = (ms) => L.sunAltDeg(ms, place.lat, place.lon);
  const nightNow = () => sunAlt(sim) < -6;
  /** その日の夕方（明け方）に太陽高度が −6° になる時刻（軽量版 twilightAt と同じ） */
  function twilightAt(date, evening) {
    const [h0, h1] = evening ? [12, 24] : [0, 12];
    let prev = fromLocal(`${date}T${String(h0).padStart(2, '0')}:00`);
    for (let m = h0 * 60 + 10; m <= h1 * 60; m += 10) {
      const ms = prev + 600000, a = sunAlt(prev) + 6, b = sunAlt(ms) + 6;
      if (evening ? (a > 0 && b <= 0) : (a < 0 && b >= 0)) return ms - ms % 60000;
      prev = ms;
    }
    return fromLocal(`${date}T${evening ? '21' : '05'}:00`);
  }

  /* ---------------- 描画器 ---------------- */
  let r;
  const TEX = { milky: '/hoshizora-night/render/milkyway.jpg', moon: '/hoshizora-night/render/moon.jpg' };
  try { r = R.create(canvas, stars, MW, { textures: params.get('tex') === 'off' ? {} : TEX, onTexture: () => { dirty = true; texSettle = performance.now() + 1100; } }); } catch (e) { showLight(); return; }
  let texSettle = 0;
  const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);
  function fit() {
    const d = dprCap(), w = Math.round(canvas.clientWidth * d), h = Math.round(canvas.clientHeight * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }

  /* ---------------- 太陽・月・惑星 ---------------- */
  let bodiesAt = -Infinity, planets = [];
  function bodiesNow() {
    if (Math.abs(sim - bodiesAt) > 2 * 60e3) {
      const prec = precessor(sim);
      planets = PLANET_IDS.map((id) => ({ id, P: planet(id, sim, prec) }));
      planets.forEach((b) => { b.v = S.vec(b.P.ra, b.P.dec); });
      bodiesAt = sim;
    }
    return planets;
  }
  /** 地表から見る月（視差で少し低い。軽量版 main.js と同じ: 高度 −= 視差 × cos 高度） */
  function moonH(H, M) { return L.moonTopo(S.apply(H, S.vec(M.ra, M.dec)), M.parallax); }

  /* ---------------- 画面の上の位置 ---------------- */
  let view = st, cw = 1, ch = 1;
  /** 地平座標 → 画面（CSS px）。地平線・山並みの下は null */
  function proj(h, margin = 0) {
    if (h[2] < -margin) return null;
    const p = r.project(h, view, cw, ch);
    if (!p) return null;
    return p;
  }
  const behindHills = (h) => Math.asin(Math.max(-1, Math.min(1, h[2]))) < L.hillDeg(Math.atan2(h[0], h[1])) * DEG;

  /* ---------------- 文字 ---------------- */
  const elTime = $('time'), elDate = $('date'), slider = $('slider');
  const dirEls = [...document.querySelectorAll('#dirs span')];
  let shownKey = '';
  function updateClock() {
    const p = parts(sim, place.tz), m = p.h * 60 + p.min, travel = Math.abs(sim - Date.now()) > 90000;
    const dirIdx = Math.round((((st.az / DEG) % 360) + 360) % 360 / 45) % 8;
    const key = `${m}|${p.d}|${travel}|${dirIdx}|${kids}|${place.id}`;
    if (key === shownKey && !dirty) return;
    shownKey = key;
    elTime.textContent = `${p.h}:${String(p.min).padStart(2, '0')}`;
    const local = place.tz !== 'Asia/Tokyo' ? TT('localTime') : '';
    elDate.textContent = (EN ? new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: place.tz }).format(new Date(sim))
      : `${p.y}/${p.m}/${p.d}（${'日月火水木金土'['SunMonTueWedThuFriSat'.indexOf(p.wd) / 3]}）`) + local + (travel ? TT('traveling') : '');
    $('facing').textContent = TT('where', placeName(place), TT('dirsLong')[dirIdx]);
    if (document.activeElement !== slider) slider.value = String(m);
    $('tpNow').textContent = `${elDate.textContent.replace(TT('traveling'), '')} ${elTime.textContent}`;
    const nk = L.nightOf(sim);
    if (nk !== tonightKey) renderTonight(nk);
  }
  let tonightKey = '', tonightPeak = false;
  function renderTonight(key) {
    tonightKey = key;
    const ul = $('tonight'); ul.textContent = '';
    const evs = L.tonight(sim, O, BODY_INFO, EN ? 'en' : 'ja');
    tonightPeak = evs.some((e) => e.kind === 'meteor');
    for (const e of evs) { const li = document.createElement('li'); li.textContent = e.title; li.dataset.kind = e.kind; ul.appendChild(li); }
  }
  function placeLabel() {
    const t = L.placeText(place, P, EN);
    $('place').textContent = place.name && !EN && kids && place.kana ? place.kana : t.main;
    const sub = $('placeSub'); sub.textContent = t.sub; sub.hidden = !t.sub;
    [...$('placeList').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === place.id)));
  }

  /* ---------------- 空の上の名前（DOM の札を使い回す） ---------------- */
  const labelBox = $('labels'), pool = []; let used = 0;
  // 左上の文字（日時・場所・向き）・右上の今夜の出来事・下のボタン列には名前を重ねない（L.avoidShift でずらすか隠す）
  const UI_AVOID = ['.hud .clock', '#place', '#placeSub', '#facing', '#tonight', '.corner', '.bottom'];
  let avoid = [];
  function uiRects() {
    const out = [];
    for (const sel of UI_AVOID) {
      const e = document.querySelector(sel); if (!e || e.hidden) continue;
      const b = e.getBoundingClientRect(); if (b.width > 0 && b.height > 0) out.push({ x: b.left, y: b.top, r: b.right, b: b.bottom });
    }
    return out;
  }
  function label(text, x, y, cls, dx = 0, dy = 0, center = true) {
    let el = pool[used];
    if (!el) { el = document.createElement('span'); labelBox.appendChild(el); pool.push(el); }
    used++;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
    el.hidden = false;
    const key = text + '|' + cls + '|' + kids;
    if (el._key !== key) { el._key = key; el._w = el.offsetWidth; el._h = el.offsetHeight; }   // 大きさは文字が変わったときだけ測る
    const bx = Math.round(x + dx) - (center ? el._w / 2 : 0), by = Math.round(y + dy) - el._h / 2;
    const sh = L.avoidShift({ x: bx, y: by, w: el._w, h: el._h }, avoid);
    if (sh == null) { el.hidden = true; return; }
    el.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy + sh)}px)${center ? ' translate(-50%, -50%)' : ' translateY(-50%)'}`;
  }
  function labelsDone() { for (let i = used; i < pool.length; i++) pool[i].hidden = true; used = 0; }

  /* ---------------- 1 フレーム ---------------- */
  let dirty = true;
  const probe = { on: params.get('probe') !== 'off', start: 0, last: 0, dts: [] };
  const meter = params.get('fps') === 'show' ? { el: Object.assign(document.createElement('p'), { className: 'fps' }), start: 0, last: 0, dts: [], all: [] } : null;
  if (meter) document.body.appendChild(meter.el);
  let introStart = reduce.matches ? null : -1;
  let meteor = null, nextMeteor = 0, forcedDur = 0;
  let lastFrameState = null;

  function frame(now) {
    requestAnimationFrame(frame);
    if (meter) {
      if (meter.last) meter.dts.push(now - meter.last);
      meter.last = now; if (!meter.start) meter.start = now; dirty = true;
      if (now - meter.start >= 3000) {
        const f = Math.round(1000 / L.median(meter.dts)); meter.all.push(f);
        meter.el.textContent = `${f} fps · ${Math.round(L.median(meter.all))} (${meter.all.length}) · ${st.stage}`;
        meter.dts = []; meter.start = now;
      }
    }
    if (probe.on) {
      if (probe.last) probe.dts.push(now - probe.last);
      probe.last = now; if (!probe.start) probe.start = now;
      dirty = true;
      if (now - probe.start >= L.FPS.probeMs && probe.dts.length) {
        const fps = 1000 / L.median(probe.dts), next = L.nextStage(st.stage, fps);
        window.__night.fps.push(Math.round(fps * 10) / 10);
        if (next === 'reduced' && st.stage === 'full') { st.stage = next; st.limit = L.FPS.reducedMag; probe.start = now; probe.dts = []; }
        else { if (next === 'light') { st.stage = next; showLight(); } probe.on = false; }
        window.__night.stage = st.stage;
      }
    }
    if (playing) { sim += (now - lastReal) * (ev ? ev.speed : trail ? WOW.TRAIL.speed : L.SPEEDS[speedIdx]); dirty = true; }
    if (ev && playing && sim >= ev.end) { sim = ev.end; setPlaying(false); toast(wt('evDone')); ev.done = true; }
    const frameDt = (now - lastReal) / 1000;
    lastReal = now;
    // イベントの再生（企画書 75 の 7）: 月食は月を追う（さわると追うのをやめる）
    if (ev && ev.track === 'moon' && !fly) {
      const Hm = S.horizonMatrix(sim, place.lat, place.lon), Mm = moon(sim), h = moonH(Hm, Mm);
      st.az = Math.atan2(h[0], h[1]); st.alt = Math.max(-2 * DEG, Math.asin(h[2]) - (innerWidth < 900 ? 4 : 0) * DEG / st.zoom); dirty = true;
    }
    // ジャイロ（企画書 75 の 1）: 端末の向きへなめらかに追う（reduced motion ではそのまま向く）
    if (gyro.on && gyro.want) {
      const k = reduce.matches ? 1 : WOW.GYRO.smooth;
      const az = WOW.follow(st.az, gyro.want.az, k, true), alt = WOW.follow(st.alt, gyro.want.alt, k, false);
      if (Math.abs(az - st.az) + Math.abs(alt - st.alt) > 1e-5) { st.az = az; st.alt = alt; dirty = true; }
    }
    // カメラを寄せる（タップした星・星座へ。reduced motion では飛ばずに向くだけ）
    if (fly) {
      const u = Math.min(1, (now - fly.t0) / fly.ms), e = L.flyEase(u);
      st.az = fly.az0 + fly.daz * e; st.alt = fly.alt0 + (fly.alt1 - fly.alt0) * e; st.zoom = fly.z0 + (fly.z1 - fly.z0) * e;
      if (u >= 1) fly = null;
      dirty = true;
    }
    const twinkleOn = !reduce.matches && !trail;
    let intro = 1;
    if (introStart != null) { intro = Math.min(1, (now - introStart) / L.INTRO.ms); if (intro >= 1) introStart = null; dirty = true; }
    const ease = intro * intro * (3 - 2 * intro);
    let meteorDraw = null;
    if (!reduce.matches && intro >= 1 && !trail && !scope) {
      if (!meteor && now >= nextMeteor) meteor = spawnMeteor(now);
      if (meteor) {
        const k = (now - meteor.t0) / meteor.dur;
        if (k >= 1) { meteor = null; nextMeteor = now + L.meteorWait(Math.random(), tonightPeak) * 1000; }
        else meteorDraw = meteor; dirty = true;
      }
    }
    if (now < texSettle) dirty = true;   // 画像がなめらかに入る間
    if (!dirty && !twinkleOn && !flash) return;
    fit();
    cw = canvas.clientWidth; ch = canvas.clientHeight; view = st;
    const starM = S.starMatrix(sim, place.lat, place.lon), H = S.horizonMatrix(sim, place.lat, place.lon);
    const bl = bodiesNow();
    const Sn = sun(sim), sunHz = S.apply(H, S.vec(Sn.ra, Sn.dec)), sAltD = Math.asin(sunHz[2]) / DEG;
    const M = moon(sim), mH = moonH(H, M), mAltD = Math.asin(mH[2]) / DEG;
    const eclipse = WOW.eclipseAt(sim);   // 月食（企画書 75 の 7）: 地球の影にかかると月明かりも弱まる
    const dayF = L.dayFactor(sAltD), starF = L.starFactor(sAltD), moonF = L.moonLight(M.illum, mAltD, dayF) * WOW.eclipseLight(eclipse);
    const pxDeg = r.pxPerDeg(st, cw, ch), scale = Math.sqrt(st.zoom);
    const lp = WOW.lightPollution(lightU);   // 街明かり（企画書 75 の 2）
    // 双眼鏡・望遠鏡（企画書 75 の 6）: 口径の分だけ暗い星まで（星表の 8.5 等まで。遅い端末の段階では足さない）
    const baseLim = scope ? Math.min(faintOn() ? WOW.SCOPE.catalogLimit : L.STAR_LIMIT, WOW.scopeLimit(lp.limit, WOW.SCOPE.modes[scope.mode].aperture)) + 0.1
      : Math.min(st.limit, L.STAR_LIMIT + 0.1, lp.limit + 0.1);
    const limit = Math.min(L.limitMag(baseLim, moonF, starF), -1.5 + (baseLim + 1.5) * ease);

    /* 星の画面の位置（星座線・名前・タップ用） */
    for (const s of picks) {
      const h = S.apply(starM, s.v); s.h = h; s.alt = h[2];
      const p = h[2] > 0 && !behindHills(h) ? proj(h) : null;
      s.vis = !!(p && p.x > -80 && p.x < cw + 80 && p.y > -80 && p.y < ch + 80); if (s.vis) { s.x = p.x; s.y = p.y; }
    }
    /* 星座線（星の手前で切る。選んだ星座とクイズの答えは金色） */
    const quads = [];
    const segOf = (c) => {
      const out = [];
      for (const [a, b] of c.ln) {
        const s1 = picks[c.pi[a]], s2 = picks[c.pi[b]];
        if (s1.vis && s2.vis) out.push([s1.x, s1.y, s2.x, s2.y, 3 + L.haloRadius(s1.mag) * 0.55 * scale, 3 + L.haloRadius(s2.mag) * 0.55 * scale]);
      }
      return out;
    };
    const hotCon = (quiz && quiz.reveal) || selected;
    if (!trail && !scope && (starF > 0.05 || (quiz && quiz.reveal))) {
      if (showLines) quads.push({ segs: CONS.filter((c) => c !== hotCon).flatMap(segOf), width: 1.1, color: [0.6, 0.74, 1.0], alpha: 0.42 * starF * ease });
      if (hotCon) quads.push({ segs: segOf(hotCon), width: 1.8, color: [1.0, 0.82, 0.48], alpha: 0.95 * Math.max(starF, quiz ? 0.4 : 0) * Math.min(1, (now - pickedAt) / (reduce.matches ? 1 : 500)) });
    }
    if (showAster && starF > 0.05 && !trail) {
      for (const a of ASTERS) {
        const ps = a.vs.map((v) => { const h = S.apply(starM, v); return h[2] > -0.05 ? proj(h) : null; });
        if (ps.some((p) => !p)) { a.c = null; continue; }
        const segs = []; for (let i = 0; i < ps.length - (a.close ? 0 : 1); i++) { const p = ps[i], q = ps[(i + 1) % ps.length]; segs.push([p.x, p.y, q.x, q.y, 8, 8]); }
        quads.push({ segs, width: 1.4, color: [1.0, 0.82, 0.45], alpha: 0.7 * starF, dash: 12 });
        a.c = [ps.reduce((s, p) => s + p.x, 0) / ps.length, ps.reduce((s, p) => s + p.y, 0) / ps.length];
      }
    }
    /* 星雲・銀河・星団（ぼんやりした光） */
    const glows = [];
    const mwF = starF * (1 - 0.7 * moonF) * lp.milky;
    for (const d of DSOS) {
      const h = S.apply(starM, d.v), p = h[2] > 0 ? proj(h) : null; d.p = p;
      if (p && !deep) glows.push({ mode: 0, x: p.x, y: p.y, size: d.r * pxDeg * 1.1, aspect: 0.42, rot: -d.tilt, color: [0.86, 0.87, 1.0], alpha: 0.5 * mwF * ease });
    }
    if (!deep) for (const s of picks) if (s.flag && s.vis) glows.push({ mode: 0, x: s.x, y: s.y, size: (s.flag === 'cl' ? 0.9 : 0.6) * pxDeg, color: s.flag === 'cl' ? [0.66, 0.78, 1.0] : [0.86, 0.9, 1.0], alpha: (s.flag === 'cl' ? 0.5 : 0.38) * mwF * ease });
    /* 太陽・惑星・月（板） */
    const sprites = [];
    const sunP = sunHz[2] > -0.02 ? proj(sunHz) : null;
    /** 画面の上で太陽のある向き（右・上の角度） */
    const towardSun = (h, p) => { const q = h.map((x, i) => x + 0.02 * (sunHz[i] - x)), b = proj(q, 1); return b ? Math.atan2(-(b.y - p.y), b.x - p.x) : 0; };
    const sunVec = (i, ang, rot = 0) => { const si = Math.sin(i), a = ang - rot; return [si * Math.cos(a), si * Math.sin(a), Math.cos(i)]; };
    const bodyPos = { sun: sunP ? { x: sunP.x, y: sunP.y, alt: sunHz[2], r: 0 } : { alt: sunHz[2] } };
    if (sunP && !behindHills(sunHz)) {
      const rr = Math.max(9, 0.53 * pxDeg);
      sprites.push({ mode: 1, x: sunP.x, y: sunP.y, size: rr * 5, r: 0.2, alpha: 1 });
      bodyPos.sun.r = rr;
    }
    for (const b of bl) {
      const h = S.apply(H, b.v), p = h[2] > -0.02 && !behindHills(h) ? proj(h) : null;
      bodyPos[b.id] = p ? { x: p.x, y: p.y, alt: h[2], h } : { alt: h[2], h };
      if (!p) continue;
      const vis = b.P.mag < -3.5 ? Math.max(starF, 1 - dayF * 0.6) : starF;
      if (vis < 0.05) continue;
      const rad = Math.max(2.6, Math.min(7.5, 4.6 - b.P.mag * 0.6)) * scale, ring = b.id === 'saturn';
      const sz = rad * (ring ? 4.2 : 3.4);
      sprites.push({ mode: 2, x: p.x, y: p.y, size: sz, r: rad / sz, color: L.hex(BODY_INFO[b.id].col).map((x) => 0.55 * x + 0.45), alpha: vis * ease,
        sun: sunVec(b.P.phaseAngle * DEG, towardSun(h, p)), ring, occ: 1 - dayF, rot: ring ? -0.35 : 0, bands: b.id === 'jupiter' ? 1 : 0, earth: 0 });
      bodyPos[b.id].r = rad;
    }
    const moonP = mH[2] > -0.02 && !behindHills(mH) ? proj(mH) : null;
    bodyPos.moon = moonP ? { x: moonP.x, y: moonP.y, alt: mH[2], M } : { alt: mH[2], M };
    if (moonP) {
      const rr = Math.max(13, 0.26 * pxDeg * 2.6);
      // 月の北（天の北極の向き）を画面の上の角度に
      const pole = S.apply(H, [0, 0, 1]), q = mH.map((x, i) => x + 0.02 * (pole[i] - x)), b = proj(q, 1);
      const north = b ? Math.atan2(b.x - moonP.x, -(b.y - moonP.y)) * -1 : 0;
      const ci = 2 * M.illum - 1;
      sprites.push({ mode: 3, x: moonP.x, y: moonP.y, size: rr * 3.4, r: 1 / 3.4, color: [0.97, 0.95, 0.88], alpha: 1, rot: north,
        sun: sunVec(Math.acos(Math.max(-1, Math.min(1, ci))), towardSun(mH, moonP), north), occ: 1 - dayF, earth: 0.05 * (1 - dayF * 0.8),
        shadow: eclipse.sep < eclipse.penumbra + eclipse.moonR ? [-eclipse.dE / eclipse.moonR, eclipse.dN / eclipse.moonR, eclipse.umbra / eclipse.moonR, eclipse.penumbra / eclipse.moonR] : null });
      bodyPos.moon.r = rr;
    }
    lastFrameState = { bodyPos, dayF, starF };
    /* 流れ星（再生中の流星群は放射点から。企画書 75 の 7） */
    const evMets = [];
    if (ev && ev.kind === 'meteor' && playing && !reduce.matches) {
      if (now >= ev.nextMet) {
        const Rh = S.apply(starM, ev.R);
        for (let k = 0; k < 6; k++) { const m = WOW.radiantMeteor(Rh, Math.random(), Math.random()); if (m.p[2] > 0.08) { ev.mets.push({ t0: now, dur: 650 + Math.random() * 500, p: m.p, q: m.q, ang: (10 + Math.random() * 16) * DEG }); ev.spawned = (ev.spawned || 0) + 1; break; } }
        ev.nextMet = now + WOW.meteorGap(ev.perHour, ev.speed) * 1000 * (0.5 + Math.random());
      }
      ev.mets = ev.mets.filter((m) => now - m.t0 < m.dur);
      for (const m of ev.mets) {
        const k = (now - m.t0) / m.dur, head = Math.min(1, k * 1.15), tail = Math.max(0, k * 1.15 - 0.6);
        const at = (u) => { const a = m.ang * u, v = m.p.map((x, i) => x * Math.cos(a) + m.q[i] * Math.sin(a)); return v[2] > 0 ? r.project(v, view, cw, ch) : null; };
        const A2 = at(tail), B2 = at(head);
        if (A2 && B2) evMets.push({ a: A2.clip, b: B2.clip, w: 2.6 * dprCap(), alpha: Math.sin(Math.PI * Math.min(1, k)) * 0.95 * starF * (1 - moonF * 0.5) });
      }
      dirty = true;
    }
    let met = null;
    if (meteorDraw) {
      const k = (now - meteorDraw.t0) / meteorDraw.dur, head = Math.min(1, k * 1.15), tail = Math.max(0, k * 1.15 - 0.6);
      const at = (u) => { const a = meteorDraw.ang * u, v = meteorDraw.p.map((x, i) => x * Math.cos(a) + meteorDraw.q[i] * Math.sin(a)); return v[2] > 0 ? r.project(v, view, cw, ch) : null; };
      const A = at(tail), B = at(head);
      if (A && B) met = { a: A.clip, b: B.clip, w: 2.6 * dprCap(), alpha: Math.sin(Math.PI * Math.min(1, k)) * 0.95 * starF * (1 - moonF * 0.5) };
    }
    /* 星雲・星団の実写（企画書 75 の 4）: 画像の中心・右・上の 3 点を星と同じ行列で画面へ */
    const photos = [];
    const addPhoto = (d, alpha, sat) => {
      const c = WOW.photoCorners(d), pc = proj(S.apply(starM, c.c), 0.05), pr = proj(S.apply(starM, c.right), 0.05), pt = proj(S.apply(starM, c.top), 0.05);
      if (pc && pr && pt) photos.push({ id: d.id, clip: pc.clip, bx: [pr.clip[0] - pc.clip[0], pr.clip[1] - pc.clip[1]], by: [pt.clip[0] - pc.clip[0], pt.clip[1] - pc.clip[1]], alpha, sat });
    };
    if (deep) addPhoto(deep, 0.95 * Math.max(0.15, starF), 1);
    // 双眼鏡・望遠鏡の視野に入った天体は、色を抜いて淡く（目で見る星雲は色が薄い。企画書 75 の 6）
    if (scope) for (const d of DSOI) {
      const h = S.apply(starM, S.vec(d.ra * DEG, d.dec * DEG)), p = h[2] > 0 ? proj(h) : null;
      if (p && Math.hypot(p.x - cw / 2, p.y - ch / 2) < Math.min(cw, ch) * 0.6) { r.loadPhoto(d.id, '/hoshizora-night/' + d.file, () => { dirty = true; }); addPhoto(d, 0.45 * starF, 0.15); }
    }
    /* 星の軌跡（企画書 75 の 5）: 向き・拡大・場所・画面の大きさが変わったら描きためた絵を消す */
    let trailSt = null;
    if (trail) {
      const vk = `${st.az.toFixed(5)}|${st.alt.toFixed(5)}|${st.zoom.toFixed(4)}|${place.id}|${canvas.width}x${canvas.height}`;
      const reset = vk !== trail.key; trail.key = vk;
      if (reduce.matches) {   // 動きを減らす設定: 2 時間分を 1 枚に（時間は進めない）
        const ts = WOW.trailTimes(sim);
        trailSt = { reset: true, fade: 0, steps: ts.map((t) => S.starMatrix(t, place.lat, place.lon)), bodySteps: [H] };
      } else {
        const f = WOW.trailFade(trail.acc, frameDt); trail.acc = f.acc;
        trailSt = { reset, fade: reset ? 0 : f.fade };
      }
      window.__night.trailFrames = (window.__night.trailFrames || 0) + 1;
    }
    r.draw({ faint: !!scope && faintOn(), trail: trailSt, photos, pointZoom: 3, art: showArt ? { alpha: 0.34 * starF * ease, color: [0.62, 0.72, 1.0] } : null, starM, H, az: st.az, alt: st.alt, zoom: st.zoom, fovDeg: st.fovDeg, dpr: dprCap(), time: twinkleOn ? now / 1000 : 0, now, cssW: cw, cssH: ch,
      twinkle: twinkleOn ? 1 : 0, limit, twilight: L.twilightWeight(sim, place.lat, place.lon) * (1 - dayF), dusk: 1 - ease,
      milky: st.stage === 'full' ? mwF * ease : 0, milkyTex: st.stage === 'full', noise: true, hills: true,
      sky: { sun: sunHz, day: dayF, glow: 1, moon: mH, moonK: moonF, ext: 1, dim: 1 - 0.3 * (1 - starF), city: lp.glow },
      glows, quads, sprites, moon: null, lineAlpha: 0, allLines: 0, meteor: met, meteors: evMets });

    /* 名前 */
    avoid = uiRects();
    if (showNames && !quiz && starF > 0.05 && !trail && !scope) {
      for (const c of CONS) {
        let sx = 0, sy = 0, n = 0;
        for (const i of c.pi) { const s = picks[i]; if (s.vis) { sx += s.x; sy += s.y; n++; } }
        if (n < Math.max(2, c.pi.length * 0.4)) continue;
        label(X.conLabel(c), sx / n, sy / n - 12, c === selected ? 'con hot' : 'con');
      }
      if (st.zoom > 1.35 || cw > 900) for (const s of picks) if (s.vis && s.name && s.mag <= 2.3 && s !== picked) label(s.name, s.x, s.y, 'star', 8, 0, false);
      if (st.zoom > 1.3 && !deep) for (const d of DSOS) if (d.p) label(EN ? d.en : kids ? 'アンドロメダぎんが' : d.name, d.p.x, d.p.y, 'dso', d.r * pxDeg * 0.5 + 4, -4, false);
    } else if (showNames && !quiz && selected) {
      // 昼でも選んだ星座の名前は出す
    }
    if (showNames && !quiz && !trail) {
      for (const [id, bp] of Object.entries(bodyPos)) {
        if (bp.x == null || bp.alt < 0) continue;
        const lit = id === 'sun' || id === 'moon' || (id === 'venus');
        if (!lit && starF < 0.05) continue;
        label(X.bodyLabel(BODY_INFO[id]), bp.x, bp.y, 'body', (bp.r || 6) + 6, 0, false);
      }
    }
    if (showAster && starF > 0.05) for (const a of ASTERS) if (a.c) label(EN ? a.en : kids ? a.name.replace('夏の大三角', 'なつの だいさんかく').replace('冬の大三角', 'ふゆの だいさんかく').replace('春の大曲線', 'はるの だいきょくせん') : a.name, a.c[0], a.c[1], 'ast');
    // 選んだ星の名前
    if (picked) {
      const pp = picked.body ? bodyPos[picked.body] : (picked.vis ? picked : null);
      if (pp && pp.x != null) label(pickText(picked), pp.x, pp.y, 'pick', (picked.body ? (pp.r || 6) : 6) + 8, 0, false);
    }
    labelsDone();
    // 方位（8 方位。ひらがなモードは 4 方位）
    dirEls.forEach((el, i) => {
      const az = i * Math.PI / 4, p = r.project([Math.sin(az), Math.cos(az), -0.045], view, cw, ch);
      if (p && p.x > -40 && p.x < cw + 40 && p.y > -40 && p.y < ch + 40) { el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.hidden = false; } else el.hidden = true;
    });
    drawFlash(now);
    updateClock();
    dirty = false;
  }

  /* ---------------- 流れ星 ---------------- */
  function spawnMeteor(now) {
    const M = L.METEOR, rnd = Math.random;
    const alt = (M.minAlt + rnd() * 45) * DEG, az = st.az + (rnd() - 0.5) * 1.6;
    const p = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
    let t = [rnd() - 0.5, rnd() - 0.5, -0.3 - rnd() * 0.5];
    const d = t[0] * p[0] + t[1] * p[1] + t[2] * p[2]; t = t.map((x, i) => x - d * p[i]);
    const n = Math.hypot(...t), q = t.map((x) => x / n);
    const dur = forcedDur || (M.durMs[0] + rnd() * (M.durMs[1] - M.durMs[0])); forcedDur = 0;
    return { t0: now, p, q, ang: (M.lenDeg[0] + rnd() * (M.lenDeg[1] - M.lenDeg[0])) * DEG, dur };
  }

  function showLight() {
    const box = $('slow'); if (box) box.hidden = false;
    if (window.__night) window.__night.stage = 'light';
  }

  /* ---------------- カメラ ---------------- */
  /** その向き（地平座標 h）へ寄せる。上に説明シートが来る画面では少し上に置く */
  function flyTo(h, zoomTo) {
    const az1 = Math.atan2(h[0], h[1]), alt1 = Math.max(-2 * DEG, Math.min(80 * DEG, Math.asin(Math.max(-1, Math.min(1, h[2])))));
    const z1 = zoomTo == null ? Math.min(st.zoom, zMax()) : Math.max(L.ZOOM.min, Math.min(zMax(), zoomTo));
    // スマホ（縦長）では説明シートが下半分に出るので、目当てを画面の上 3 割に置く（高度を下げて見る）
    const off = innerWidth < 900 ? 0.22 * ch / (r.pxPerDeg(Object.assign({}, st, { zoom: z1 }), cw, ch) || 1) * DEG : 0;
    // PC では説明シートが右に出るので、目当てを画面の左寄りに置く
    const side = innerWidth >= 900 && !$('sheet').hidden ? 210 / (r.pxPerDeg(Object.assign({}, st, { zoom: z1 }), cw, ch) || 1) * DEG / Math.max(0.3, Math.cos(alt1)) : 0;
    const target = { az: az1 + side, alt: Math.max(-4 * DEG, alt1 - off), zoom: z1 };
    if (reduce.matches) { st.az = target.az; st.alt = target.alt; st.zoom = target.zoom; fly = null; dirty = true; return; }
    fly = { t0: performance.now(), ms: L.FLY.ms, az0: st.az, daz: L.wrapPi(target.az - st.az), alt0: st.alt, alt1: target.alt, z0: st.zoom, z1: target.zoom };
  }
  const conH = (c, ms = sim) => S.apply(S.starMatrix(ms, place.lat, place.lon), c.cv);

  /* ---------------- 操作 ---------------- */
  const ptrs = new Map(); let pinch0 = 0, zoom0 = 1, down = null;
  const k = () => st.zoom / Math.tan(st.fovDeg * Math.PI / 720) * Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* なし */ }
    fly = null;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = st.zoom; down = null; } else down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0 && !scope) st.zoom = Math.max(L.ZOOM.min, Math.min(zMax(), zoom0 * d / pinch0));
    } else {
      const dx = cur.x - prev.x, dy = cur.y - prev.y, f = 2 / k();
      if (gyro.on && Math.abs(dx) + Math.abs(dy) > 6) stopGyro(true);
      if (ev && ev.track && Math.abs(dx) + Math.abs(dy) > 6) ev.track = null;
      st.az = (st.az - dx * f / Math.max(0.35, Math.cos(st.alt)) + 2 * Math.PI) % (2 * Math.PI);
      st.alt = Math.max(-5 * DEG, Math.min(89 * DEG, st.alt + dy * f));
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    }
    dirty = true;
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (down && down.moved < 8 && performance.now() - down.t < 600) handleTap(e.clientX, e.clientY);
    down = null; if (ptrs.size < 2) pinch0 = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); down = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (scope) return; fly = null; st.zoom = Math.max(L.ZOOM.min, Math.min(zMax(), st.zoom * Math.exp(-e.deltaY / 500))); dirty = true; }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); closePanels(); $('help').hidden = true; return; }
    if (e.target !== canvas && e.target !== document.body) return;
    const step = 4 * DEG / st.zoom;
    if (e.key === 'ArrowLeft') st.az -= step; else if (e.key === 'ArrowRight') st.az += step;
    else if (e.key === 'ArrowUp') st.alt = Math.min(89 * DEG, st.alt + step);
    else if (e.key === 'ArrowDown') st.alt = Math.max(-5 * DEG, st.alt - step);
    else if ((e.key === '+' || e.key === ';') && !scope) st.zoom = Math.min(zMax(), st.zoom * 1.15);
    else if (e.key === '-' && !scope) st.zoom = Math.max(L.ZOOM.min, st.zoom / 1.15);
    else return;
    st.az = (st.az + 2 * Math.PI) % (2 * Math.PI); fly = null; dirty = true; e.preventDefault();
  });

  /* ---------------- タップ（軽量版 handleTap と同じ順: 太陽・月・惑星 → 名前のある星 → 星座の線・形） ---------------- */
  let pickedAt = 0;
  function pickText(item) {
    if (item.body) return X.bodyLabel(BODY_INFO[item.body]);
    if (item.con) { const cn = X.conLabel(item.con); return item.name ? `${item.name} · ${cn}` : cn; }
    return item.name + (item.lone ? ` · ${item.lone}` : '');
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, u = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    return Math.hypot(px - ax - u * dx, py - ay - u * dy);
  }
  function conDist(c, x, y) {
    let d = Infinity;
    for (const i of c.pi) { const s = picks[i]; if (s.vis) d = Math.min(d, Math.hypot(s.x - x, s.y - y)); }
    for (const [a, b] of c.ln) { const s1 = picks[c.pi[a]], s2 = picks[c.pi[b]]; if (s1.vis && s2.vis) d = Math.min(d, segDist(x, y, s1.x, s1.y, s2.x, s2.y)); }
    return d;
  }
  function hullArea(c, x, y) {
    const p = c.pi.map((i) => picks[i]).filter((s) => s.vis).map((s) => [s.x, s.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return 0;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], upp = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upp.length >= 2 && cross(upp[upp.length - 2], upp[upp.length - 1], q) <= 0) upp.pop(); upp.push(q); }
    const h = lo.slice(0, -1).concat(upp.slice(0, -1));
    let area = 0;
    for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; if (cross(a, b, [x, y]) < 0) return 0; area += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(area) / 2;
  }
  function pickCon(x, y) {
    let best = null, bd = 40;
    for (const c of CONS) { const d = conDist(c, x, y); if (d < bd) { bd = d; best = c; } }
    if (best) return best;
    let ba = Infinity;
    for (const c of CONS) { const a = hullArea(c, x, y); if (a > 0 && a < ba) { ba = a; best = c; } }
    return best;
  }
  function handleTap(x, y) {
    if (quiz) { quizTap(x, y); return; }
    const bp = lastFrameState ? lastFrameState.bodyPos : {};
    let bb = null, bd = Infinity;
    for (const [id, p] of Object.entries(bp)) { if (p.x == null || p.alt < 0) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < (p.r || 4) + 18 && d < bd) { bd = d; bb = id; } }
    if (bb) { openBody(bb, true); return; }
    // 星雲・星団（実写のある天体。企画書 75 の 4）
    const M3 = S.starMatrix(sim, place.lat, place.lon);
    for (const d of DSOI) {
      const h = S.apply(M3, S.vec(d.ra * DEG, d.dec * DEG)), p = h[2] > 0 ? proj(h) : null;
      if (p && Math.hypot(p.x - x, p.y - y) < Math.max(18, Math.max(d.w, d.h) * r.pxPerDeg(st, cw, ch) * 0.4)) { openDso(d, true); return; }
    }
    let bs = null; bd = 24;
    for (const s of picks) { if (!s.vis || !s.name) continue; const d = Math.hypot(s.x - x, s.y - y) - (s.mag < 1.5 ? 4 : 0); if (d < bd) { bd = d; bs = s; } }
    if (bs) { openStar(bs, true); return; }
    const c = pickCon(x, y);
    if (c) openCon(c, true); else closeSheet();
  }

  /* ---------------- 説明シート ---------------- */
  const sheet = $('sheet'), sheetBody = $('sheetBody');
  function showSheet(html, kind) { sheetBody.innerHTML = html; sheetKind = kind; sheet.hidden = false; sheet.scrollTop = 0; window.__night.sheet = kind.type; }
  function closeSheet() {
    sheet.hidden = true; sheetKind = null; selected = null; picked = null; dirty = true; window.__night.sheet = null; window.__night.picked = null;
    if (deep) { deep = null; window.__night.deep = null; if (st.zoom > L.ZOOM.max) flyBack(); }
  }
  $('sheetClose').addEventListener('click', closeSheet);
  function mark(item) { picked = item; pickedAt = performance.now(); dirty = true; window.__night.picked = item ? pickText(item) : null; }
  function openCon(c, go) {
    selected = c; mark(null); pickedAt = performance.now();
    const ms = sim, M2 = S.starMatrix(ms, place.lat, place.lon);
    const upNow = c.pi.filter((i) => S.apply(M2, picks[i].v)[2] > 0).length >= c.pi.length / 2;
    showSheet(I.con(c, upNow, X), { type: 'con', c });
    window.__night.picked = X.conLabel(c);
    if (go) flyTo(conH(c), Math.max(st.zoom, 1.3));
  }
  function openStar(s, go) {
    selected = s.con || null; mark(s);
    showSheet(I.star({ name: s.raw, mag: s.mag, bv: s.bv, ly: s.ly, con: s.con, conName: s.conName }, X), { type: 'star', s });
    if (go) flyTo(S.apply(S.starMatrix(sim, place.lat, place.lon), s.v), Math.max(st.zoom, L.FLY.zoomTo));
  }
  function openBody(id, go) {
    selected = null; mark({ body: id });
    const H = S.horizonMatrix(sim, place.lat, place.lon);
    let h, b = { id };
    if (id === 'sun') { const Sn = sun(sim); h = S.apply(H, S.vec(Sn.ra, Sn.dec)); }
    else if (id === 'moon') { const M = moon(sim); h = moonH(H, M); b.M = M; }
    else { const p = bodiesNow().find((x) => x.id === id); h = S.apply(H, p.v); b.P = p.P; }
    b.up = h[2] > 0;
    showSheet(I.body(b, place.lat, X), { type: 'body', id });
    if (go && b.up) flyTo(h, Math.max(st.zoom, L.FLY.zoomTo));
  }
  function reopenSheet() {
    if (!sheetKind) return;
    if (sheetKind.type === 'con') openCon(sheetKind.c);
    else if (sheetKind.type === 'star') openStar(sheetKind.s);
    else if (sheetKind.type === 'body') openBody(sheetKind.id);
    else if (sheetKind.type === 'quiz') showSheet(I.quizResult(sheetKind.sc, sheetKind.n, X), sheetKind);
    else if (sheetKind.type === 'dso') openDso(sheetKind.d, false);
  }

  /* ---------------- クイズ（軽量版と同じ: いま出ている星座から 5 問・ヒントで答えの方へ） ---------------- */
  const quizBar = $('quizBar');
  let flash = null;
  const flashEl = Object.assign(document.createElement('p'), { className: 'flash' });
  flashEl.style.cssText = 'position:fixed;left:0;top:0;margin:0;font-weight:600;font-size:30px;pointer-events:none;z-index:4;text-shadow:0 1px 8px #000';
  flashEl.hidden = true; document.body.appendChild(flashEl);
  function drawFlash(now) {
    if (!flash) { flashEl.hidden = true; return; }
    if (now > flash.until) { flash = null; flashEl.hidden = true; return; }
    flashEl.textContent = flash.ok ? TT('correct') : TT('wrong');
    flashEl.style.color = flash.ok ? 'rgba(140,230,170,.95)' : 'rgba(255,120,120,.95)';
    flashEl.style.transform = `translate(${flash.x}px, ${flash.y}px) translate(-50%, -50%)`; flashEl.hidden = false;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function startQuiz() {
    if (!nightNow()) { toast(TT('notNight')); return; }
    const M2 = S.starMatrix(sim, place.lat, place.lon);
    const cands = CONS.filter((c) => { let n = 0; for (const i of c.pi) if (S.apply(M2, picks[i].v)[2] > Math.sin(8 * DEG)) n++; return n >= Math.max(2, Math.ceil(c.pi.length * 0.6)); });
    if (cands.length < 3) { toast(TT('fewCons')); return; }
    quiz = { id: ++quizSeq, list: shuffle(cands).slice(0, 5), i: 0, score: 0, lockUntil: 0, reveal: null };
    closeSheet(); closePanels(); setPlaying(false);
    quizBar.hidden = false; setPressed('quiz', true);
    nextQ();
  }
  function stopQuiz() { quiz = null; quizBar.hidden = true; setPressed('quiz', false); dirty = true; }
  function nextQ() {
    const q = quiz;
    if (q.i >= q.list.length) { const sc = q.score, n = q.list.length; stopQuiz(); showSheet(I.quizResult(sc, n, X), { type: 'quiz', sc, n }); return; }
    $('qNum').textContent = `Q${q.i + 1}/${q.list.length}`;
    $('qText').innerHTML = TT('quizQ', q.list[q.i]);
    dirty = true;
  }
  function quizTap(x, y) {
    const q = quiz, now = performance.now();
    if (now < q.lockUntil) return;
    const target = q.list[q.i], ok = conDist(target, x, y) <= 44 || hullArea(target, x, y) > 0;
    if (ok) q.score++;
    flash = { x, y: Math.max(50, y - 30), ok, until: now + 1100 };
    q.reveal = target; q.lockUntil = now + 1500; pickedAt = now; dirty = true;
    if (!ok) flyTo(conH(target));
    const id = q.id;
    setTimeout(() => { if (!quiz || quiz.id !== id) return; quiz.reveal = null; quiz.i++; nextQ(); }, 1500);
  }
  $('qHint').addEventListener('click', () => { if (quiz && quiz.i < quiz.list.length) flyTo(conH(quiz.list[quiz.i])); });

  /* ---------------- ボタン ---------------- */
  function setPressed(id, on) { const b = $(id); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  const btnPlay = $('play');
  function setPlaying(v) {
    playing = v; lastReal = performance.now(); dirty = true;
    btnPlay.setAttribute('aria-label', v ? T.pause : T.play); btnPlay.dataset.state = v ? 'playing' : 'paused';
    setPressed('tpPlay', v); $('tpPlay').textContent = v ? TT('pause') : TT('play'); $('tpSpeed').textContent = TT('speed', L.SPEEDS[speedIdx]);
    window.__night.playing = v;
  }
  btnPlay.addEventListener('click', () => setPlaying(!playing));
  function jumpTo(ms) { sim = ms; bodiesAt = -Infinity; dirty = true; shownKey = ''; }
  $('now').addEventListener('click', () => jumpTo(Date.now()));
  slider.addEventListener('input', () => { jumpTo(atLocal(sim, place.tz, +slider.value, false)); });
  $('lines').addEventListener('click', () => { showLines = !showLines; setPressed('lines', showLines); dirty = true; window.__night.allLines = showLines; });
  $('names').addEventListener('click', () => { showNames = !showNames; setPressed('names', showNames); dirty = true; });
  $('aster').addEventListener('click', () => { showAster = !showAster; setPressed('aster', showAster); dirty = true; if (showAster) toast(TT('asterToast')); });
  $('quiz').addEventListener('click', () => { if (quiz) stopQuiz(); else startQuiz(); });
  function setKids(on) {
    kids = on; X = I.ctx('ja', kids); document.body.classList.toggle('kids', kids); setPressed('kids', kids);
    placeLabel(); reopenSheet(); if (quiz) nextQ(); shownKey = ''; dirty = true; setPlaying(playing); buildPlaces(); lightText();
  }
  if ($('kids')) $('kids').addEventListener('click', () => { setKids(!kids); toast(TT('kidsToast')); });
  $('red').addEventListener('click', () => { red = !red; document.body.classList.toggle('red', red); setPressed('red', red); if (red) toast(TT('redToast')); });
  if ($('moonBtn')) $('moonBtn').addEventListener('click', () => { closePanels(); openBody('moon', true); });
  // 時間たび
  function closePanels() { for (const [p, b] of [['timePanel', 'timeBtn'], ['places', 'place'], ['lightPanel', 'lightBtn'], ['dsoPanel', 'dsoBtn'], ['eventPanel', 'eventBtn']]) { $(p).hidden = true; if (b === 'place') $(b).setAttribute('aria-expanded', 'false'); else setPressed(b, b === 'lightBtn' ? lightU > 0 : false); } }
  $('timeBtn').addEventListener('click', () => { const open = $('timePanel').hidden; closePanels(); if (open) { $('timePanel').hidden = false; setPressed('timeBtn', true); } });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
  document.querySelectorAll('#timePanel [data-d]').forEach((b) => b.addEventListener('click', () => jumpTo(sim + Number(b.dataset.d) * 86400000)));
  document.querySelectorAll('#timePanel [data-month]').forEach((b) => b.addEventListener('click', () => { const d = new Date(sim); d.setUTCMonth(d.getUTCMonth() + Number(b.dataset.month)); jumpTo(d.getTime()); }));
  $('tpNowBtn').addEventListener('click', () => { jumpTo(Date.now()); setPlaying(false); });
  $('tpPlay').addEventListener('click', () => { setPlaying(!playing); if (playing) toast(TT('playToast', L.SPEEDS[speedIdx])); });
  $('tpSpeed').addEventListener('click', () => { speedIdx = (speedIdx + 1) % L.SPEEDS.length; setPlaying(playing); });
  // 共有
  $('share').addEventListener('click', async () => {
    closePanels();
    const url = L.shareUrl(location.origin, EN ? 'en' : 'ja', sim, place.tz, place.lat, place.lon);
    history.replaceState(null, '', L.formatHash(place.lat, place.lon, sim));
    window.__night.shared = url;
    try {
      if (navigator.share) { await navigator.share({ url }); return; }
      await navigator.clipboard.writeText(url); toast(T.copied);
    } catch (e) { /* 取り消し・使えないときは何もしない */ }
  });
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); window.__night.toast = msg; }
  /* ---------------- 1 ジャイロ（企画書 75）: スマホを空にかざすとその方向の星 ----------------
     DeviceOrientationEvent。iPhone は許可のボタン（requestPermission）。拒否・非対応ならドラッグのまま。
     方位は磁北が基準（Android の deviceorientationabsolute・iPhone の webkitCompassHeading）なので、WMM2025 の偏角を足して真北に */
  const gyro = { on: false, want: null, offset: null, rel: null, got: false, timer: 0, calib: false, evName: '' };
  const gyroBtn = $('gyro');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (gyroBtn && typeof window.DeviceOrientationEvent !== 'undefined' && (coarse || params.get('gyro') === 'show')) gyroBtn.hidden = false;
  function onOrient(e) {
    if (!gyro.on || e.alpha == null || e.beta == null || e.gamma == null) return;
    const scr = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let alpha = e.alpha, north = true;
    if (e.webkitCompassHeading != null && isFinite(e.webkitCompassHeading)) {
      gyro.offset = WOW.compassOffset(gyro.offset, e.alpha, e.beta, e.gamma, e.webkitCompassHeading);
      alpha = e.alpha + gyro.offset;
      if (!gyro.calib && WOW.needCalibration(e.webkitCompassAccuracy)) { gyro.calib = true; toast(wt('gyroCalib')); }
    } else if (!(e.absolute || e.type === 'deviceorientationabsolute')) north = false;
    const v = WOW.deviceView(alpha, e.beta, e.gamma, scr);
    let az = v.az;
    if (north) az += WOW.declination(place.lat, place.lon, sim) * DEG;     // 磁北 → 真北
    else { if (gyro.rel == null) gyro.rel = st.az - v.az; az += gyro.rel; }   // 北が分からない端末: いまの向きを基準に
    gyro.want = { az: ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), alt: Math.max(-30 * DEG, Math.min(89.5 * DEG, v.alt)) };
    if (!gyro.got) { gyro.got = true; clearTimeout(gyro.timer); toast(north ? wt('gyroOn') : wt('gyroRelative')); }
    window.__night.gyro = { az: gyro.want.az / DEG, alt: gyro.want.alt / DEG, north };
    dirty = true;
  }
  function startGyro() {
    gyro.on = true; gyro.got = false; gyro.want = null; gyro.offset = null; gyro.rel = null; gyro.calib = false;
    fly = null; setPressed('gyro', true);
    gyro.evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    addEventListener(gyro.evName, onOrient);
    clearTimeout(gyro.timer);
    gyro.timer = setTimeout(() => { if (gyro.on && !gyro.got) { stopGyro(false); toast(wt('gyroDenied')); } }, WOW.GYRO.noEventMs);
  }
  function stopGyro(say) {
    if (!gyro.on) return;
    gyro.on = false; gyro.want = null; clearTimeout(gyro.timer); setPressed('gyro', false);
    if (gyro.evName) removeEventListener(gyro.evName, onOrient);
    if (say) toast(wt('gyroOff'));
    window.__night.gyro = null;
  }
  if (gyroBtn) gyroBtn.addEventListener('click', async () => {
    if (gyro.on) { stopGyro(true); return; }
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {   // iPhone（iOS 13 以降）: ボタンを押したときに許可を求める
      try { if (await DOE.requestPermission() !== 'granted') { toast(wt('gyroDenied')); return; } } catch (err) { toast(wt('gyroDenied')); return; }
    }
    startGyro();
  });

  /* ---------------- 2 街明かり（企画書 75）: 田舎〜都会のつまみ。限界等級・天の川・空の明るさが連動 ---------------- */
  let lightU = 0;
  const lightSlider = $('lightSlider');
  function lightText() {
    const lp = WOW.lightPollution(lightU), f = wt('lightRead');
    $('lightRead').textContent = f(lp.sky, Math.min(lp.limit, L.STAR_LIMIT));
    setPressed('lightBtn', lightU > 0 || !$('lightPanel').hidden);
    window.__night.light = { u: lightU, sky: lp.sky, limit: lp.limit, milky: lp.milky };
  }
  $('lightBtn').addEventListener('click', () => { const open = $('lightPanel').hidden; closePanels(); if (open) $('lightPanel').hidden = false; lightText(); });
  lightSlider.addEventListener('input', () => { lightU = +lightSlider.value / WOW.LIGHT.steps; lightText(); dirty = true; });

  /* ---------------- 3 星座絵（企画書 75）: ヘヴェリウス『Firmamentum Sobiescianum』（1690）を淡く重ねる ----------------
     網と画像（render/art.js・render/art/*.jpg）は押したときに初めて読む（初めの読み込みを重くしない） */
  let showArt = false, artLoaded = false;
  function loadArtData(done) {
    if (window.NightArt) { done(); return; }
    const sc = document.createElement('script'); sc.src = '/hoshizora-night/render/art.js'; sc.onload = done; document.head.appendChild(sc);
  }
  $('artBtn').addEventListener('click', () => {
    showArt = !showArt; setPressed('artBtn', showArt); $('artCredit').hidden = !showArt; dirty = true;
    if (showArt) {
      toast(wt('artToast'));
      if (!artLoaded) { artLoaded = true; loadArtData(() => { r.setArt(window.NightArt.ART); r.loadArt('/hoshizora-night/', () => { dirty = true; texSettle = performance.now() + 900; }); }); }
    }
    window.__night.art = showArt;
  });

  /* ---------------- 4 星雲・星団へのズーム（企画書 75）: ESA/Hubble の実写を、向きと大きさを空に合わせて重ねる ---------------- */
  function openDso(d, go) {
    if (scope) setScope(null);
    selected = null; mark(null); deep = d; setPlaying(false);
    r.loadPhoto(d.id, '/hoshizora-night/' + d.file, () => { dirty = true; texSettle = performance.now() + 900; });
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    showSheet(`<p class="sh-kana">${esc(wt('dsoTitle'))}</p><h2 class="sh-name">${esc(EN ? d.en : d.name)}</h2>${EN ? '' : `<p class="sh-en">${esc(d.en)}</p>`}`
      + `<p class="sh-story">${esc(wt('dsoPhoto'))}</p>`
      + `<p class="dso-credit">${esc(wt('dsoCredit'))}: <a href="${d.page}" rel="noopener">${esc(d.credit)}</a>${d.changed ? ' ' + esc(wt('dsoChanged')) : ''}</p>`
      + `<button type="button" class="wide" id="dsoBack">${esc(wt('dsoBack'))}</button>`, { type: 'dso', d });
    $('dsoBack').addEventListener('click', closeSheet);
    window.__night.deep = d.id;
    const h = S.apply(S.starMatrix(sim, place.lat, place.lon), S.vec(d.ra * DEG, d.dec * DEG));
    if (go && h[2] > 0) flyTo(h, WOW.zoomFor(d, st.fovDeg));
    dirty = true;
  }
  /** ズームから戻る: 向きはそのまま、拡大を 1.6 倍へ */
  function flyBack() {
    const V = R.viewMatrix(st.az, st.alt);
    flyTo([V[6], V[7], V[8]], Math.min(L.FLY.zoomTo, L.ZOOM.max));
  }
  function buildDso() {
    const box = $('dsoList'); box.textContent = '';
    for (const d of DSOI) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = EN ? d.en : d.name.replace(/（.*）/, '');
      b.addEventListener('click', () => {
        closePanels();
        const t = WOW.viewTime(sim, place.lat, place.lon, d.ra, d.dec);
        if (t == null) { toast(wt('dsoNone')); return; }
        if (t !== sim) { jumpTo(t); toast(wt('dsoMoved')); }
        openDso(d, true);
      });
      box.appendChild(b);
    }
  }
  buildDso();
  $('dsoBtn').addEventListener('click', () => { const open = $('dsoPanel').hidden; closePanels(); if (open) { $('dsoPanel').hidden = false; setPressed('dsoBtn', true); } });

  /* ---------------- 5 星の軌跡（企画書 75）: 早回しで、星の動いたあとが光の筋で残る ---------------- */
  let trail = null, trailWasPlaying = false;
  function setTrail(on) {
    if (on && st.stage !== 'full') { toast(wt('trailSlow')); return; }
    if (on) {
      trail = { acc: 0, key: '' }; trailWasPlaying = playing; closeSheet();
      if (reduce.matches) { setPlaying(false); toast(wt('trailStatic')); } else { setPlaying(true); toast(wt('trailOn')); }
    } else if (trail) { trail = null; setPlaying(trailWasPlaying && !reduce.matches); }
    setPressed('trailBtn', !!trail); dirty = true; window.__night.trail = !!trail;
  }
  $('trailBtn').addEventListener('click', () => setTrail(!trail));

  /* ---------------- 6 双眼鏡・望遠鏡（企画書 75）: 円い視野で拡大し、限界等級を上げる ---------------- */
  let faintState = 'none';   // none → loading → ok
  const faintOn = () => faintState === 'ok' && st.stage === 'full';
  function loadFaint() {
    if (faintState !== 'none' || !WOW.SCOPE.hipparcos || st.stage !== 'full') return;
    faintState = 'loading';
    const sc = document.createElement('script'); sc.src = '/hoshizora-night/render/hip.js';
    sc.onload = () => {
      const dec = (b) => { const t = atob(b), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
      r.setFaint(WOW.decodeHip(window.NightHip.HIP, dec)); faintState = 'ok'; scopeUi(); dirty = true;
    };
    document.head.appendChild(sc);
  }
  function scopeUi() {
    const m = $('scopeMask'); m.hidden = !scope;
    if (scope) m.style.setProperty('--r', `${Math.round(WOW.SCOPE.frac * Math.min(canvas.clientWidth, canvas.clientHeight))}px`);
    $('hipCredit').hidden = !(scope && faintOn());
    setPressed('scopeBtn', !!scope);
    const lab = WT[scope && scope.mode === 'tele' ? 'bScopeTele' : 'bScope'];
    $('scopeBtn').innerHTML = Array.isArray(lab) ? `<span class="ad">${lab[0]}</span><span class="kd">${lab[1]}</span>` : lab;
    window.__night.scope = scope ? scope.mode : null; window.__night.faint = r.faintCount();
  }
  function setScope(mode) {
    if (mode && deep) closeSheet();
    if (mode) {
      const prev = scope ? scope.prevZoom : st.zoom;
      scope = { mode, zoom: WOW.scopeZoom(WOW.SCOPE.modes[mode].field, st.fovDeg), prevZoom: prev };
      st.zoom = scope.zoom; fly = null; loadFaint();
      const lim = WOW.lightPollution(lightU).limit + 5 * Math.log10(WOW.SCOPE.modes[mode].aperture / WOW.SCOPE.eyePupil);   // 星表で切る前の限界等級
      toast(wt(mode === 'bino' ? 'scopeBino' : 'scopeTele')(Math.min(lim, WOW.SCOPE.catalogLimit)) + (lim > WOW.SCOPE.catalogLimit ? ' ' + wt('scopeCap') : ''));
    } else if (scope) { st.zoom = Math.min(scope.prevZoom, L.ZOOM.max); scope = null; toast(wt('scopeOff')); }
    scopeUi(); dirty = true;
  }
  $('scopeBtn').addEventListener('click', () => setScope(!scope ? 'bino' : scope.mode === 'bino' ? 'tele' : null));
  addEventListener('resize', () => { if (scope) scopeUi(); });

  /* ---------------- 7 イベントの再生（企画書 75）: 次の皆既月食・流星群の極大を早回しで ----------------
     日付は engine/official-events.js（国立天文台の発表の写し）、月食の時刻はこのサイトの計算（render/wow.js） */
  let ev = null;
  const hm = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
  const dayText = (date) => {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return EN ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))) : `${y}年${m}月${d}日（${'日月火水木金土'[w]}）`;
  };
  function evName(e) {
    if (e.kind === 'eclipse') return `${dayText(e.date)} ${wt('evEclipse')}`;
    const s2 = L.SHOWERS[e.shower]; return `${dayText(e.peak)} ${EN ? s2[1] : s2[0]}${wt('evPeak')}`;
  }
  function buildEvents() {
    const box = $('eventList'); box.textContent = '';
    const list = WOW.upcoming(Date.now(), O);
    if (!list.length) { const p2 = document.createElement('p'); p2.className = 'note'; p2.textContent = wt('evNone'); box.appendChild(p2); return; }
    for (const e of list) {
      const div = document.createElement('div'); div.className = 'evitem';
      const b = document.createElement('b'); b.textContent = evName(e) + (e.kind === 'eclipse' && e.japan === 'visible' ? `（${wt('evJapan')}）`.replace(/^（(.*)）$/, EN ? ' ($1)' : '（$1）') : '');
      const sm = document.createElement('small');
      sm.textContent = e.kind === 'eclipse' ? wt('evEclTimes')(hm(e.c.u1), hm(e.c.u2), hm(e.c.u3), hm(e.c.u4)) : wt('evRate')(e.rate);
      const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = wt('evPlay');
      bt.addEventListener('click', () => playEvent(e));
      div.append(b, sm, bt); box.appendChild(div);
    }
  }
  function playEvent(e) {
    closePanels(); closeSheet(); if (scope) setScope(null); if (trail) setTrail(false); stopGyro(false);
    const name = evName(e), motion = !reduce.matches;
    ev = { kind: e.kind, speed: e.kind === 'eclipse' ? WOW.EVENT.eclipseSpeed : WOW.EVENT.meteorSpeed, track: null, mets: [], nextMet: 0, done: false };
    if (e.kind === 'eclipse') {
      ev.track = 'moon'; ev.end = e.c.u4 + 10 * 60e3;
      jumpTo(motion ? e.c.u1 - WOW.EVENT.eclipseLeadMin * 60e3 : e.c.max); st.zoom = WOW.EVENT.eclipseZoom;
    } else {
      ev.R = S.vec(e.radiant[0] * DEG, e.radiant[1] * DEG); ev.perHour = WOW.ratePerHour(e.rate); ev.end = e.view + WOW.EVENT.meteorAfterH * 3600e3;
      jumpTo(motion ? e.view - WOW.EVENT.meteorBeforeH * 3600e3 : e.view); st.zoom = 1;
      const h = S.apply(S.starMatrix(motion ? e.view : sim, place.lat, place.lon), ev.R);
      st.az = Math.atan2(h[0], h[1]); st.alt = Math.max(20 * DEG, Math.min(55 * DEG, Math.asin(h[2])));
    }
    fly = null;
    $('evText').textContent = wt('evPlaying')(name); $('eventBar').hidden = false;
    if (motion) setPlaying(true); else { setPlaying(false); toast(wt('evReduced')); }
    window.__night.event = { kind: e.kind, end: ev.end, name };
    dirty = true;
  }
  function stopEvent() { ev = null; $('eventBar').hidden = true; setPlaying(false); window.__night.event = null; st.zoom = Math.min(st.zoom, L.ZOOM.max); dirty = true; }
  $('evStop').addEventListener('click', stopEvent);
  $('eventBtn').addEventListener('click', () => { const open = $('eventPanel').hidden; closePanels(); if (open) { buildEvents(); $('eventPanel').hidden = false; setPressed('eventBtn', true); } });

  // 使い方
  $('helpBtn').addEventListener('click', () => { $('help').hidden = false; });
  $('helpStart').addEventListener('click', () => { $('help').hidden = true; canvas.focus({ preventScroll: true }); });
  $('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').hidden = true; });

  // 場所
  const panel = $('places'), list = $('placeList');
  function openPlaces(v) { closePanels(); panel.hidden = !v; $('place').setAttribute('aria-expanded', String(v)); }
  $('place').addEventListener('click', () => openPlaces(panel.hidden));
  $('closePlaces').addEventListener('click', () => openPlaces(false));
  function buildPlaces() {
    list.textContent = '';
    LOCS_ALL.forEach((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = !EN && kids && p.kana ? p.kana : EN ? (p.en || p.name) : p.name; b.dataset.id = p.id;
      b.setAttribute('aria-pressed', String(p.id === place.id));
      b.addEventListener('click', () => { setPlace(p); toast(p.lat < 0 ? TT('southToast') : TT('movedToast', placeName(p))); });
      list.appendChild(b);
    });
  }
  buildPlaces();
  function setPlace(p, keepView) {
    place = p; openPlaces(false); bodiesAt = -Infinity; dirty = true; shownKey = ''; tonightKey = '';
    if (!keepView) { st.az = p.lat >= 0 ? Math.PI : 0; fly = null; }
    placeLabel();
  }
  $('geo').addEventListener('click', () => {
    if (!navigator.geolocation) { toast(TT('noGeo')); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      // 星空には 0.1°（約 10 km）で足りる。丸めた値だけを使い、どこにも送らない
      const lat = Math.round(pos.coords.latitude * 10) / 10, lon = Math.round(pos.coords.longitude * 10) / 10;
      setPlace({ id: 'here', name: T.here, en: T.here, lat, lon, tz: deviceTz() }); toast(TT('geoOk'));
    }, () => toast(TT('geoFail')), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
  if ($('locForm')) $('locForm').addEventListener('submit', (e) => {   // 緯度・経度を入れる（英語版。軽量版と同じ）
    e.preventDefault();
    const a = $('locLat').value, o = $('locLon').value, lat = Number(a), lon = Number(o);
    if (!(a !== '' && o !== '' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { toast(TT('badCoords')); return; }
    const rr = (v) => Math.round(v * 10) / 10;
    setPlace({ id: 'shared', name: '', en: `${TT('custom')} (${rr(lat)}°, ${rr(lon)}°)`, lat: rr(lat), lon: rr(lon), tz: deviceTz() });
    toast(TT('movedToast', placeName(place)));
  });

  // 動きを減らす設定が途中で変わったら、止める
  if (reduce.addEventListener) reduce.addEventListener('change', () => { if (reduce.matches) { setPlaying(false); fly = null; } dirty = true; });

  window.__night = { stage: 'full', fps: [], playing, picked: null, get place() { return place.id; }, sheet: null, toast: null, get sim() { return sim; }, get limit() { return st.limit; },
    allLines: showLines, intro: () => introStart == null, meteor: () => !!meteor, forceMeteor: (dur) => { nextMeteor = 0; forcedDur = dur || 0; },
    gyro: null, light: null, art: false, trail: false, trailFrames: 0, scope: null, faint: 0, setScope: (m) => setScope(m), event: null, playEvent: (i) => playEvent(WOW.upcoming(Date.now(), O)[i]), eclipse: () => WOW.eclipseAt(sim), evSpawned: () => (ev ? ev.spawned || 0 : 0),
    lookAt: (raDeg, decDeg) => { const h = S.apply(S.starMatrix(sim, place.lat, place.lon), S.vec(raDeg * DEG, decDeg * DEG)); st.az = Math.atan2(h[0], h[1]); st.alt = Math.asin(h[2]); fly = null; dirty = true; return Math.asin(h[2]) / DEG; }, artState: () => r.artState(), deep: null, photoState: () => r.photoState(), openDso: (id) => openDso(DSOI.find((d) => d.id === id), true), setLight: (u) => { lightSlider.value = String(Math.round(u * WOW.LIGHT.steps)); lightSlider.dispatchEvent(new Event('input')); }, reduce: reduce.matches, select: (x, y) => handleTap(x, y), view: st, flying: () => !!fly, textures: () => r.textures(),
    loading: () => { const t = r.textures(); return params.get('tex') !== 'off' && (!t.milky || !t.moon || performance.now() < texSettle); },
    where: (name) => {   // 確かめ用: 名前の付いた星・惑星・月の画面上の位置（CSS px）。見えなければ null
      const bp = lastFrameState && lastFrameState.bodyPos[name]; if (bp) return bp.x == null ? null : { x: bp.x, y: bp.y };
      const s = picks.find((x) => x.name === name); if (!s) return null;
      const h = S.apply(S.starMatrix(sim, place.lat, place.lon), s.v);
      return h[2] > 0 ? r.project(h, st, canvas.clientWidth, canvas.clientHeight) : null;
    },
    labelRects: () => ({ ui: uiRects(), labels: [...labelBox.children].filter((e) => !e.hidden).map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent, x: b.left, y: b.top, r: b.right, b: b.bottom }; }) }),
    conAt: (id) => { const c = CONS.find((x) => x.id === id); const h = conH(c); return h[2] > 0 ? r.project(h, st, canvas.clientWidth, canvas.clientHeight) : null; } };

  /* ---------------- はじまり（軽量版 init と同じ順: 共有の # → カレンダーの ?t= → 図鑑の ?c= → 昼なら今夜 21 時） ---------------- */
  const shared = L.parseHash(location.hash);
  const target = shared ? null : CONS.find((c) => c.id === params.get('c'));
  if (shared) {
    const near = LOCS_ALL.find((p) => Math.abs(p.lat - shared.lat) < 0.006 && Math.abs(p.lon - shared.lon) < 0.006);
    place = near || { id: 'shared', lat: shared.lat, lon: shared.lon, tz: deviceTz() };
    sim = shared.ms; playing = false;
    if (place.lat < 0) st.az = 0;
  } else if (!openAt()) {
    if (target) focusCon(target);
    else if (sunAlt(sim) > -6) { sim = atLocal(sim, place.tz, 21 * 60, true); setTimeout(() => toast(TT('dayJump')), 600); }
  }
  /** 天文カレンダーからのリンク: ?t=<日時>&loc=<場所>&look=<向き>、英語版は ?lt=<現地時刻> か ?d=<日付>&tw=evening|morning（軽量版 openAt と同じ） */
  function openAt() {
    const l = LOCS.find((x) => x.id === params.get('loc'));
    if (l) place = LOCS_ALL.find((p) => p.id === l.id) || P.reduce((a, b) => (L.kmBetween(b, l) < L.kmBetween(a, l) ? b : a));
    let ms = Date.parse(params.get('t') || '');
    if (!isFinite(ms) && params.get('lt')) ms = fromLocal(params.get('lt'));
    if (!isFinite(ms) && /^\d{4}-\d\d-\d\d$/.test(params.get('d') || '')) ms = twilightAt(params.get('d'), params.get('tw') !== 'morning');
    if (!isFinite(ms)) return false;
    sim = ms; playing = false;
    const H = S.horizonMatrix(ms, place.lat, place.lon), look = params.get('look') || '';
    let h = null;
    if (look === 'moon') { const M = moon(ms); h = moonH(H, M); }
    else if (PLANET_IDS.includes(look)) { const p = planet(look, ms, precessor(ms)); h = S.apply(H, S.vec(p.ra, p.dec)); }
    else if (look.startsWith('con:')) { const c = CONS.find((x) => x.id === look.slice(4)); if (c) h = conH(c, ms); }
    else if (look.startsWith('radiant:')) {
      const [ra, dec] = look.slice(8).split(',').map(Number);
      if (isFinite(ra) && isFinite(dec)) h = S.apply(S.starMatrix(ms, place.lat, place.lon), S.vec(ra * DEG, dec * DEG));
    } else if (look.startsWith('az:')) { const a = Number(look.slice(3)); if (isFinite(a)) st.az = a * DEG; }
    if (h) { st.az = Math.atan2(h[0], h[1]); st.alt = Math.max(st.alt * 0.8, Math.min(70 * DEG, Math.asin(h[2]))); }
    else if (!look.startsWith('az:')) st.az = place.lat >= 0 ? Math.PI : 0;
    setTimeout(() => toast(TT('linkedToast', lp(ms), placeName(place))), 600);
    return true;
  }
  /** 図鑑からのリンク（?c=ori）: その星座がよく見える夜の 21 時へ（軽量版 focusCon と同じ） */
  function focusCon(c) {
    const decDeg = Math.asin(c.cv[2]) / DEG;
    if (90 - Math.abs(place.lat - decDeg) < 12 && place.lat > 0) place = LOCS_ALL.find((p) => p.id === 'sydney') || place;
    const best = 90 - Math.abs(place.lat - decDeg), goal = Math.sin(Math.min(best - 6, 50) * DEG);
    const base = atLocal(Date.now() - 3 * 3600e3, place.tz, 21 * 60, true);
    let when = base;
    for (let n = 0; n < 370; n++) { const ms = base + n * 86400000; if (conH(c, ms)[2] >= goal) { when = ms; break; } }
    when = atLocal(when, place.tz, 21 * 60, false);
    sim = when; playing = false;
    const h = conH(c, when);
    st.az = Math.atan2(h[0], h[1]); st.alt = Math.max(10 * DEG, Math.asin(h[2]) - 12 * DEG);
    setTimeout(() => { openCon(c); toast(TT('focusToast', c, lp(when), placeName(place))); }, 0);
  }
  const vq = (params.get('view') || '').split(',').map(Number);
  if (vq.length === 2 && vq.every(isFinite)) { st.az = vq[0] * DEG; st.alt = vq[1] * DEG; }

  setPlaying(playing);
  placeLabel();
  lightText();
  addEventListener('resize', () => { dirty = true; });
  requestAnimationFrame((t) => {
    lastReal = t; if (introStart === -1) introStart = t; nextMeteor = t + (4 + Math.random() * 8) * 1000;
    frame(t); document.documentElement.dataset.ready = '1';
  });
})();
