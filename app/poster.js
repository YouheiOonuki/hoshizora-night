'use strict';
/* K43 生まれた日の星空ポスター（企画書 72）の画面。
   ・空はフル版の描画器（render/night-gl.js）を大きな canvas に向けて描く。星の位置は render/sky.js の行列（engine/ の写し）。計算と星表を別に持たない
   ・割り付け・PDF・PNG は render/poster.js
   ・入力（日付・時刻・場所）と文字（題名など）は端末の外に出さない。URL にも保存（localStorage）にも書かない。# は読むだけ（#lat,lon,unixtime。フル版の共有と同じ形） */
(function () {
  const L = window.NightLook, S = window.NightSky, R = window.NightRender, PO = window.NightPoster, P = window.NightPrefs.PREFS;
  const $ = (id) => document.getElementById(id);

  const probe = window.NightGate.webglOk(document.createElement('canvas'));
  if (!probe.ok) { $('nogl').hidden = false; $('form').hidden = true; return; }
  const lose = probe.gl.getExtension && probe.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();

  /* ---------------- 星（フル版の画面と同じ組み立て） ---------------- */
  const stars = [];
  const pushCat = (C) => { for (let i = 0; i < C.length; i += 4) stars.push({ v: S.vec(C[i] / 1000 * 15 * DEG, C[i + 1] / 100 * DEG), mag: C[i + 2] / 100, bv: C[i + 3] / 100 }); };
  pushCat(CATALOG); pushCat(window.CATALOG_EXTRA || []);
  const allSegs = [];
  CONS.forEach((c) => c.ln.forEach(([a, b]) => allSegs.push([c.ss[a], c.ss[b]].map((s) => S.vec(s[0] * 15 * DEG, s[1] * DEG)))));
  const conCenters = CONS.map((c) => {
    let v = [0, 0, 0]; c.ss.forEach((s) => { const u = S.vec(s[0] * 15 * DEG, s[1] * DEG); v = v.map((x, i) => x + u[i]); });
    const n = Math.hypot(...v); return { v: v.map((x) => x / n), name: c.jp };
  });
  const named = [];   // 確かめ用: 名前の付いた星
  CONS.forEach((c) => c.ss.forEach((s) => { if (s[4]) named.push({ name: s[4].split('（')[0], v: S.vec(s[0] * 15 * DEG, s[1] * DEG), mag: s[2] }); }));

  const glc = document.createElement('canvas');
  let r;
  try { r = R.create(glc, stars, MW, { preserve: true }); } catch (e) { $('nogl').hidden = false; $('form').hidden = true; return; }
  const gl = r.gl;
  const MAX_D = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], gl.getParameter(gl.MAX_TEXTURE_SIZE));
  r.setLines(allSegs, 'all');

  /* ---------------- 入力 ---------------- */
  const sel = $('place');
  P.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
  const optC = document.createElement('option'); optC.value = 'custom'; optC.textContent = '緯度・経度で入れる'; sel.appendChild(optC);
  sel.value = 'pref-13';

  function todayJst() { return PO.msToLocal(Date.now(), 9).date; }
  $('date').value = todayJst(); $('time').value = '21:00';
  // # で開いた（フル版の共有と同じ #lat,lon,unixtime）。読むだけで、書き換えない
  const shared = L.parseHash(location.hash);
  if (shared) {
    const near = P.find((p) => Math.abs(p.lat - shared.lat) < 0.006 && Math.abs(p.lon - shared.lon) < 0.006);
    if (near) sel.value = near.id; else { sel.value = 'custom'; $('lat').value = shared.lat; $('lon').value = shared.lon; }
    const l = PO.msToLocal(shared.ms, +$('tz').value || 9); $('date').value = l.date; $('time').value = l.time;
  }

  function state() {
    const custom = sel.value === 'custom';
    $('customBox').hidden = !custom;
    const pref = P.find((p) => p.id === sel.value) || P.find((p) => p.id === 'pref-13');
    const lat = custom ? Math.max(-90, Math.min(90, parseFloat($('lat').value))) : pref.lat;
    const lon = custom ? Math.max(-180, Math.min(180, parseFloat($('lon').value))) : pref.lon;
    const tz = custom ? (parseFloat($('tz').value) || 0) : 9;
    const ms = PO.localToMs($('date').value, $('time').value, tz);
    const paper = (document.querySelector('input[name=paper]:checked') || {}).value || 'A4';
    const ok = Number.isFinite(ms) && Number.isFinite(lat) && Number.isFinite(lon);
    const def = ok ? PO.defaultLines(ms, tz, custom ? '' : pref.name, lat, lon) : { date: '', place: '' };
    $('dateLine').placeholder = def.date; $('placeLine').placeholder = def.place;
    return {
      ok, ms, lat, lon, tz, paper,
      dpi: +$('dpi').value, marginMm: +$('margin').value, bleed: $('bleed').checked, theme: $('theme').value, font: $('font').value,
      lines: $('lines').checked, names: $('names').checked, dirs: $('dirs').checked, credit: $('credit').checked,
      title: $('title').value.trim(), dateLine: $('dateLine').value.trim() || def.date, placeLine: $('placeLine').value.trim() || def.place,
    };
  }

  /* ---------------- 空を描く（描画器そのもの） ---------------- */
  const THEMES = {
    navy: { bg: '#060b1f', ring: 'rgba(160,185,235,.55)', ink: '#e4eaf7', sub: '#a3b1cf', dir: '#a3b1cf', con: 'rgba(175,198,255,.75)', planet: '#f1e3c0' },
    white: { bg: '#ffffff', ring: '#1b2a52', ink: '#141a2e', sub: '#4a5470', dir: '#4a5470', con: 'rgba(175,198,255,.75)', planet: '#f1e3c0' },
  };
  const FONTS = {
    mincho: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", serif',
    gothic: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", Meiryo, sans-serif',
  };

  /** 直径 D px の空を描いて { canvas, D, labels } を返す。labels は空の円の中の座標（0〜D） */
  function renderSky(s, D) {
    D = Math.min(D, MAX_D);
    glc.width = D; glc.height = D;
    D = Math.min(gl.drawingBufferWidth, gl.drawingBufferHeight);   // 端末が小さく作ったときはその大きさ
    const starM = S.starMatrix(s.ms, s.lat, s.lon), H = S.horizonMatrix(s.ms, s.lat, s.lon), prec = precessor(s.ms);
    const bodies = PLANET_IDS.map((id) => { const p = planet(id, s.ms, prec); return { id, v: S.vec(p.ra, p.dec), mag: p.mag, color: L.starColor(0.4).map((x, i) => (x + L.hex(BODY_INFO[id].col)[i]) / 2) }; });
    r.setBodies(bodies);
    const view = Object.assign({}, PO.VIEW), dpr = D / PO.REF_D;
    const M = moon(s.ms), Sn = sun(s.ms), mh = S.apply(H, S.vec(M.ra, M.dec)), sh = S.apply(H, S.vec(Sn.ra, Sn.dec));
    let moonDraw = null;
    if (mh[2] > -0.01) {
      const a = r.project(mh, view, D, D), toward = mh.map((x, i) => x + 0.03 * (sh[i] - x)), b = r.project(toward, view, D, D);
      if (a) moonDraw = { clip: a.clip, size: Math.min(D * 0.04, 500), k: M.illum, angle: b ? Math.atan2(-(b.y - a.y), b.x - a.x) : 0 };
    }
    const moonUp = mh[2] > 0 ? M.illum : 0;
    r.draw({ starM, H, az: view.az, alt: view.alt, zoom: view.zoom, fovDeg: view.fovDeg, dpr, time: 0, twinkle: 0, limit: L.STAR_LIMIT + 0.1,
      twilight: 0, dusk: 0, milky: 1 - 0.65 * moonUp, noise: true, hills: false, moon: moonDraw, lineAlpha: 0, allLines: s.lines ? L.LINES_ALL_ALPHA : 0, meteor: null });
    const c = { cx: D / 2, cy: D / 2, d: D };
    const labels = [];
    if (s.names) {
      conCenters.forEach((o) => { const h = S.apply(starM, o.v); if (h[2] > 0.05) labels.push(Object.assign({ text: o.name, kind: 'con' }, PO.skyXY(h, c))); });
      bodies.forEach((b) => { const h = S.apply(H, b.v); if (h[2] > 0.02) labels.push(Object.assign({ text: BODY_INFO[b.id].jp, kind: 'planet' }, PO.skyXY(h, c))); });
      if (mh[2] > 0.02) labels.push(Object.assign({ text: '月', kind: 'planet' }, PO.skyXY(mh, c)));
    }
    return { canvas: glc, D, labels, sunAlt: Math.asin(Math.max(-1, Math.min(1, sh[2]))) / DEG };
  }

  /** ページ全体（または帯 band）を 2D の ctx に描く */
  function compose(ctx, lay, s, sky, band) {
    const T = THEMES[s.theme] || THEMES.navy, F = FONTS[s.font] || FONTS.mincho, c = lay.circle;
    ctx.save();
    ctx.translate(0, -(band ? band.y : 0));
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, lay.pageW, lay.pageH);
    // 空の円（描画器の絵を円で切り抜く）
    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.d / 2, 0, Math.PI * 2); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sky.canvas, 0, 0, sky.D, sky.D, c.cx - c.d / 2, c.cy - c.d / 2, c.d, c.d);
    // 星座名・惑星名（描画器の外で、同じ射影の座標に）
    const k = c.d / sky.D;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const lb of sky.labels) {
      const big = lb.kind === 'planet';
      ctx.font = `${Math.round(lay.size.con * (big ? 1.05 : 1))}px ${FONTS.gothic}`;
      ctx.fillStyle = big ? T.planet : T.con;
      const x = c.cx - c.d / 2 + lb.x * k, y = c.cy - c.d / 2 + lb.y * k + (big ? lay.size.con * 1.3 : 0);
      ctx.fillText(lb.text, x, y);
    }
    ctx.restore();
    // 縁
    ctx.strokeStyle = T.ring; ctx.lineWidth = Math.max(1, c.d * 0.0018);
    ctx.beginPath(); ctx.arc(c.cx, c.cy, c.d / 2 + c.gap * 0.18, 0, Math.PI * 2); ctx.stroke();
    // 方位（見上げた空なので 北が上・東が左）
    if (s.dirs) {
      ctx.fillStyle = T.dir; ctx.font = `${Math.round(lay.size.dir)}px ${F}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const o = c.d / 2 + c.gap * 0.62;
      [['北', 0, -o], ['南', 0, o], ['東', -o, 0], ['西', o, 0]].forEach(([t, x, y]) => ctx.fillText(t, c.cx + x, c.cy + y));
    }
    // 文字（利用者が入れたもの）
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const fit = (text, px, weight) => { let f = px; ctx.font = `${weight} ${Math.round(f)}px ${F}`; while (f > 4 && ctx.measureText(text).width > lay.trimW * 0.86) { f *= 0.94; ctx.font = `${weight} ${Math.round(f)}px ${F}`; } };
    const cx = lay.trimX + lay.trimW / 2;
    if (s.title) { ctx.fillStyle = T.ink; fit(s.title, lay.size.title, 500); ctx.fillText(s.title, cx, lay.text.title); }
    if (s.dateLine) { ctx.fillStyle = T.ink; fit(s.dateLine, lay.size.date, 400); ctx.fillText(s.dateLine, cx, lay.text.date); }
    if (s.placeLine) { ctx.fillStyle = T.sub; fit(s.placeLine, lay.size.place, 400); ctx.fillText(s.placeLine, cx, lay.text.place); }
    if (s.credit) {
      ctx.fillStyle = T.sub; ctx.globalAlpha = 0.8; ctx.font = `${Math.round(lay.size.credit)}px ${FONTS.gothic}`;
      ctx.fillText('星の位置: Yale Bright Star Catalogue ・ yorozu-craft.com/hoshizora-night/poster/', cx, lay.text.credit);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------------- 見本 ---------------- */
  const prev = $('preview'), status = $('status');
  let pending = 0;
  function preview() {
    pending = 0;
    const s = state();
    if (!s.ok) { status.textContent = '日付・時刻・場所を入れてください'; return; }
    const P0 = PO.PAPERS[s.paper];
    const cssW = Math.min(prev.parentElement.clientWidth || 360, 520), dprS = Math.min(window.devicePixelRatio || 1, 2);
    const lay = PO.layout(Object.assign({}, s, { dpi: cssW * dprS / ((P0.w + (s.bleed ? 2 * PO.BLEED_MM : 0)) / 25.4) }));
    prev.width = lay.pageW; prev.height = lay.pageH;
    prev.style.width = `${cssW}px`; prev.style.aspectRatio = `${lay.pageW} / ${lay.pageH}`;
    const sky = renderSky(s, Math.round(lay.circle.d));
    compose(prev.getContext('2d'), lay, s, sky, null);
    const full = PO.layout(s), eff = effectiveDpi(full);
    status.textContent = `${s.paper}・${eff} dpi（${full.pageW.toLocaleString()} × ${full.pageH.toLocaleString()} px${s.bleed ? '・塗り足し 3 mm 込み' : ''}）`;
    $('dpiWarn').hidden = eff >= s.dpi;
    $('dayNote').hidden = sky.sunAlt < -6;
    window.__poster.last = { s, lay, eff };
  }
  function effectiveDpi(lay) { return lay.circle.d <= MAX_D ? lay.dpi : Math.floor(lay.dpi * MAX_D / lay.circle.d); }
  const schedule = () => { if (!pending) pending = requestAnimationFrame(preview); };
  $('form').addEventListener('input', schedule);
  $('form').addEventListener('change', schedule);
  addEventListener('resize', schedule);

  /* ---------------- 書き出し ---------------- */
  const toBlob = (cv, type, q) => new Promise((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error('toBlob'))), type, q));
  const bytes = async (b) => new Uint8Array(await b.arrayBuffer());
  /** 本番の解像度で帯ごとに描いて、帯の canvas を順に渡す */
  async function renderFull(s, each) {
    const lay = PO.layout(s), sky = renderSky(s, Math.round(lay.circle.d));
    for (const band of PO.bands(lay.pageW, lay.pageH)) {
      const cv = document.createElement('canvas'); cv.width = lay.pageW; cv.height = band.h;
      compose(cv.getContext('2d'), lay, s, sky, band);
      await each(cv, band, lay);
      cv.width = cv.height = 1;   // すぐ手放す（iPhone のメモリ）
    }
    return { lay, sky };
  }
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const fileBase = (s) => `hoshizora-poster-${s.paper}-${s.dpi}dpi${s.bleed ? '-bleed' : ''}`;
  async function busy(btn, fn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = '作っています…';
    try { await fn(); } catch (e) { status.textContent = 'この端末では作れませんでした。紙を小さくするか、解像度を 300 dpi にしてください'; window.__poster.error = String(e); }
    btn.disabled = false; btn.textContent = label;
  }
  async function makePdf() {
    const s = state(); if (!s.ok) return null;
    const imgs = [];
    const { lay } = await renderFull(s, async (cv, band, lay2) => {
      imgs.push({ data: await bytes(await toBlob(cv, 'image/jpeg', 0.92)), pxW: lay2.pageW, pxH: band.h, band });
    });
    const W = lay.pt.w, Hh = lay.pt.h;
    const images = imgs.map((im) => ({ data: im.data, pxW: im.pxW, pxH: im.pxH, x: 0, dw: W, dh: im.band.h / lay.pageH * Hh, y: Hh - (im.band.y + im.band.h) / lay.pageH * Hh }));
    const pdf = PO.buildPdf({ w: W, h: Hh, trim: s.bleed ? lay.pt.trim : null, images });
    return { blob: new Blob([pdf], { type: 'application/pdf' }), name: `${fileBase(s)}.pdf`, lay };
  }
  async function makePng() {
    const s = state(); if (!s.ok) return null;
    const lay = PO.layout(s), whole = document.createElement('canvas'); whole.width = lay.pageW; whole.height = lay.pageH;
    const ctx = whole.getContext('2d');
    await renderFull(s, async (cv, band) => { ctx.drawImage(cv, 0, band.y); });
    const png = PO.pngWithDpi(await bytes(await toBlob(whole, 'image/png')), effectiveDpi(lay));
    whole.width = whole.height = 1;
    return { blob: new Blob([png], { type: 'image/png' }), name: `${fileBase(s)}.png`, lay };
  }
  const done = (o) => { if (!o) return; save(o.blob, o.name); status.textContent += `　→ ${o.name.split('.').pop().toUpperCase()} ${(o.blob.size / 1e6).toFixed(1)} MB`; };
  $('pdf').addEventListener('click', (e) => busy(e.currentTarget, async () => done(await makePdf())));
  $('barPdf').addEventListener('click', () => $('pdf').click());
  $('png').addEventListener('click', (e) => busy(e.currentTarget, async () => done(await makePng())));

  // 主なボタンが画面から外れたら、上に固定のバーを出す（SCREEN 1.2 の 4）
  const bar = $('bar');
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { bar.hidden = e.isIntersecting || e.boundingClientRect.top > 0; }).observe($('pdf'));

  /* ---------------- 確かめ用（tools/check-k43.cjs） ---------------- */
  window.__poster = {
    maxD: MAX_D, makePdf, makePng, state,
    /** 名前の付いた星の、ページ上の位置（px。いまの設定・dpi のとき）。地平線の下なら null */
    where(name, dpi) {
      const s = state(), lay = PO.layout(Object.assign({}, s, dpi ? { dpi } : {})), st = named.find((x) => x.name === name); if (!st) return null;
      const h = S.apply(S.starMatrix(s.ms, s.lat, s.lon), st.v), p = PO.skyXY(h, lay.circle);
      return p.visible ? { x: p.x, y: p.y, alt: Math.asin(h[2]) / DEG } : null;
    },
    named: () => named.map((x) => x.name),
  };
  preview();
  document.documentElement.dataset.ready = '1';
})();
