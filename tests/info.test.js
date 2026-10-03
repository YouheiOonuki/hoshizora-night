'use strict';
// 説明シート（企画書 74: 軽量版の星座・星・月・惑星の説明を全部）。render/info.js
// 文は軽量版の写し（engine/data.js・engine/text.js）から取り、ここに説明文を持たないことを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../render/info.js');
const A = require('../engine/astro.js');
const { CONS, BODY_INFO, LONE, STAR_EN } = require('../engine/data.js');
const { TEXT } = require('../engine/text.js');

const JA = I.ctx('ja', false), KANA = I.ctx('ja', true), EN = I.ctx('en', false);
const ORI = CONS.find((c) => c.id === 'ori');

test('星座: 32 星座すべてで、神話（adl）・まめちしき（fun）・季節・主な星・図鑑へのリンク（日本語）', () => {
  assert.strictEqual(CONS.length, 32);
  for (const c of CONS) {
    const h = I.con(c, true, JA);
    assert.ok(h.includes(c.adl) && h.includes(c.fun), c.id);
    assert.ok(h.includes(TEXT.ja.seasonChip(c.season)) && h.includes(TEXT.ja.upNow), c.id);
    assert.ok(h.includes(`/hoshizora-sanpo/zukan/${c.id}.html`), c.id);
    const named = c.ss.filter((s) => s[4]).slice(0, 4);
    for (const s of named) assert.ok(h.includes(s[4].split('（')[0]), `${c.id} ${s[4]}`);
  }
  assert.ok(I.con(ORI, false, JA).includes(TEXT.ja.below));
});

test('星座: ひらがなモードは こども向けの話（kid）で、まめちしきは出さない。英語は「日本語だけ」の一文（軽量版と同じ）', () => {
  const k = I.con(ORI, true, KANA);
  assert.ok(k.includes(ORI.kid) && !k.includes(ORI.adl) && !k.includes(ORI.fun) && k.includes('おりおんざ'));
  const e = I.con(ORI, true, EN);
  assert.ok(e.includes(TEXT.en.mythNote) && !e.includes(ORI.adl) && e.includes('Orion') && e.includes(STAR_EN['ベテルギウス']));
});

test('星: 等級・光年・光が届くまでの話・温度のものさし・星座（日英・かな）', () => {
  const s = ORI.ss[0];   // ベテルギウス
  const h = I.star({ name: s[4], mag: s[2], bv: s[3], ly: s[5], con: ORI }, JA);
  assert.ok(h.includes(TEXT.ja.magChip(s[2].toFixed(1))) && h.includes(TEXT.ja.lyChip(s[5])) && h.includes(TEXT.ja.starStory(s[5])) && h.includes(TEXT.ja.tempHot));
  assert.ok(h.includes('オリオン座の図鑑ページ'));
  // 温度のものさしの印: 赤い星は右（低温）
  assert.ok(+h.match(/left:([\d.]+)%/)[1] > 90);
  const l = LONE.find((x) => x[4] === 'カノープス');
  const e = I.star({ name: l[4], mag: l[2], bv: l[3], ly: l[5], conName: l[6] }, EN);
  assert.ok(e.includes('Canopus') && e.includes('Carina') && e.includes(TEXT.en.starStory(l[5])));
  assert.ok(I.star({ name: s[4], mag: s[2], bv: s[3], ly: s[5], con: ORI }, KANA).includes(TEXT.kana.starStory(s[5])));
});

test('月: 月の名前・月齢・距離・満ち欠けの絵・光っている割合（軽量版と同じ文）', () => {
  const ms = Date.parse('2027-01-15T21:00:00+09:00'), M = A.moon(ms);
  const h = I.body({ id: 'moon', up: true, M }, 35.7, JA);
  assert.ok(h.includes(TEXT.ja.moonAge(M.age)) && h.includes(TEXT.ja.moonDist(M.distKm)) && h.includes(TEXT.ja.moonLit(Math.round(M.illum * 100), M.waxing)));
  assert.ok(h.includes(BODY_INFO.moon.adl) && h.includes(BODY_INFO.moon.fun) && h.includes('<svg'));
  const e = I.body({ id: 'moon', up: false, M }, 35.7, EN);
  assert.ok(e.includes(BODY_INFO.moon.adlEn) && e.includes(TEXT.en.below));
});

test('満ち欠けの絵: 北半球で満ちていく月は右が光り、南半球では左右が逆（軽量版 moonSvg と同じ）', () => {
  const half = { illum: 0.5, waxing: true };
  const sweep = (svg) => svg.match(/A\d+(?:\.\d+)? \d+(?:\.\d+)? 0 0 (\d)/)[1];
  assert.strictEqual(sweep(I.moonSvg(half, 35)), '1');
  assert.strictEqual(sweep(I.moonSvg(half, -33)), '0');
  assert.strictEqual(sweep(I.moonSvg({ illum: 0.5, waxing: false }, 35)), '0');
});

test('惑星と太陽: 5 つの惑星の説明・等級・距離、太陽は「直接見ない」', () => {
  const ms = Date.parse('2027-01-15T21:00:00+09:00'), prec = A.precessor(ms);
  for (const id of A.PLANET_IDS) {
    const P = A.planet(id, ms, prec), h = I.body({ id, up: true, P }, 35.7, JA);
    assert.ok(h.includes(BODY_INFO[id].adl) && h.includes(BODY_INFO[id].fun) && h.includes(TEXT.ja.planetDist(P.dist)), id);
    assert.ok(I.body({ id, up: true, P }, 35.7, EN).includes(BODY_INFO[id].funEn), id);
    assert.ok(I.body({ id, up: true, P }, 35.7, KANA).includes(BODY_INFO[id].kid), id);
  }
  assert.ok(I.body({ id: 'sun', up: true }, 35.7, JA).includes(TEXT.ja.sunWarn));
});

test('クイズの結果: 星の数と、軽量版の励ましの文', () => {
  assert.ok(I.quizResult(5, 5, JA).includes('★★★★★') && I.quizResult(5, 5, JA).includes(TEXT.ja.quizPerfect));
  assert.ok(I.quizResult(3, 5, JA).includes(TEXT.ja.quizGood) && I.quizResult(1, 5, EN).includes(TEXT.en.quizAgain));
});

test('render/info.js に説明文を書いていない（文は engine/ の写しから。手で写さない）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'render', 'info.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 日本語の文字が 1 行に 6 文字以上続く所は、軽量版 main.js と同じ短い札（「せいざ」「こうせい」）だけ
  const runs = [...src.matchAll(/[ぁ-んァ-ヶ一-龠ー]{6,}/g)].map((m) => m[0]);
  assert.deepStrictEqual(runs, []);
});
