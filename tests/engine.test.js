'use strict';
// engine/ の写しが手で書き換えられていないか（SOURCE.json の sha256 と、2 行目以降の中身を突き合わせる）。
// 写し元（hoshizora-sanpo）と 1 バイトずつ比べるのは `node tools/sync-from-sanpo.mjs --check`（CI でも走る）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ENGINE = path.join(__dirname, '..', 'engine');
const meta = JSON.parse(fs.readFileSync(path.join(ENGINE, 'SOURCE.json'), 'utf8'));

test('SOURCE.json に写し元のコミットと確認日がある', () => {
  assert.match(meta.commit, /^[0-9a-f]{40}$/);
  assert.match(meta.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(Object.keys(meta.files).sort(), ['astro.js', 'catalog.js', 'data.js', 'official-events.js']);
  assert.strictEqual(meta.files['official-events.js'].from, 'tools/official-events.js');
});

for (const f of Object.keys(meta.files)) {
  test(`${f}: 先頭行が生成の印で、2 行目以降が元（sha256）と同じ`, () => {
    const text = fs.readFileSync(path.join(ENGINE, f), 'utf8');
    const nl = text.indexOf('\n');
    const head = text.slice(0, nl), body = text.slice(nl + 1);
    assert.ok(head.startsWith('/* 生成物・手で編集しない: '), head);
    assert.ok(head.includes(`@${meta.commit} の ${meta.files[f].from || f} `) && head.includes(`確認日 ${meta.checked}`) && head.includes(meta.files[f].sha256), head);
    assert.strictEqual(crypto.createHash('sha256').update(body).digest('hex'), meta.files[f].sha256);
  });
}

test('engine/ に写し以外のファイルを置かない', () => {
  assert.deepStrictEqual(fs.readdirSync(ENGINE).sort(), ['SOURCE.json', 'astro.js', 'catalog.js', 'data.js', 'official-events.js']);
});
