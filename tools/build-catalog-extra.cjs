// 追加の星表 render/catalog-extra.js を作る（開発時に一度だけ。オーナー決定 2026-10-03「わぁきれい」で 6.5 等まで増やす）。
// 通常版の星表（engine/catalog.js。5.6 等まで）には手を付けない。通常版と同じ元データ・同じ並びで、5.6 等より暗く 6.5 等までの星だけを別に持つ。
//   元データ: Yale Bright Star Catalogue 5th Revised Ed.（Hoffleit & Warren 1991）を JSON にした
//             https://github.com/brettonw/YaleBrightStarCatalog の bsc5-all.json（MIT。通常版の tools/build-catalog.js と同じもの）
//   使い方: node tools/build-catalog-extra.cjs path/to/bsc5-all.json
//   確かめ: 同じ元データから 5.6 等までを取り出すと engine/catalog.js と 1 行も違わないことを先に確かめ、違えば止まる
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BASE_LIMIT = 5.6, LIMIT = 6.5;

function rowsOf(src, lo, hi) {
  const rows = [];
  for (const s of src) {
    if (s.RAh === undefined || s.Vmag === undefined) continue;
    const mag = parseFloat(s.Vmag);
    if (!(mag > lo && mag <= hi)) continue;
    const ra = +s.RAh + s.RAm / 60 + s.RAs / 3600;
    const dec = (s['DE-'] === '-' ? -1 : 1) * (+s.DEd + s.DEm / 60 + s.DEs / 3600);
    const bv = s['B-V'] !== undefined ? parseFloat(s['B-V']) : 0.3;
    rows.push([Math.round(ra * 1000), Math.round(dec * 100), Math.round(mag * 100), Math.round(bv * 100)]);
  }
  return rows.sort((a, b) => a[2] - b[2]);
}

const file = process.argv[2];
const buf = fs.readFileSync(file);
const src = JSON.parse(buf);
const { CATALOG } = require('../engine/catalog.js');
const base = rowsOf(src, -Infinity, BASE_LIMIT).flat();
if (base.length !== CATALOG.length || base.some((x, i) => x !== CATALOG[i])) { console.error('元データが通常版の星表と合いません'); process.exit(1); }
const rows = rowsOf(src, BASE_LIMIT, LIMIT);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const out = `'use strict';
/* 生成物・手で編集しない（tools/build-catalog-extra.cjs）。追加の星 ${rows.length} 個（${BASE_LIMIT} 等より暗く ${LIMIT} 等まで）。
   通常版の星表（engine/catalog.js）と同じ元データ・同じ並び: 赤経(時×1000), 赤緯(度×100), 等級×100, B-V×100（J2000）
   出典: Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991)。JSON 化は brettonw/YaleBrightStarCatalog（MIT）の bsc5-all.json（sha256 ${sha}）
   同じ元データから ${BASE_LIMIT} 等までを取ると engine/catalog.js と一致することを確かめてから作った */
(function (root) {
  const CATALOG_EXTRA = [
${rows.map((r) => r.join(',')).join(',\n')}
  ];
  if (typeof module !== 'undefined') module.exports = { CATALOG_EXTRA, LIMIT: ${LIMIT}, BASE_LIMIT: ${BASE_LIMIT} }; else root.CATALOG_EXTRA = CATALOG_EXTRA;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(ROOT, 'render', 'catalog-extra.js'), out);
console.log(`書きました: render/catalog-extra.js（${rows.length} 個、${(out.length / 1024).toFixed(0)} KB）`);
