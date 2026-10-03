// フル版のページを 1 つのひな形から作る（手で 26 枚を直さないため）。
//   node tools/build-pages.mjs           index.html・en/index.html・m/01〜12/・en/m/01〜12/・poster/（K43）・sitemap.xml を書く
//   node tools/build-pages.mjs --check   書いてあるものと 1 バイトでも違えば終了コード 1（tests/pages.test.js も同じことを見る）
// m/MM/ は「この空を共有」の URL（OG 画像がその月のもの。ROADMAP 7.15.1 の 8）。中身は入口と同じ画面で、検索には出さない（canonical は入口）
// 画面の文字列は render/look.js の TEXT から入れる（英語の語数を 1 か所で数えるため）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require('../render/look.js');
const OG = JSON.parse(fs.readFileSync(path.join(ROOT, 'og', 'og.json'), 'utf8'));

export const SITE = 'https://yorozu-craft.com';
export const BASE = `${SITE}/hoshizora-night/`;
export const PUBLISHED = '2026-10-03';
export const POSTER_PUBLISHED = '2026-10-03';
const BEACON = `<!-- Cloudflare Web Analytics（Cookie を使わないアクセス解析） --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "b79bf821e1fd4b6683866d493b1de426"}'></script><!-- End Cloudflare Web Analytics -->`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const META = {
  ja: {
    title: 'ほしぞらさんぽ フル版｜今夜の星空を大きな画面で｜yorozu-craft',
    desc: '星空さんぽと同じ計算で、今夜の星空を濃紺の空とにじむ星の光で描きます。時間が流れ、星がゆっくり動きます。広告なし・登録なし。',
    monthTitle: (m) => `ほしぞらさんぽ フル版｜${m}月の星空`,
    locale: 'ja_JP',
  },
  en: {
    title: 'Night Sky Tonight, Full Version | yorozu-craft',
    desc: 'Tonight’s sky for your place, drawn large: a deep blue sky, softly glowing stars and the slow turn of the night. Same calculations as the light version. No ads, no sign-up.',
    monthTitle: (m) => `Night Sky Tonight, Full Version: the sky in ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]}`,
    locale: 'en_US',
  },
};

const LINES_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-8 6 3 5-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="4" cy="18" r="1.8"/><circle cx="9" cy="10" r="1.8"/><circle cx="15" cy="13" r="1.8"/><circle cx="20" cy="4" r="1.8"/></svg>';
const PLAY_SVG = '<svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

/** 1 ページ。lang: ja/en、month: null（入口）か 1〜12 */
export function page(lang, month) {
  const en = lang === 'en', T = L.TEXT[lang], M = META[lang];
  const self = `${BASE}${en ? 'en/' : ''}${month ? `m/${String(month).padStart(2, '0')}/` : ''}`;
  const canonical = `${BASE}${en ? 'en/' : ''}`;
  const og = month ? OG.months[month - 1] : OG.months[OG.entryMonth - 1];
  const title = month ? M.monthTitle(month) : M.title;
  const light = en ? '/hoshizora-sanpo/en/' : '/hoshizora-sanpo/';
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: en ? 'Night Sky Tonight, Full Version' : 'ほしぞらさんぽ フル版',
    url: canonical, applicationCategory: 'EducationalApplication', operatingSystem: 'Any', inLanguage: lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' }, description: M.desc,
  };
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(M.desc)}">
<!-- 生成物: tools/build-pages.mjs から作る。手で編集しない -->
<meta name="robots" content="${month ? 'noindex, follow' : 'index, follow'}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${BASE}">
<link rel="alternate" hreflang="en" href="${BASE}en/">
<link rel="alternate" hreflang="x-default" href="${BASE}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(M.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${self}">
<meta property="og:locale" content="${M.locale}">
<meta property="og:image" content="${BASE}${og.file}">
<meta property="og:image:width" content="${OG.width}">
<meta property="og:image:height" content="${OG.height}">
<meta property="og:image:alt" content="${esc(en ? og.altEn : og.alt)}">
<meta property="og:site_name" content="yorozu-craft">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#050a1e">
<!-- Google AdSense: フル版は広告なし（ROADMAP 7.15 の要件 2・7.15.1 の 10）。サイト所有確認の meta だけ（D118） -->
<meta name="google-adsense-account" content="ca-pub-5375267956079717">
<link rel="icon" href="/hoshizora-night/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/hoshizora-night/apple-touch-icon.png">
<link rel="stylesheet" href="/hoshizora-night/night.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body class="app">
<canvas id="sky"></canvas>
<div id="cons" class="cons" aria-hidden="true"></div>
<div id="dirs" class="dirs" aria-hidden="true">${T.dirs.map((d) => `<span>${d}</span>`).join('')}</div>
<p id="pick" class="pick" hidden></p>
<header class="hud">
  <p class="clock"><span id="date"></span><span id="time"></span></p>
  <button id="place" type="button" class="chip" aria-expanded="false" aria-controls="places"></button>
  <span id="placeSub" class="placesub" hidden></span>
</header>
<ul id="tonight" class="tonight"></ul>
<div class="bar">
  <input id="slider" type="range" min="0" max="1439" step="1" value="1260" aria-label="${T.time}">
  <div class="btns">
    <button id="play" type="button" class="icon" aria-label="${T.pause}">${PLAY_SVG}</button>
    <button id="now" type="button">${T.now}</button>
    <button id="share" type="button">${T.share}</button>
    <button id="lines" type="button" class="icon" aria-pressed="false" aria-label="${T.lines}">${LINES_SVG}</button>
    <a id="light" href="${light}">${T.light}</a>
  </div>
</div>
<div id="places" class="panel" role="dialog" aria-labelledby="place" hidden>
  <div class="panel-top"><button id="geo" type="button">${T.here}</button><button id="closePlaces" type="button" class="icon" aria-label="${T.close}">×</button></div>
  <div id="placeList" class="list"></div>
  <p class="links"><a href="${en ? '/en/about.html' : '/about.html'}">${T.about}</a> · <a href="${en ? '/en/privacy-policy.html' : '/privacy-policy.html'}">${T.privacy}</a> · <a href="${en ? '/hoshizora-sanpo/en/guide.html' : '/hoshizora-sanpo/about.html'}">${T.guide}</a> · ${en ? '<a href="/hoshizora-night/" hreflang="ja" lang="ja">日本語</a>' : '<a href="/hoshizora-night/poster/">星空ポスター</a> · <a href="/hoshizora-night/en/" hreflang="en" lang="en">English</a>'}</p>
</div>
<p id="toast" class="toast" role="status" hidden></p>
<p id="slow" class="slow" hidden><a href="${light}">${T.light}</a></p>
<p id="nogl" class="nogl" hidden><a href="${light}">${T.light}</a></p>
<script src="/hoshizora-night/render/gate.js"></script>
<script src="/hoshizora-night/engine/astro.js"></script>
<script src="/hoshizora-night/engine/catalog.js"></script>
<script src="/hoshizora-night/engine/data.js"></script>
<script>window.module = { exports: {} };</script>
<script src="/hoshizora-night/engine/official-events.js"></script>
<script>window.NightEvents = window.module.exports; delete window.module;</script>
<script src="/hoshizora-night/render/sky.js"></script>
<script src="/hoshizora-night/render/look.js"></script>
<script src="/hoshizora-night/render/catalog-extra.js"></script>
<script src="/hoshizora-night/render/prefectures.js"></script>
<script src="/hoshizora-night/render/night-gl.js"></script>
<script src="/hoshizora-night/app/night.js"></script>
${BEACON}
</body>
</html>
`;
}

/* ---------- K43 生まれた日の星空ポスター（企画書 72）。日本語だけ。設定 → 出力（SCREEN 1.2） ---------- */
export const POSTER = {
  title: '生まれた日の星空ポスター｜日付と場所の星空を印刷用 PDF に｜yorozu-craft',
  desc: '生まれた日や記念日の日付・時刻・場所の星空を、A4・A3・B5 の印刷用 PDF と PNG（300・350 dpi）にします。星の位置は星空さんぽと同じ計算。無料・広告なし・登録なし、入力は端末の外に出ません。',
  url: `${BASE}poster/`,
};
export function posterPage() {
  const ld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: '生まれた日の星空ポスター', url: POSTER.url, applicationCategory: 'DesignApplication',
    operatingSystem: 'Any', inLanguage: 'ja', offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' }, description: POSTER.desc };
  const opt = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(POSTER.title)}</title>
<meta name="description" content="${esc(POSTER.desc)}">
<!-- 生成物: tools/build-pages.mjs から作る。手で編集しない -->
<meta name="robots" content="index, follow">
<link rel="canonical" href="${POSTER.url}">
<meta property="og:title" content="${esc(POSTER.title)}">
<meta property="og:description" content="${esc(POSTER.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${POSTER.url}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${BASE}${OG.months[OG.entryMonth - 1].file}">
<meta property="og:image:width" content="${OG.width}">
<meta property="og:image:height" content="${OG.height}">
<meta property="og:image:alt" content="${esc(OG.months[OG.entryMonth - 1].alt)}">
<meta property="og:site_name" content="yorozu-craft">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#050a1e">
<!-- Google AdSense: ポスターも広告なし（K132 と同じ。企画書 72）。サイト所有確認の meta だけ（D118） -->
<meta name="google-adsense-account" content="ca-pub-5375267956079717">
<link rel="icon" href="/hoshizora-night/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/hoshizora-night/apple-touch-icon.png">
<link rel="stylesheet" href="/hoshizora-night/poster/poster.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body class="poster">
<div id="bar" class="topbar" hidden><span>星空ポスター</span><button id="barPdf" type="button">PDF をダウンロード</button></div>
<main>
<h1>生まれた日の星空ポスター</h1>
<p class="lead">日付・時刻・場所の星空を、印刷用の PDF と PNG にします。入力した文字は端末の外に出ません。</p>
<p id="nogl" class="nogl" hidden>この端末では作れません（WebGL が使えません）。<a href="/hoshizora-sanpo/">星空さんぽ</a>で星空を見られます。</p>
<form id="form" onsubmit="return false">
<fieldset class="box">
<legend>いつ・どこの空</legend>
<div class="row">
<label>日付<input id="date" type="date" min="1900-01-01" max="2100-12-31" required></label>
<label>時刻<input id="time" type="time" step="60" required></label>
</div>
<label>場所（都道府県庁）<select id="place"></select></label>
<div id="customBox" class="row" hidden>
<label>緯度<input id="lat" type="number" step="0.01" min="-90" max="90" inputmode="decimal" placeholder="35.69"></label>
<label>経度<input id="lon" type="number" step="0.01" min="-180" max="180" inputmode="decimal" placeholder="139.69"></label>
<label>UTC との差（時間）<input id="tz" type="number" step="0.5" min="-12" max="14" value="9"></label>
</div>
<div class="paper" role="radiogroup" aria-label="紙">
${['A4', 'A3', 'B5'].map((p, i) => `<label><input type="radio" name="paper" value="${p}"${i ? '' : ' checked'}><span>${p}</span></label>`).join('')}
</div>
</fieldset>
<div class="actions">
<button id="pdf" type="button">PDF をダウンロード</button>
<button id="png" type="button" class="sub">PNG</button>
</div>
<p id="status" class="status" aria-live="polite"></p>
<p id="dpiWarn" class="warn" hidden>この端末では、選んだ解像度より低くなります。</p>
<p id="dayNote" class="note" hidden>この時刻は昼か薄明です。ポスターには星を夜と同じように描きます。</p>
<div class="frame"><canvas id="preview" aria-label="ポスターの見本"></canvas></div>
<details class="box">
<summary>文字（題名・日付・場所の行）</summary>
<label>題名<input id="title" type="text" maxlength="40" placeholder="例: 生まれた日の空"></label>
<label>日付の行<input id="dateLine" type="text" maxlength="60"></label>
<label>場所の行<input id="placeLine" type="text" maxlength="60"></label>
<label class="check"><input id="credit" type="checkbox" checked>下に小さく出典の行</label>
</details>
<details class="box">
<summary>紙・余白・解像度・色</summary>
<div class="row">
<label>余白<select id="margin">${[10, 15, 20, 25].map((m) => opt(m, `${m} mm`, m === 15)).join('')}</select></label>
<label>解像度<select id="dpi">${opt(350, '350 dpi', true)}${opt(300, '300 dpi')}</select></label>
</div>
<div class="row">
<label>紙の色<select id="theme">${opt('navy', '濃紺', true)}${opt('white', '白（空だけ濃紺）')}</select></label>
<label>書体<select id="font">${opt('mincho', '明朝', true)}${opt('gothic', 'ゴシック')}</select></label>
</div>
<label class="check"><input id="bleed" type="checkbox">塗り足し 3 mm（印刷所に出すとき）</label>
<label class="check"><input id="lines" type="checkbox" checked>星座線</label>
<label class="check"><input id="names" type="checkbox" checked>星座と惑星の名前</label>
<label class="check"><input id="dirs" type="checkbox" checked>方位</label>
</details>
</form>
<p class="links"><a href="/hoshizora-night/">フル版で今夜の空を見る</a> · <a href="/hoshizora-sanpo/about.html">使い方</a> · <a href="/about.html">運営者情報</a> · <a href="/privacy-policy.html">プライバシーポリシー</a></p>
</main>
<script src="/hoshizora-night/render/gate.js"></script>
<script src="/hoshizora-night/engine/astro.js"></script>
<script src="/hoshizora-night/engine/catalog.js"></script>
<script src="/hoshizora-night/engine/data.js"></script>
<script src="/hoshizora-night/render/sky.js"></script>
<script src="/hoshizora-night/render/look.js"></script>
<script src="/hoshizora-night/render/catalog-extra.js"></script>
<script src="/hoshizora-night/render/prefectures.js"></script>
<script src="/hoshizora-night/render/night-gl.js"></script>
<script src="/hoshizora-night/render/poster.js"></script>
<script src="/hoshizora-night/app/poster.js"></script>
${BEACON}
</body>
</html>
`;
}

export function sitemap() {
  const url = (loc) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${PUBLISHED}</lastmod>
    <xhtml:link rel="alternate" hreflang="ja" href="${BASE}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${BASE}en/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE}"/>
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${url(BASE)}
${url(`${BASE}en/`)}
  <url>
    <loc>${POSTER.url}</loc>
    <lastmod>${POSTER_PUBLISHED}</lastmod>
  </url>
</urlset>
`;
}

/** 書くもの: [相対パス, 中身] */
export function outputs() {
  const out = [['index.html', page('ja', null)], ['en/index.html', page('en', null)], ['sitemap.xml', sitemap()], ['poster/index.html', posterPage()]];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    out.push([`m/${mm}/index.html`, page('ja', m)], [`en/m/${mm}/index.html`, page('en', m)]);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let ng = 0;
  for (const [rel, body] of outputs()) {
    const f = path.join(ROOT, rel);
    if (check) { const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; if (cur !== body) { ng++; console.log(`NG ${rel}（node tools/build-pages.mjs で作り直す）`); } }
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  }
  if (check) { console.log(ng ? `${ng} 件が古い` : 'ページはひな形と同じ'); if (ng) process.exit(1); } else console.log(`${outputs().length} 件を書きました`);
}
