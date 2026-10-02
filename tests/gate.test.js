'use strict';
// WebGL が無いときに通常版へ送る処理（render/gate.js）。ブラウザでの実際の送りは tools/measure-webgl.cjs で確かめる。
const test = require('node:test');
const assert = require('node:assert');
const G = require('../render/gate.js');

function fakeGL(maxPoint = 64) {
  return { ALIASED_POINT_SIZE_RANGE: 0x846d, getParameter: (p) => (p === 0x846d ? [1, maxPoint] : null) };
}
function env({ ctx = {}, lang = 'ja', box = true } = {}) {
  const calls = { replace: [], href: null, hidden: true };
  const a = { setAttribute: (k, v) => { calls.href = v; } };
  const nogl = box ? { querySelector: () => a, set hidden(v) { calls.hidden = v; } } : null;
  const doc = {
    documentElement: { lang },
    createElement: () => ({ getContext: (t) => (t in ctx ? ctx[t] : null) }),
    getElementById: (id) => (id === 'nogl' ? nogl : null),
  };
  return { e: { document: doc, location: { replace: (u) => calls.replace.push(u) } }, calls };
}

test('WebGL2 があれば送らない', () => {
  const { e, calls } = env({ ctx: { webgl2: fakeGL() } });
  assert.strictEqual(G.guard(e).ok, true);
  assert.deepStrictEqual(calls.replace, []);
});

test('WebGL1 だけでも送らない', () => {
  const { e, calls } = env({ ctx: { webgl: fakeGL() } });
  assert.strictEqual(G.guard(e).ok, true);
  assert.deepStrictEqual(calls.replace, []);
});

test('WebGL が無ければ /hoshizora-sanpo/ へ送り、リンクも出す', () => {
  const { e, calls } = env();
  const r = G.guard(e);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-context');
  assert.deepStrictEqual(calls.replace, ['/hoshizora-sanpo/']);
  assert.strictEqual(calls.href, '/hoshizora-sanpo/');
  assert.strictEqual(calls.hidden, false);
});

test('英語の画面なら英語の通常版へ', () => {
  const { e, calls } = env({ lang: 'en' });
  G.guard(e);
  assert.deepStrictEqual(calls.replace, ['/hoshizora-sanpo/en/']);
});

test('getContext が例外を投げても止まらずに送る', () => {
  const { e, calls } = env();
  e.document.createElement = () => ({ getContext: () => { throw new Error('blocked'); } });
  assert.strictEqual(G.guard(e).reason, 'error');
  assert.deepStrictEqual(calls.replace, ['/hoshizora-sanpo/']);
});

test('点の大きさが 1 までの実装は送る', () => {
  const { e, calls } = env({ ctx: { webgl: fakeGL(1) } });
  assert.strictEqual(G.guard(e).reason, 'point-size');
  assert.deepStrictEqual(calls.replace, ['/hoshizora-sanpo/']);
});

test('案内の箱が無いページでも送る', () => {
  const { e, calls } = env({ box: false });
  G.guard(e);
  assert.deepStrictEqual(calls.replace, ['/hoshizora-sanpo/']);
});
