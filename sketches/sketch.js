'use strict';
/* 試し描きの共通部分（ROADMAP 7.14 の 9(d)。各 1 画面。配色・星の描き方・動き 1 つだけを変える。磨かない）。
   各ページは window.SKETCH = { opts, motion } を置いてからこれを読む。
   motion: 'diurnal'（日周運動）/ 'reveal'（明るい星から順に灯る）/ 'twinkle'（地平近くがまたたく）
   時刻と場所は 3 枚とも同じ（東京、2027-01-15 21:00）。?t=秒 でその瞬間に止める（スクショ用） */
(function () {
  const canvas = document.getElementById('sky');
  if (!NightGate.guard({ document, location }).ok) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  const S = window.SKETCH;
  const r = NightGL.create(gl, NightSky.catalogBuffers(CATALOG), S.opts);
  const TOKYO = { lat: 35.681, lon: 139.767 }, t0 = Date.parse('2027-01-15T21:00:00+09:00');
  const still = new URLSearchParams(location.search).get('t');
  const start = performance.now();
  function frame(now) {
    NightGL.fit(canvas);
    const sec = still != null ? Number(still) : (now - start) / 1000;
    const ms = S.motion === 'diurnal' ? t0 + sec * 86164.1 / 120 * 1000 : t0;   // 1 恒星日を 120 秒で
    const reveal = S.motion === 'reveal' ? Math.min(1, sec / 6) : 1;           // 6 秒で 6 等まで
    r.draw(NightSky.starMatrix(ms, TOKYO.lat, TOKYO.lon), S.motion === 'twinkle' ? sec : 0, reveal);
    if (still == null) requestAnimationFrame(frame); else document.documentElement.dataset.ready = '1';
  }
  requestAnimationFrame(frame);
})();
