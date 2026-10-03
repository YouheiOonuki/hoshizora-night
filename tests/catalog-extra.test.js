'use strict';
// 追加の星表（オーナー決定 2026-10-03 で 6.5 等まで）。通常版の星表（engine/catalog.js）は変えず、重ならない
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CATALOG } = require('../engine/catalog.js');
const X = require('../render/catalog-extra.js');

test('5.6 等より暗く 6.5 等まで、5155 個、並びは通常版と同じ（赤経×1000・赤緯×100・等級×100・B−V×100）', () => {
  const C = X.CATALOG_EXTRA;
  assert.strictEqual(C.length % 4, 0);
  assert.strictEqual(C.length / 4, 5155);
  for (let i = 0; i < C.length; i += 4) {
    assert.ok(C[i + 2] > 560 && C[i + 2] <= 650, `等級 ${C[i + 2]}`);
    assert.ok(C[i] >= 0 && C[i] < 24000 && Math.abs(C[i + 1]) <= 9000);
  }
  for (let i = 2; i < CATALOG.length; i += 4) assert.ok(CATALOG[i] <= 560);
});

test('通常版の星表と同じ星を持たない（赤経・赤緯・等級が同じ行が無い）', () => {
  const key = (C, i) => `${C[i]},${C[i + 1]},${C[i + 2]}`;
  const base = new Set(); for (let i = 0; i < CATALOG.length; i += 4) base.add(key(CATALOG, i));
  for (let i = 0; i < X.CATALOG_EXTRA.length; i += 4) assert.ok(!base.has(key(X.CATALOG_EXTRA, i)));
});

test('生成物の印と出典（Yale BSC5・brettonw の JSON の sha256）がある', () => {
  const head = fs.readFileSync(path.join(__dirname, '..', 'render', 'catalog-extra.js'), 'utf8').slice(0, 600);
  assert.ok(head.includes('生成物・手で編集しない') && head.includes('Yale Bright Star Catalogue') && /sha256 [0-9a-f]{64}/.test(head));
});
