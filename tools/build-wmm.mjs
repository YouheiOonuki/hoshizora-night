// 地磁気の偏角（磁北と真北の差）を出す WMM2025 の係数を render/wmm.js に書く（企画書 75 の 1 ジャイロ）。
//   node tools/build-wmm.mjs <WMM.COF>
// 係数の出典: NOAA NCEI「World Magnetic Model (WMM) Coefficients」WMM2025（2025.0〜2030.0）
//   https://www.ncei.noaa.gov/products/world-magnetic-model/wmm-coefficients （WMM2025COF.zip の WMM.COF。2026-10-03 に取得）
//   NOAA は「The WMM source code is in the public domain」（https://www.ncei.noaa.gov/products/world-magnetic-model）。
// 確かめ: tests/wow.test.js が WMM2025COF.zip の WMM2025_TestValues.txt（公式の検算値 12 点）の偏角と 0.01° 以内で一致することを見る
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('使い方: node tools/build-wmm.mjs <WMM.COF>'); process.exit(1); }
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const [epoch, model] = lines[0].trim().split(/\s+/);
const rows = [];
for (const l of lines.slice(1)) {
  const f = l.trim().split(/\s+/);
  if (f.length < 6 || /^9{10}/.test(f[0])) continue;
  rows.push(f.slice(0, 6).map(Number));
}
const out = `'use strict';
/* 生成物・手で編集しない: tools/build-wmm.mjs が NOAA NCEI の ${model}（WMM.COF、基準 ${epoch}）から書いた（取得 2026-10-03）。
   出典: https://www.ncei.noaa.gov/products/world-magnetic-model/wmm-coefficients 。WMM はパブリックドメイン（NOAA）。
   [n, m, g, h, gの年変化, hの年変化]（nT、nT/年） */
(function (root) {
  const EPOCH = ${Number(epoch)}, MODEL = '${model}';
  const COF = ${JSON.stringify(rows)};
  const api = { EPOCH, MODEL, COF };
  if (typeof module !== 'undefined') module.exports = api; else root.NightWMM = api;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(ROOT, 'render', 'wmm.js'), out);
console.log(`render/wmm.js: ${rows.length} 行（${model}）`);
