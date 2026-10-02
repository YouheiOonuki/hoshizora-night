'use strict';
// 突き合わせ（ROADMAP 7.15 の要件 1・7.14 の 9(c)）: 同じ時刻・場所で、通常版と同じ星が同じ位置に出るか。
// 時刻 5 × 場所 2 = 10 点で、星表の全星・星座の星・太陽・月・惑星の方位と高度の差がすべて 0.1° 以内。
// 通常版の道筋は hoshizora-sanpo の main.js と同じ（precessor → altAz）。フル版は render/sky.js の行列 1 つ（GPU と同じ）。
// GPU は 32 ビット浮動小数なので、行列とベクトルを Float32 に丸めた場合も確かめる。
const test = require('node:test');
const assert = require('node:assert');
const A = require('../engine/astro.js');
const { CATALOG } = require('../engine/catalog.js');
const { CONS, LONE, LOCS } = require('../engine/data.js');
const S = require('../render/sky.js');

const LIMIT = 0.1; // 度
const TIMES = [ // 日本時間で書いた 5 つの時刻（季節・時刻・年をばらす）
  '2026-12-15T21:00:00+09:00',
  '2027-01-15T03:00:00+09:00',
  '2027-04-01T20:00:00+09:00',
  '2027-08-12T23:30:00+09:00',
  '2035-10-01T05:00:00+09:00',
];
const PLACES = ['tokyo', 'sydney'].map((id) => LOCS.find((l) => l.id === id));

// 星（J2000 の赤経[時]・赤緯[度]）
const STARS = [];
for (let i = 0; i < CATALOG.length; i += 4) STARS.push([CATALOG[i] / 1000, CATALOG[i + 1] / 100]);
CONS.forEach((c) => c.ss.forEach((s) => STARS.push([s[0], s[1]])));
LONE.forEach((s) => STARS.push([s[0], s[1]]));

const angDiff = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
const f32 = (arr) => Array.from(Float32Array.from(arr));

/** 通常版の道筋（hoshizora-sanpo の main.js: addStar と render の toHz） */
function sanpoStar(ms, loc, raH, decD) {
  const prec = A.precessor(ms);
  const [ra, dec] = prec(raH * 15 * A.DEG, decD * A.DEG);
  const lst = A.lstRad(ms, loc.lon);
  const [alt, az] = A.altAz(Math.sin(dec), Math.cos(dec), ra, lst, Math.sin(loc.lat * A.DEG), Math.cos(loc.lat * A.DEG));
  return [alt, A.norm(az)];
}
function sanpoBodies(ms, loc) {
  const prec = A.precessor(ms), lst = A.lstRad(ms, loc.lon), sl = Math.sin(loc.lat * A.DEG), cl = Math.cos(loc.lat * A.DEG);
  const eq = { sun: A.sun(ms), moon: A.moon(ms) };
  for (const id of A.PLANET_IDS) eq[id] = A.planet(id, ms, prec);
  const out = {};
  for (const [id, o] of Object.entries(eq)) {
    const [alt, az] = A.altAz(Math.sin(o.dec), Math.cos(o.dec), o.ra, lst, sl, cl);
    out[id] = { eq: o, hz: [alt, A.norm(az)] };
  }
  return out;
}

/** 1 点ぶんの最大差（度） */
function compare(ms, loc, round) {
  const M = round ? f32(S.starMatrix(ms, loc.lat, loc.lon)) : S.starMatrix(ms, loc.lat, loc.lon);
  const H = S.horizonMatrix(ms, loc.lat, loc.lon);
  let dAlt = 0, dAz = 0;
  const upd = (ref, got) => {
    dAlt = Math.max(dAlt, Math.abs(ref[0] - got[0]) / A.DEG);
    // 天頂のごく近く（高度 89.9° 超）は方位が定まらないので方位の比較から外す
    if (Math.abs(ref[0]) < 89.9 * A.DEG) dAz = Math.max(dAz, angDiff(ref[1], got[1]) / A.DEG);
  };
  for (const [raH, decD] of STARS) {
    let v = S.vec(raH * 15 * A.DEG, decD * A.DEG);
    if (round) v = f32(v);
    upd(sanpoStar(ms, loc, raH, decD), S.toAltAz(S.apply(M, v)));
  }
  for (const b of Object.values(sanpoBodies(ms, loc))) upd(b.hz, S.toAltAz(S.apply(H, S.vec(b.eq.ra, b.eq.dec))));
  return { dAlt, dAz };
}

test('星の数: 星表 3249 ＋ 星座の星 ＋ 1 等星ほか', () => {
  assert.strictEqual(CATALOG.length / 4, 3249);
  assert.ok(STARS.length > 3249);
});

const results = [];
for (const t of TIMES) for (const loc of PLACES) {
  test(`${t} ${loc.en}: 通常版とフル版の方位・高度の差が ${LIMIT}° 以内`, () => {
    const ms = Date.parse(t);
    const r64 = compare(ms, loc, false), r32 = compare(ms, loc, true);
    results.push({ t, loc: loc.en, ...r64, alt32: r32.dAlt, az32: r32.dAz });
    assert.ok(r64.dAlt <= LIMIT && r64.dAz <= LIMIT, JSON.stringify(r64));
    assert.ok(r32.dAlt <= LIMIT && r32.dAz <= LIMIT, JSON.stringify(r32));
  });
}

test('結果の表（最大差・度）', () => {
  assert.strictEqual(results.length, 10);
  const fmt = (x) => x.toExponential(1);
  for (const r of results) console.log(`  ${r.t} ${r.loc.padEnd(6)} 高度 ${fmt(r.dAlt)} 方位 ${fmt(r.dAz)} ｜Float32: 高度 ${fmt(r.alt32)} 方位 ${fmt(r.az32)}`);
});

test('行列は回転（直交・行列式 1）', () => {
  const m = S.starMatrix(Date.parse(TIMES[0]), 35.681, 139.767);
  const t = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  const I = S.mul(m, t);
  I.forEach((x, i) => assert.ok(Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-12));
});

test('外れを見逃さない: フル版を 1 分ずらすと 0.1° を超える', () => {
  const ms = Date.parse(TIMES[0]), loc = PLACES[0];
  const M = S.starMatrix(ms + 60e3, loc.lat, loc.lon);
  let worst = 0;
  for (const [raH, decD] of STARS.slice(0, 200)) {
    const ref = sanpoStar(ms, loc, raH, decD), got = S.toAltAz(S.apply(M, S.vec(raH * 15 * A.DEG, decD * A.DEG)));
    if (Math.abs(ref[0]) < 80 * A.DEG) worst = Math.max(worst, Math.abs(ref[0] - got[0]) / A.DEG, angDiff(ref[1], got[1]) / A.DEG);
  }
  assert.ok(worst > LIMIT, `最大差 ${worst}°`);
});
