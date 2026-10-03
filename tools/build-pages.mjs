// フル版のページを 1 つのひな形から作る（手で 26 枚を直さないため）。
//   node tools/build-pages.mjs           index.html・en/index.html・m/01〜12/・en/m/01〜12/・sitemap.xml を書く
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
<div id="dirs" class="dirs" aria-hidden="true">${T.dirs.map((d) => `<span>${d}</span>`).join('')}</div>
<p id="pick" class="pick" hidden></p>
<header class="hud">
  <p class="clock"><span id="date"></span><span id="time"></span></p>
  <button id="place" type="button" class="chip" aria-expanded="false" aria-controls="places"></button>
</header>
<ul id="tonight" class="tonight"></ul>
<div class="bar">
  <input id="slider" type="range" min="0" max="1439" step="1" value="1260" aria-label="${T.time}">
  <div class="btns">
    <button id="play" type="button" class="icon" aria-label="${T.pause}">${PLAY_SVG}</button>
    <button id="now" type="button">${T.now}</button>
    <button id="share" type="button">${T.share}</button>
    <a id="light" href="${light}">${T.light}</a>
  </div>
</div>
<div id="places" class="panel" role="dialog" aria-labelledby="place" hidden>
  <div class="panel-top"><button id="geo" type="button">${T.here}</button><button id="closePlaces" type="button" class="icon" aria-label="${T.close}">×</button></div>
  <div id="placeList" class="list"></div>
  <p class="links"><a href="${en ? '/en/about.html' : '/about.html'}">${T.about}</a> · <a href="${en ? '/en/privacy-policy.html' : '/privacy-policy.html'}">${T.privacy}</a> · <a href="${en ? '/hoshizora-sanpo/en/guide.html' : '/hoshizora-sanpo/about.html'}">${T.guide}</a> · ${en ? '<a href="/hoshizora-night/" hreflang="ja" lang="ja">日本語</a>' : '<a href="/hoshizora-night/en/" hreflang="en" lang="en">English</a>'}</p>
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
<script src="/hoshizora-night/render/prefectures.js"></script>
<script src="/hoshizora-night/render/night-gl.js"></script>
<script src="/hoshizora-night/app/night.js"></script>
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
</urlset>
`;
}

/** 書くもの: [相対パス, 中身] */
export function outputs() {
  const out = [['index.html', page('ja', null)], ['en/index.html', page('en', null)], ['sitemap.xml', sitemap()]];
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
