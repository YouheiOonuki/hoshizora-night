'use strict';
// K43 生まれた日の星空ポスター（企画書 72）: 印刷の寸法・同じ星が同じ位置・PDF と PNG の中身。
// 画像そのもの（星が予測した画素に光っているか・PDF の実物）は tools/check-k43.cjs（Playwright）で見る
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const A = require('../engine/astro.js');
const { CONS } = require('../engine/data.js');
const S = require('../render/sky.js');
const PO = require('../render/poster.js');

test('紙の寸法（JIS P 0138）と 300・350 dpi の画素数', () => {
  assert.deepStrictEqual([PO.PAPERS.A4.w, PO.PAPERS.A4.h, PO.PAPERS.A3.w, PO.PAPERS.A3.h, PO.PAPERS.B5.w, PO.PAPERS.B5.h], [210, 297, 297, 420, 182, 257]);
  const px = (p, dpi, bleed) => { const l = PO.layout({ paper: p, dpi, bleed }); return [l.pageW, l.pageH]; };
  assert.deepStrictEqual(px('A4', 300), [2480, 3508]);
  assert.deepStrictEqual(px('A3', 300), [3508, 4961]);
  assert.deepStrictEqual(px('B5', 300), [2150, 3035]);
  assert.deepStrictEqual(px('A4', 350), [2894, 4093]);
  assert.deepStrictEqual(px('A3', 350), [4093, 5787]);   // 297 / 25.4 × 350 = 4092.5 → 4093、420 / 25.4 × 350 = 5787.4 → 5787
  assert.deepStrictEqual(px('B5', 350), [2508, 3541]);
});

test('塗り足し 3 mm: 上下左右に 3 mm ずつ足し、PDF の TrimBox が仕上がり寸法', () => {
  for (const p of ['A4', 'A3', 'B5']) for (const dpi of [300, 350]) {
    const a = PO.layout({ paper: p, dpi }), b = PO.layout({ paper: p, dpi, bleed: true });
    const bx = PO.mmToPx(3, dpi);
    assert.strictEqual(b.pageW, a.pageW + 2 * bx); assert.strictEqual(b.pageH, a.pageH + 2 * bx);
    const P = PO.PAPERS[p], mm = (pt) => pt / 72 * 25.4;
    assert.ok(Math.abs(mm(b.pt.w) - (P.w + 6)) < 1e-9 && Math.abs(mm(b.pt.h) - (P.h + 6)) < 1e-9);
    assert.ok(Math.abs(mm(b.pt.trim[2] - b.pt.trim[0]) - P.w) < 1e-9 && Math.abs(mm(b.pt.trim[3] - b.pt.trim[1]) - P.h) < 1e-9);
    // 円も文字も、ずらしただけで同じ割り付け
    assert.ok(Math.abs(b.circle.cx - a.circle.cx - bx) < 1e-9 && Math.abs(b.circle.d - a.circle.d) < 1e-9);
  }
});

test('割り付け: 空の円・方位・文字が余白の内側に収まる（全部の紙・余白・解像度）', () => {
  for (const p of ['A4', 'A3', 'B5']) for (const m of PO.MARGINS) for (const dpi of PO.DPIS) for (const bleed of [false, true]) {
    const l = PO.layout({ paper: p, marginMm: m, dpi, bleed }), c = l.circle, mpx = m / 25.4 * dpi;
    const inner = { x0: l.trimX + mpx, x1: l.trimX + l.trimW - mpx, y0: l.trimY + mpx, y1: l.trimY + l.trimH - mpx };
    const o = c.d / 2 + c.gap;   // 方位の文字の外側
    const tag = `${p} ${m}mm ${dpi}dpi ${bleed}`;
    assert.ok(c.cx - o >= inner.x0 - 1 && c.cx + o <= inner.x1 + 1, `${tag} 横`);
    assert.ok(c.cy - o >= inner.y0 - 1, `${tag} 上`);
    assert.ok(l.textBlockBottom <= l.areaBottom + 1 && l.text.title > c.cy + c.d / 2 + c.gap, `${tag} 文字`);
    assert.ok(l.text.credit <= inner.y1 + 1, `${tag} 下`);
    // 印刷所の目安: 空の円そのものが選んだ dpi の画素数で描かれる（直径 mm × dpi / 25.4）
    assert.ok(Math.abs(c.d - Math.floor(c.d)) === 0 && c.d > 0);
  }
});

// 同じ星が同じ位置: ポスターの円の上の点を、(1) フル版と同じ行列 → skyXY と、(2) 通常版の道筋（precessor → altAz）→ 別の式 altAzXY で出し、
// 1 px 以内（A3・350 dpi の円で）。描画器は skyXY と同じ式（真上・視野 180°）で、画素で一致するかは tools/check-k43.cjs で確かめる
test('同じ星が同じ位置（時刻 5 × 場所 3、星座の星すべて、A3・350 dpi の円で 1 px 以内）', () => {
  const lay = PO.layout({ paper: 'A3', dpi: 350 }), c = lay.circle;
  const TIMES = ['1975-06-01T03:00:00+09:00', '1990-12-24T21:00:00+09:00', '2001-08-12T23:30:00+09:00', '2026-10-03T21:00:00+09:00', '2050-02-14T19:00:00+09:00'];
  const PLACES = [[43.06, 141.35], [35.69, 139.69], [26.21, 127.68]];   // 北海道・東京都・沖縄県の庁
  let n = 0, worst = 0;
  for (const t of TIMES) for (const [lat, lon] of PLACES) {
    const ms = Date.parse(t), M = S.starMatrix(ms, lat, lon), prec = A.precessor(ms), lst = A.lstRad(ms, lon);
    for (const con of CONS) for (const s of con.ss) {
      const v = S.vec(s[0] * 15 * A.DEG, s[1] * A.DEG), h = S.apply(M, v);
      const [ra, dec] = prec(s[0] * 15 * A.DEG, s[1] * A.DEG);
      const [alt, az] = A.altAz(Math.sin(dec), Math.cos(dec), ra, lst, Math.sin(lat * A.DEG), Math.cos(lat * A.DEG));
      if (alt < 0.5 * A.DEG) continue;
      const p = PO.skyXY(h, c), q = PO.altAzXY(alt, A.norm(az), c);
      const d = Math.hypot(p.x - q.x, p.y - q.y); worst = Math.max(worst, d); n++;
      assert.ok(p.visible);
    }
  }
  assert.ok(n > 1000, `${n} 点`);
  assert.ok(worst < 1, `最大 ${worst} px`);
  console.log(`  ${n} 点、最大の差 ${worst.toExponential(2)} px（円の直径 ${c.d} px）`);
});

test('向き: 天頂が円の中心、北が上・東が左（見上げた空）、地平線が円の縁', () => {
  const c = { cx: 500, cy: 500, d: 1000 };
  const near = (p, x, y) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
  assert.ok(near(PO.skyXY([0, 0, 1], c), 500, 500));
  assert.ok(near(PO.skyXY([0, 1, 0], c), 500, 0));      // 北の地平
  assert.ok(near(PO.skyXY([1, 0, 0], c), 0, 500));      // 東の地平
  assert.ok(near(PO.skyXY([-1, 0, 0], c), 1000, 500));  // 西
  assert.ok(near(PO.skyXY([0, -1, 0], c), 500, 1000));  // 南
  assert.strictEqual(PO.skyXY([0, 0.5, -0.1], c).visible, false);
});

test('日時: その土地の時刻 ⇄ UNIX（UTC との差）、既定の 2 行に名前は入らない', () => {
  const ms = PO.localToMs('1990-12-24', '21:05', 9);
  assert.strictEqual(new Date(ms).toISOString(), '1990-12-24T12:05:00.000Z');
  assert.deepStrictEqual(PO.msToLocal(ms, 9), { date: '1990-12-24', time: '21:05' });
  assert.ok(Number.isNaN(PO.localToMs('', '21:00', 9)));
  const l = PO.defaultLines(ms, 9, '東京都', 35.69, 139.69);
  assert.deepStrictEqual(l, { date: '1990年12月24日 21:05', place: '東京都　北緯35.69° 東経139.69°' });
  assert.strictEqual(PO.defaultLines(Date.parse('2020-01-01T00:00:00Z'), -5, '', 40.71, -74.01).date, '2019年12月31日 19:00（UTC−5）');
});

test('帯: 1 枚の canvas が 1,600 万画素を超えるときだけ分け、すき間も重なりも無い', () => {
  assert.strictEqual(PO.bands(2480, 3508).length, 1);
  for (const [w, h] of [[4093, 5787], [4175, 5869], [3579, 5031]]) {
    const b = PO.bands(w, h);
    assert.ok(b.length >= 2);
    let y = 0; for (const x of b) { assert.strictEqual(x.y, y); assert.ok(w * x.h <= PO.MAX_CANVAS_PX); y += x.h; }
    assert.strictEqual(y, h);
  }
});

const readPdf = PO.readPdf;

test('PDF: 寸法（pt）・塗り足しの箱・画像の画素数・xref が正しく、利用者の文字が入らない', () => {
  const lay = PO.layout({ paper: 'A4', dpi: 350, bleed: true });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = PO.buildPdf({ w: lay.pt.w, h: lay.pt.h, trim: lay.pt.trim, images: [
    { data: jpeg, pxW: lay.pageW, pxH: 2000, x: 0, y: lay.pt.h / 2, dw: lay.pt.w, dh: lay.pt.h / 2 },
    { data: jpeg, pxW: lay.pageW, pxH: lay.pageH - 2000, x: 0, y: 0, dw: lay.pt.w, dh: lay.pt.h / 2 }] });
  const r = readPdf(pdf);
  assert.ok(r.text.startsWith('%PDF-1.4'));
  assert.ok(r.xrefOk);
  const mm = (pt) => pt / 72 * 25.4;
  assert.ok(Math.abs(mm(r.media[2]) - 216) < 0.01 && Math.abs(mm(r.media[3]) - 303) < 0.01, String(r.media));
  assert.ok(Math.abs(mm(r.trim[0]) - 3) < 0.01 && Math.abs(mm(r.trim[2] - r.trim[0]) - 210) < 0.01 && Math.abs(mm(r.trim[3] - r.trim[1]) - 297) < 0.01, String(r.trim));
  assert.deepStrictEqual(r.imgs, [[lay.pageW, 2000], [lay.pageW, lay.pageH - 2000]]);
  assert.ok(!/\/Title|\/Author|\/Subject/.test(r.text));
  // 塗り足しなしなら TrimBox は無く、MediaBox が仕上がり
  const r2 = readPdf(PO.buildPdf({ w: PO.mmToPt(297), h: PO.mmToPt(420), trim: null, images: [{ data: jpeg, pxW: 10, pxH: 10, x: 0, y: 0, dw: 1, dh: 1 }] }));
  assert.strictEqual(r2.trim, null);
  assert.ok(Math.abs(mm(r2.media[2]) - 297) < 0.01 && Math.abs(mm(r2.media[3]) - 420) < 0.01);
});

test('PNG: pHYs に dpi を書き、読み戻せる（CRC も正しい）', () => {
  // 1×1 の PNG を作る
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(PO.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  assert.strictEqual(PO.crc32(Buffer.from('IEND', 'latin1')), 0xae426082);   // PNG の仕様にある IEND の CRC
  assert.strictEqual(PO.pngDpi(new Uint8Array(png)), null);
  for (const dpi of [300, 350]) {
    const out = PO.pngWithDpi(new Uint8Array(png), dpi);
    assert.strictEqual(PO.pngDpi(out), dpi);
    const i = 33, crc = Buffer.from(out).readUInt32BE(i + 17);
    assert.strictEqual(crc, PO.crc32(out.subarray(i + 4, i + 17)));
  }
});

