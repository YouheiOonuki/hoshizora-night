'use strict';
/* タップで出る説明シートの中身（企画書 74: 軽量版にある星座・星・月・惑星の説明を、フル版にも全部）。
   文はすべて軽量版の写し（engine/data.js の CONS・BODY_INFO・MOON_NAMES・STAR_EN・SEASON_*、engine/text.js の TEXT）から取る。ここに説明文は書かない。
   組み立て方は軽量版 main.js の openCon・openStar・openBody・moonSvg・showQuizResult と同じ（見た目の class だけフル版のもの）。
   ブラウザでも Node（テスト）でも読める。返すのは HTML の文字列 */
(function (root) {
  const node = typeof module !== 'undefined';
  const D = node ? require('../engine/data.js') : { CONS, BODY_INFO, MOON_NAMES, STAR_EN, SEASON_KANA, SEASON_EN, CON_EN_EXTRA };
  const TX = node ? require('../engine/text.js') : { TEXT, MONTHS_EN };

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** 軽量版 main.js の bvColor と同じ区切り（シートの小さな点の色） */
  function bvColor(bv) {
    if (bv < -0.05) return '#a8c0ff';
    if (bv < 0.2) return '#d8e2ff';
    if (bv < 0.5) return '#f6f4ff';
    if (bv < 0.9) return '#fff2da';
    if (bv < 1.4) return '#ffd9a4';
    return '#ff9d68';
  }

  /** 言語の文脈。lang: 'ja' | 'en'、kids: ひらがなモード（日本語だけ）。T は軽量版の T と同じ（kana に無い文言は ja） */
  function ctx(lang, kids) {
    const EN = lang === 'en', K = !EN && !!kids;
    const T = (k, ...a) => {
      const v = EN ? TX.TEXT.en[k] : (K && k in TX.TEXT.kana) ? TX.TEXT.kana[k] : TX.TEXT.ja[k];
      return typeof v === 'function' ? v(...a) : v;
    };
    return {
      EN, kids: K, T,
      conLabel: (c) => EN ? c.en : K ? c.kana + 'ざ' : c.jp,
      starLabel: (name) => { const b = String(name).split('（')[0]; return EN ? (D.STAR_EN[b] || b) : K ? b : name; },
      bodyLabel: (info) => EN ? info.en : K ? info.kana : info.jp,
      placeName: (l) => EN ? (l.en || l.name) : K ? (l.kana || l.name) : l.name,
    };
  }

  /** 図鑑のページ（軽量版の zukan/。英語の画面でも日本語のページ） */
  const ZUKAN = '/hoshizora-sanpo/zukan/';

  /** 星座。up: いま地平線の上に半分以上の星があるか */
  function con(c, up, X) {
    const { EN, kids, T } = X;
    const season = EN ? D.SEASON_EN[c.season] : kids ? (D.SEASON_KANA[c.season] || c.season) : c.season;
    const chips = `<span class="chip season">${T('seasonChip', season)}</span>` + (up ? `<span class="chip up">${T('upNow')}</span>` : `<span class="chip">${T('below')}</span>`);
    const named = c.ss.filter((s) => s[4]).slice(0, 4).map((s) => {
      const b = s[4].split('（')[0], col = bvColor(s[3] ?? 0.3);
      return `<div class="star-chip"><span class="dot" style="color:${col};background:${col}"></span>${esc(EN ? D.STAR_EN[b] || b : b)}<small>${T('starMag', s[2].toFixed(1), s[5])}</small></div>`;
    }).join('');
    const story = EN ? `<div class="sh-story">${T('mythNote')}</div>`
      : `<div class="sh-story${kids ? ' kids' : ''}">${kids ? c.kid : c.adl}</div>${kids ? '' : `<div class="sh-fun"><b>${T('funLabel')}</b>　${c.fun}</div>`}`;
    return `<div class="sh-kana">${EN ? T('conKind') : kids ? 'せいざ' : c.kana + 'ざ'}</div>
<div class="sh-name">${X.conLabel(c)}</div>
<div class="sh-en"${EN ? ' lang="ja"' : ''}>${EN ? c.jp : c.en}</div>
<div class="sh-chips">${chips}</div>
${story}
${named ? `<div class="sh-stars">${named}</div>` : ''}
<a class="sh-link" href="${ZUKAN}${c.id}.html"${EN ? ' hreflang="ja"' : ''}>${T('zukanLink', c)}</a>`;
  }

  /** 星。s: { name, mag, bv, ly, con（星座）, conName（星座に入っていない明るい星の星座名） } */
  function star(s, X) {
    const { EN, kids, T } = X;
    const bv = s.bv == null ? 0.3 : s.bv;
    const pct = clamp((bv + 0.4) / 2.2, 0.02, 0.98) * 100;
    const lyTxt = s.ly ? (s.ly < 1000 ? s.ly : Math.round(s.ly / 100) * 100) : 0;
    const conOf = s.con ? X.conLabel(s.con) : EN ? (D.CON_EN_EXTRA[s.conName] || '') : kids ? (s.conName || '').replace('座', 'ざ') : (s.conName || '');
    return `<div class="sh-kana">${T('starKind')}</div>
<div class="sh-name">${esc(X.starLabel(s.name))}</div>
<div class="sh-en">${esc(conOf)}</div>
<div class="sh-chips"><span class="chip">${T('magChip', s.mag.toFixed(1))}</span>${s.ly ? `<span class="chip">${T('lyChip', s.ly)}</span>` : ''}</div>
<div class="sh-story${kids ? ' kids' : ''}">${T('starStory', s.ly ? lyTxt : 0)}</div>
<div class="tempbar"><div class="bar"><span class="mk" style="left:${pct}%"></span></div><div class="lbl"><span>${T('tempHot')}</span><span>${T('tempCool')}</span></div></div>
${s.con ? `<a class="sh-link" href="${ZUKAN}${s.con.id}.html"${EN ? ' hreflang="ja"' : ''}>${T('zukanOfStar', s.con)}</a>` : ''}`;
  }

  function moonName(age, X) { const e = D.MOON_NAMES.find((m) => age < m[0]) || D.MOON_NAMES[0]; return X.EN ? e[3] : X.kids ? e[2] : e[1]; }
  /** 満ち欠けの小さな絵。北半球では満ちていく月の右が光る。南半球では左右が逆（軽量版 moonSvg と同じ） */
  function moonSvg(M, lat, size = 64) {
    const r = size / 2 - 2, c = size / 2, k = M.illum, ex = Math.abs(1 - 2 * k) * r, right = (M.waxing ? 1 : -1) * (lat < 0 ? -1 : 1);
    const sweepOuter = right > 0 ? 1 : 0, sweepInner = (k < 0.5) === (right > 0) ? 0 : 1;
    const d = `M${c} ${c - r} A${r} ${r} 0 0 ${sweepOuter} ${c} ${c + r} A${ex} ${r} 0 0 ${sweepInner} ${c} ${c - r}Z`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="#3a4056"/><path d="${d}" fill="#f4f1e4"/></svg>`;
  }

  /** 太陽・月・惑星。b: { id, up, M（月）, P（惑星: mag, dist） }、lat は場所の緯度（月の絵の左右） */
  function body(b, lat, X) {
    const { EN, kids, T } = X;
    const info = D.BODY_INFO[b.id];
    let chips = '', extra = '';
    if (b.id === 'sun') chips = `<span class="chip warn">${T('sunWarn')}</span><span class="chip">${kids ? 'こうせい' : T('starKind')}</span>`;
    else if (b.id === 'moon') {
      const M = b.M;
      chips = `<span class="chip season">${moonName(M.age, X)}</span><span class="chip">${T('moonAge', M.age)}</span><span class="chip">${T('moonDist', M.distKm)}</span>`;
      extra = `<div class="sh-moon">${moonSvg(M, lat)}<div class="sh-story${kids ? ' kids' : ''}" style="margin:0">${T('moonLit', Math.round(M.illum * 100), M.waxing)}</div></div>`;
    } else {
      chips = `<span class="chip season">${T('planet')}</span><span class="chip">${T('planetMag', b.P.mag.toFixed(1))}</span><span class="chip">${T('planetDist', b.P.dist)}</span>`;
    }
    chips += b.up ? `<span class="chip up">${T('upNow')}</span>` : `<span class="chip">${T('below')}</span>`;
    return `<div class="sh-kana">${b.id === 'moon' ? T('satellite') : b.id === 'sun' ? (kids ? 'こうせい' : T('starKind')) : T('planet')}</div>
<div class="sh-name">${X.bodyLabel(info)}</div>
<div class="sh-en"${EN ? ' lang="ja"' : ''}>${EN ? info.jp : info.en}</div>
<div class="sh-chips">${chips}</div>
${extra}
<div class="sh-story${kids ? ' kids' : ''}">${EN ? info.adlEn : kids ? info.kid : info.adl}</div>
${kids ? '' : `<div class="sh-fun"><b>${T('funLabel')}</b>　${EN ? info.funEn : info.fun}</div>`}`;
  }

  /** クイズの結果（軽量版 showQuizResult と同じ） */
  function quizResult(sc, n, X) {
    const { T, kids } = X;
    const msg = T(sc === n ? 'quizPerfect' : sc >= n * 0.6 ? 'quizGood' : 'quizAgain');
    return `<div class="sh-kana">${T('quizTitle')}</div>
<div class="sh-name">${'★'.repeat(sc)}${'☆'.repeat(n - sc)}</div>
<div class="sh-story${kids ? ' kids' : ''}">${T('quizCount', sc, n)}${msg}</div>`;
  }

  const api = { ctx, con, star, body, moonName, moonSvg, quizResult, bvColor, esc, ZUKAN };
  if (node) module.exports = api; else root.NightInfo = api;
})(typeof window !== 'undefined' ? window : globalThis);
