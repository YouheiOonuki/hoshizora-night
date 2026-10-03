'use strict';
/* ほしぞらさんぽ フル版の画面（ROADMAP 7.15.1）。描画は render/night-gl.js、決まりは render/look.js、計算は engine/（通常版の写し）。
   ・入力（場所・時刻）は端末の外に出さない。保存（localStorage）はしない。場所と時刻は URL の # だけ（#lat,lon,unixtime）
   ・?probe=off で最初の fps の測定を止める（スクショ・計測用） */
(function () {
  const L = window.NightLook, S = window.NightSky, R = window.NightRender, O = window.NightEvents, P = window.NightPrefs.PREFS;
  const $ = (id) => document.getElementById(id);
  const EN = document.documentElement.lang === 'en';
  const T = L.TEXT[EN ? 'en' : 'ja'];
  const canvas = $('sky');
  if (!window.NightGate.guard({ document, location }).ok) return;

  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const params = new URLSearchParams(location.search);

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
  const picks = [];   // タップで選べるもの: 星座の星・1 等星ほか
  CONS.forEach((c) => c.ss.forEach((s, i) => picks.push({ v: S.vec(s[0] * 15 * DEG, s[1] * DEG), mag: s[2], con: c, i,
    name: s[4] ? (EN ? enStar(s[4]) || '' : s[4].split('（')[0]) : '' })));
  LONE.forEach((s) => picks.push({ v: S.vec(s[0] * 15 * DEG, s[1] * DEG), mag: s[2], lone: EN ? (CON_EN_EXTRA[s[6]] || '') : s[6],
    name: EN ? enStar(s[4]) : s[4] }));

  /* ---------------- 状態 ---------------- */
  // 英語版は世界の都市（通常版の英語と同じ表。日本の都市は都道府県庁の一覧と重なるので外す）＋都道府県庁
  const WORLD = LOCS_WORLD.filter((l) => l.tz !== 'Asia/Tokyo');
  const LOCS_EN = EN ? [...WORLD, ...P] : P;
  const st = { az: Math.PI, alt: (innerHeight > innerWidth ? 38 : 30) * DEG, zoom: 1, fovDeg: 100, limit: L.STAR_LIMIT + 0.1, stage: 'full', lineAlpha: 0, allLines: false };
  let place = P.find((p) => p.id === 'pref-13');
  let sim = Date.now(), playing = !reduce.matches, lastReal = performance.now();
  let picked = null, pickedAt = 0;
  const placeName = (p) => L.placeText(p, P, EN).main;

  function deviceTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch (e) { return 'Asia/Tokyo'; } }
  if (EN) {   // 英語版は端末のタイムゾーンの都市を既定に（通常版の英語と同じ考え方）
    const tz = deviceTz(), w = WORLD.find((l) => l.tz === tz);
    if (w) place = w;
  }

  // 共有の # で開いた（その瞬間で止める）
  const shared = L.parseHash(location.hash);
  if (shared) {
    const near = LOCS_EN.find((p) => Math.abs(p.lat - shared.lat) < 0.006 && Math.abs(p.lon - shared.lon) < 0.006);
    place = near || { id: 'shared', lat: shared.lat, lon: shared.lon, tz: deviceTz() };
    sim = shared.ms; playing = false;
  } else if (Date.parse(params.get('t') || '') > 0) {   // 通常版・天文カレンダーと同じ ?t=<日時>&loc=<場所>
    sim = Date.parse(params.get('t'));
    const l = LOCS.find((x) => x.id === params.get('loc'));
    if (l) place = P.reduce((a, b) => (Math.hypot(b.lat - l.lat, b.lon - l.lon) < Math.hypot(a.lat - l.lat, a.lon - l.lon) ? b : a));
    playing = false;
  } else if (L.sunAltDeg(sim, place.lat, place.lon) > -6) {
    sim = atLocal(sim, place.tz, 21 * 60, true);     // 昼に開いたら今夜 21 時の空
  }

  /* ---------------- 時刻（その土地の時刻） ---------------- */
  function parts(ms, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const o = {}; f.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = +p.value || p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute };
  }
  /** その土地のその日の 0 時からの分 → UNIX ミリ秒。nextIfPast なら過ぎていれば翌日 */
  function atLocal(ms, tz, minutes, nextIfPast) {
    const p = parts(ms, tz);
    let guess = Date.UTC(p.y, p.m - 1, p.d) + minutes * 60e3;
    for (let k = 0; k < 3; k++) { const q = parts(guess, tz); guess += ((p.d === q.d ? 0 : Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(q.y, q.m - 1, q.d)) + (minutes - q.h * 60 - q.min) * 60e3); }
    if (nextIfPast && guess < ms) guess = atLocal(ms + 86400e3, tz, minutes, false);
    return guess;
  }

  /* ---------------- 描画器 ---------------- */
  let r;
  try { r = R.create(canvas, stars, MW); } catch (e) { showLight(); return; }
  const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);
  function fit() {
    const d = dprCap(), w = Math.round(canvas.clientWidth * d), h = Math.round(canvas.clientHeight * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }

  let bodiesAt = -Infinity, moonState = null, sunH = null;
  function updateBodies(H) {
    const prec = precessor(sim);
    if (Math.abs(sim - bodiesAt) > 10 * 60e3) {
      r.setBodies(PLANET_IDS.map((id) => { const p = planet(id, sim, prec); return { v: S.vec(p.ra, p.dec), mag: p.mag, color: L.starColor(0.4).map((x, i) => (x + L.hex(BODY_INFO[id].col)[i]) / 2), id }; }));
      bodiesAt = sim;
    }
    const M = moon(sim), Sn = sun(sim);
    moonState = { M, h: S.apply(H, S.vec(M.ra, M.dec)) };
    sunH = S.apply(H, S.vec(Sn.ra, Sn.dec));
  }

  /* ---------------- 文字 ---------------- */
  const elTime = $('time'), elDate = $('date'), slider = $('slider'), dirs = [...document.querySelectorAll('#dirs span')], label = $('pick');
  let shownMin = -1;
  function updateClock() {
    const p = parts(sim, place.tz), m = p.h * 60 + p.min;
    if (m === shownMin && !dirty) return;
    shownMin = m;
    elTime.textContent = `${p.h}:${String(p.min).padStart(2, '0')}`;
    elDate.textContent = EN ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: place.tz }).format(new Date(sim)) : `${p.m}月${p.d}日`;
    if (document.activeElement !== slider) slider.value = String(m);
    const key = L.nightOf(sim);
    if (key !== tonightKey) renderTonight(key);
  }
  let tonightKey = '';
  function renderTonight(key) {
    tonightKey = key;
    const ul = $('tonight'); ul.textContent = '';
    const evs = L.tonight(sim, O, BODY_INFO, EN ? 'en' : 'ja');
    tonightPeak = evs.some((e) => e.kind === 'meteor');
    for (const e of evs) { const li = document.createElement('li'); li.textContent = e.title; li.dataset.kind = e.kind; ul.appendChild(li); }
  }
  function placeLabel() {
    const t = L.placeText(place, P, EN);
    $('place').textContent = t.main;
    const sub = $('placeSub'); sub.textContent = t.sub; sub.hidden = !t.sub;
  }

  /* ---------------- 1 フレーム ---------------- */
  let dirty = true;
  // 最初の 3 秒の fps の中央値（測る間は毎フレーム描く）。24 未満なら 4 等まで → それでも 24 未満なら通常版へのリンク
  const probe = { on: params.get('probe') !== 'off', start: 0, last: 0, dts: [] };
  // ?fps=show: 実機の計測用（オーナーが Android で測る）。3 秒ごとの fps の中央値を左下に出し、毎フレーム描く
  const meter = params.get('fps') === 'show' ? { el: Object.assign(document.createElement('p'), { className: 'fps' }), start: 0, last: 0, dts: [], all: [] } : null;
  if (meter) document.body.appendChild(meter.el);
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
    if (playing) { sim += (now - lastReal) * L.SPEED; dirty = true; }
    lastReal = now;
    const twinkleOn = !reduce.matches;
    const fading = picked && st.lineAlpha < L.LINE.alpha;
    // 開いたときの演出（1 回。reduced motion では無し）: 夕方の空から夜へ、星が明るい順に灯る
    let intro = 1;
    if (introStart != null) { intro = Math.min(1, (now - introStart) / L.INTRO.ms); if (intro >= 1) introStart = null; dirty = true; }
    const ease = intro * intro * (3 - 2 * intro);
    // 流れ星（reduced motion では無し。極大の夜は多め）
    let meteorDraw = null;
    if (!reduce.matches && intro >= 1) {
      if (!meteor && now >= nextMeteor) meteor = spawnMeteor(now);
      if (meteor) {
        const k = (now - meteor.t0) / meteor.dur;
        if (k >= 1) { meteor = null; nextMeteor = now + L.meteorWait(Math.random(), tonightPeak) * 1000; }
        else meteorDraw = meteor; dirty = true;
      }
    }
    if (!dirty && !twinkleOn && !fading) return;
    fit();
    if (fading) st.lineAlpha = reduce.matches ? L.LINE.alpha : Math.min(L.LINE.alpha, L.LINE.alpha * (now - pickedAt) / L.LINE.fadeMs);
    const starM = S.starMatrix(sim, place.lat, place.lon), H = S.horizonMatrix(sim, place.lat, place.lon);
    updateBodies(H);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, view = Object.assign({}, st);
    let moonDraw = null;
    if (moonState.h[2] > -0.01) {
      const a = r.project(moonState.h, view, cw, ch);
      if (a) {
        const toward = moonState.h.map((x, i) => x + 0.03 * (sunH[i] - x)), b = r.project(toward, view, cw, ch);
        const angle = b ? Math.atan2(-(b.y - a.y), b.x - a.x) : 0;
        moonDraw = { clip: a.clip, size: 40 * dprCap() * Math.sqrt(st.zoom), k: moonState.M.illum, angle };
      }
    }
    // 流れ星の頭と尾（地平座標の大円の上を動く）を画面へ
    let met = null;
    if (meteorDraw) {
      const k = (now - meteorDraw.t0) / meteorDraw.dur, head = Math.min(1, k * 1.15), tail = Math.max(0, k * 1.15 - 0.6);
      const at = (u) => { const a = meteorDraw.ang * u, v = meteorDraw.p.map((x, i) => x * Math.cos(a) + meteorDraw.q[i] * Math.sin(a)); return v[2] > 0 ? r.project(v, view, cw, ch) : null; };
      const A = at(tail), B = at(head);
      if (A && B) met = { a: A.clip, b: B.clip, w: 2.6 * dprCap(), alpha: Math.sin(Math.PI * Math.min(1, k)) * 0.95 };
    }
    const moonUp = moonState.h[2] > 0 ? moonState.M.illum : 0;
    r.draw({ starM, H, az: st.az, alt: st.alt, zoom: st.zoom, fovDeg: st.fovDeg, dpr: dprCap(), time: twinkleOn ? now / 1000 : 0,
      twinkle: twinkleOn ? 1 : 0, limit: Math.min(st.limit, -1.5 + (st.limit + 1.5) * ease), twilight: L.twilightWeight(sim, place.lat, place.lon),
      dusk: 1 - ease, milky: st.stage === 'full' ? (1 - 0.65 * moonUp) * ease : 0, noise: true, hills: true,   // 4 等までに絞った段階では天の川も描かない（画素ごとの計算が重いので）
      moon: moonDraw, lineAlpha: picked ? st.lineAlpha : 0, allLines: st.allLines ? L.LINES_ALL_ALPHA : 0, meteor: met });
    // 星座の名前（星座線を全部出しているとき）
    if (st.allLines) conLabels.forEach((o) => {
      const h = S.apply(starM, o.v), p = h[2] > 0.03 ? r.project(h, view, cw, ch) : null;
      if (p && p.x > 0 && p.x < cw && p.y > 0 && p.y < ch && !(picked && picked.con === o.c)) { o.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`; o.el.hidden = false; } else o.el.hidden = true;
    });
    // 方位
    dirs.forEach((el, i) => {
      const az = i * Math.PI / 2, p = r.project([Math.sin(az), Math.cos(az), 0], view, cw, ch);
      if (p && p.x > -40 && p.x < cw + 40 && p.y > -40 && p.y < ch + 40) { el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.hidden = false; } else el.hidden = true;
    });
    // 選んだ星の名前
    if (picked) {
      const h = picked.body ? picked.hz(H) : S.apply(starM, picked.v), p = h[2] > 0 ? r.project(h, view, cw, ch) : null;
      if (p) { label.style.transform = `translate(${p.x}px, ${p.y}px)`; label.hidden = false; } else label.hidden = true;
    }
    updateClock();
    dirty = false;
  }

  /* ---------------- 演出・流れ星・星座線 ---------------- */
  let introStart = reduce.matches ? null : -1;   // 最初のフレームで時刻を入れる
  let meteor = null, nextMeteor = 0, tonightPeak = false, forcedDur = 0;
  function spawnMeteor(now) {
    // 見ている向きのあたり・高度 25〜70° のどこかから、ランダムな向きに 8〜18° 流れる
    const M = L.METEOR, rnd = Math.random;
    const alt = (M.minAlt + rnd() * 45) * DEG, az = st.az + (rnd() - 0.5) * 1.6;   // 見ている向きのあたり
    const p = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
    let t = [rnd() - 0.5, rnd() - 0.5, -0.3 - rnd() * 0.5];         // 下向きぎみ
    const d = t[0] * p[0] + t[1] * p[1] + t[2] * p[2]; t = t.map((x, i) => x - d * p[i]);
    const n = Math.hypot(...t), q = t.map((x) => x / n);
    const dur = forcedDur || (M.durMs[0] + rnd() * (M.durMs[1] - M.durMs[0])); forcedDur = 0;
    return { t0: now, p, q, ang: (M.lenDeg[0] + rnd() * (M.lenDeg[1] - M.lenDeg[0])) * DEG, dur };
  }
  const conLabels = CONS.map((c) => {
    let v = [0, 0, 0]; c.ss.forEach((s) => { const u = S.vec(s[0] * 15 * DEG, s[1] * DEG); v = v.map((x, i) => x + u[i]); });
    const n = Math.hypot(...v), el = document.createElement('span'); el.className = 'conname'; el.textContent = EN ? c.en : c.jp; el.hidden = true;
    $('cons').appendChild(el);
    return { v: v.map((x) => x / n), el, c };
  });
  const allSegs = [];
  CONS.forEach((c) => c.ln.forEach(([a, b]) => allSegs.push([c.ss[a], c.ss[b]].map((s) => S.vec(s[0] * 15 * DEG, s[1] * DEG)))));
  $('lines').addEventListener('click', () => {
    st.allLines = !st.allLines; dirty = true;
    r.setLines(st.allLines ? allSegs : null, 'all');
    $('lines').setAttribute('aria-pressed', String(st.allLines));
    if (!st.allLines) conLabels.forEach((o) => { o.el.hidden = true; });
    window.__night.allLines = st.allLines;
  });

  function showLight() {
    const box = $('slow'); if (box) box.hidden = false;
    if (window.__night) window.__night.stage = 'light';
  }

  /* ---------------- 操作 ---------------- */
  const ptrs = new Map(); let pinch0 = 0, zoom0 = 1, down = null;
  const k = () => st.zoom / Math.tan(st.fovDeg * Math.PI / 720) * Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = st.zoom; down = null; } else down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) st.zoom = Math.max(L.ZOOM.min, Math.min(L.ZOOM.max, zoom0 * d / pinch0));
    } else {
      const dx = cur.x - prev.x, dy = cur.y - prev.y, f = 2 / k();
      st.az = (st.az - dx * f + 2 * Math.PI) % (2 * Math.PI);
      st.alt = Math.max(-5 * DEG, Math.min(89 * DEG, st.alt + dy * f));
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    }
    dirty = true;
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (down && down.moved < 8 && performance.now() - down.t < 600) pickAt(e.clientX, e.clientY);
    down = null; if (ptrs.size < 2) pinch0 = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); down = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = Math.max(L.ZOOM.min, Math.min(L.ZOOM.max, st.zoom * Math.exp(-e.deltaY / 500))); dirty = true; }, { passive: false });

  /** タップした所にいちばん近い星・惑星・月（28 px 以内） */
  function pickAt(x, y) {
    const starM = S.starMatrix(sim, place.lat, place.lon), H = S.horizonMatrix(sim, place.lat, place.lon), cw = canvas.clientWidth, ch = canvas.clientHeight;
    let best = null, bd = 28;
    const consider = (h, item) => { if (h[2] <= 0) return; const p = r.project(h, st, cw, ch); if (!p) return; const d = Math.hypot(p.x - x, p.y - y) - (item.mag < 1.5 ? 6 : 0); if (d < bd) { bd = d; best = item; } };
    picks.forEach((s) => { if (s.mag <= st.limit) consider(S.apply(starM, s.v), s); });
    const prec = precessor(sim);
    PLANET_IDS.forEach((id) => { const p = planet(id, sim, prec); consider(S.apply(H, S.vec(p.ra, p.dec)), { body: id, mag: p.mag, hz: (HH) => { const q = planet(id, sim, precessor(sim)); return S.apply(HH, S.vec(q.ra, q.dec)); } }); });
    const M = moon(sim); consider(S.apply(H, S.vec(M.ra, M.dec)), { body: 'moon', mag: -10, hz: (HH) => { const q = moon(sim); return S.apply(HH, S.vec(q.ra, q.dec)); } });
    select(best);
  }
  function select(item) {
    picked = item; pickedAt = performance.now(); st.lineAlpha = 0; dirty = true;
    if (!item) { label.hidden = true; r.setLines(null); window.__night.picked = null; return; }
    let text;
    if (item.body) text = EN ? BODY_INFO[item.body].en : BODY_INFO[item.body].jp;
    else if (item.con) { const cn = EN ? item.con.en : item.con.jp; text = item.name ? `${item.name} · ${cn}` : cn; }
    else text = item.name + (item.lone ? ` · ${item.lone}` : '');
    label.textContent = text;
    r.setLines(item.con ? item.con.ln.map(([a, b]) => [item.con.ss[a], item.con.ss[b]].map((s) => S.vec(s[0] * 15 * DEG, s[1] * DEG))) : null);
    window.__night.picked = text;
  }

  /* ---------------- ボタン ---------------- */
  const btnPlay = $('play');
  function setPlaying(v) {
    playing = v; lastReal = performance.now(); dirty = true;
    btnPlay.setAttribute('aria-label', v ? T.pause : T.play); btnPlay.dataset.state = v ? 'playing' : 'paused';
    window.__night.playing = v;
  }
  btnPlay.addEventListener('click', () => setPlaying(!playing));
  $('now').addEventListener('click', () => { sim = Date.now(); bodiesAt = -Infinity; dirty = true; shownMin = -1; });
  slider.addEventListener('input', () => { sim = atLocal(sim, place.tz, +slider.value, false); bodiesAt = -Infinity; dirty = true; });
  $('share').addEventListener('click', async () => {
    const url = L.shareUrl(location.origin, EN ? 'en' : 'ja', sim, place.tz, place.lat, place.lon);
    history.replaceState(null, '', L.formatHash(place.lat, place.lon, sim));
    window.__night.shared = url;
    try {
      if (navigator.share) { await navigator.share({ url }); return; }
      await navigator.clipboard.writeText(url); toast(T.copied);
    } catch (e) { /* 取り消し・使えないときは何もしない */ }
  });
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400); }

  // 場所
  const panel = $('places'), list = $('placeList');
  function openPlaces(v) { panel.hidden = !v; $('place').setAttribute('aria-expanded', String(v)); }
  $('place').addEventListener('click', () => openPlaces(panel.hidden));
  $('closePlaces').addEventListener('click', () => openPlaces(false));
  LOCS_EN.forEach((p) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = placeName(p); b.dataset.id = p.id;
    b.addEventListener('click', () => setPlace(p)); list.appendChild(b);
  });
  function setPlace(p) {
    place = p; placeLabel(); openPlaces(false); bodiesAt = -Infinity; dirty = true; shownMin = -1; tonightKey = '';
    window.__night.place = p.id;
  }
  $('geo').addEventListener('click', () => {
    if (!navigator.geolocation) { toast(T.geoFail); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      // 星空には 0.1°（約 10 km）で足りる。丸めた値だけを使い、どこにも送らない
      const lat = Math.round(pos.coords.latitude * 10) / 10, lon = Math.round(pos.coords.longitude * 10) / 10;
      setPlace({ id: 'here', name: T.here, en: T.here, lat, lon, tz: deviceTz() });
    }, () => toast(T.geoFail), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  // 動きを減らす設定が途中で変わったら、止める
  if (reduce.addEventListener) reduce.addEventListener('change', () => { if (reduce.matches) setPlaying(false); dirty = true; });

  window.__night = { stage: 'full', fps: [], playing, picked: null, place: place.id, get sim() { return sim; }, get limit() { return st.limit; },
    allLines: false, intro: () => introStart == null, meteor: () => !!meteor, forceMeteor: (dur) => { nextMeteor = 0; forcedDur = dur || 0; },   // 確かめ用（dur ミリ秒の長い流れ星）
    reduce: reduce.matches, select: (x, y) => pickAt(x, y), view: st,
    // 確かめ用（tools/check-k132.cjs）: 名前の付いた星の画面上の位置（CSS px）。見えなければ null
    where: (name) => {
      const s = picks.find((x) => x.name === name); if (!s) return null;
      const h = S.apply(S.starMatrix(sim, place.lat, place.lon), s.v);
      return h[2] > 0 ? r.project(h, st, canvas.clientWidth, canvas.clientHeight) : null;
    } };
  setPlaying(playing);
  placeLabel();
  addEventListener('resize', () => { dirty = true; });
  requestAnimationFrame((t) => {
    lastReal = t; if (introStart === -1) introStart = t; nextMeteor = t + (4 + Math.random() * 8) * 1000;
    frame(t); document.documentElement.dataset.ready = '1';
  });
})();
