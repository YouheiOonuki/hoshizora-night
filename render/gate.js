'use strict';
/* WebGL が使えない端末は通常版へ送る（ROADMAP 7.15 の要件 3「通常版へのリンクを出して止まらない」）。
   ・WebGL の有無を確かめ、無ければ通常版のリンクを出してから location.replace で送る
   ・送り先は同じドメインの /hoshizora-sanpo/（英語の画面なら /hoshizora-sanpo/en/）
   ・ブラウザでも Node（テスト）でも読める */
(function (root) {
  const LIGHT = '/hoshizora-sanpo/';
  const LIGHT_EN = '/hoshizora-sanpo/en/';

  /** WebGL を作れるか。canvas は document.createElement('canvas') 相当 */
  function webglOk(canvas) {
    try {
      if (!canvas || typeof canvas.getContext !== 'function') return { ok: false, reason: 'no-canvas' };
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { ok: false, reason: 'no-context' };
      // 点の大きさの上限が 1 しかない実装では星が描けない
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      if (range && range[1] < 2) return { ok: false, reason: 'point-size' };
      return { ok: true, reason: 'ok', gl };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  /** 送り先。lang が en なら英語版 */
  const fallbackUrl = (lang) => (String(lang || '').toLowerCase().startsWith('en') ? LIGHT_EN : LIGHT);

  /**
   * 判定して、だめなら通常版へ送る。戻り値は { ok, reason }（確かめに使った文脈は手放す）
   * env: { document, location }（テストで差し替える）
   */
  function guard(env) {
    const doc = env.document, loc = env.location;
    const res = webglOk(doc.createElement('canvas'));
    if (res.ok) {
      // 確かめるためだけに作った文脈は手放す（iPhone は同時に持てる数が少ない）
      const lose = res.gl.getExtension && res.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { ok: true, reason: 'ok' };
    }
    const url = fallbackUrl(doc.documentElement && doc.documentElement.lang);
    const box = doc.getElementById('nogl');
    if (box) {
      const a = box.querySelector('a');
      if (a) a.setAttribute('href', url);
      box.hidden = false;
    }
    loc.replace(url);
    return res;
  }

  const api = { webglOk, guard, fallbackUrl, LIGHT, LIGHT_EN };
  if (typeof module !== 'undefined') module.exports = api; else root.NightGate = api;
})(typeof window !== 'undefined' ? window : globalThis);
