'use strict';
/* K43 生まれた日の星空ポスター（企画書 72）の決まり: 紙の寸法・解像度・割り付け・空の円への投影・PDF と PNG の書き出し。
   描画は render/night-gl.js（フル版の描画器そのもの）、星の位置は render/sky.js の行列（engine/ の写しを呼ぶだけ）。
   ここは天文の計算を持たない。ブラウザでも Node（テスト）でも読める。外へ何も送らない */
(function (root) {
  /* ---------- 紙（JIS P 0138 の紙加工仕上寸法。縦向き。mm） ---------- */
  const PAPERS = {
    A4: { w: 210, h: 297, label: 'A4' },
    A3: { w: 297, h: 420, label: 'A3' },
    B5: { w: 182, h: 257, label: 'B5' },
  };
  const DPIS = [300, 350];          // 印刷所の目安は 300〜350（ラクスルのポスターは 350〜400ppi。企画書 72 の 4 章）
  const MARGINS = [10, 15, 20, 25]; // 余白（mm）
  const BLEED_MM = 3;               // 塗り足し（印刷所に出すとき。上下左右 3 mm）
  const REF_D = 900;                // 星の大きさの基準: 空の円の直径が 900 px のとき描画器の DPR 1 と同じ見え方
  const MAX_CANVAS_PX = 16000000;   // 1 枚の canvas の画素数の上限（iPhone の Safari は約 1,677 万）。超えたら帯に分ける

  const mmToPx = (mm, dpi) => Math.round(mm / 25.4 * dpi);
  const mmToPt = (mm) => mm * 72 / 25.4;

  /**
   * 割り付け。すべて px（解像度 dpi のとき）。bleed なら紙の外に 3 mm ずつ足した大きさが pageW × pageH
   * 空の円は余白の内側の幅いっぱいから方位の文字の分を引いた大きさ。文字は円の下
   */
  function layout(o) {
    const P = PAPERS[o.paper] || PAPERS.A4, dpi = o.dpi || 300, m = o.marginMm == null ? 15 : o.marginMm;
    const b = o.bleed ? BLEED_MM : 0;
    const px = (mm) => mm / 25.4 * dpi;
    const trimW = mmToPx(P.w, dpi), trimH = mmToPx(P.h, dpi), bx = mmToPx(b, dpi);
    const pageW = trimW + 2 * bx, pageH = trimH + 2 * bx;
    const cw = px(P.w - 2 * m), ch = px(P.h - 2 * m);
    const d = Math.floor(Math.min(cw / 1.1, ch * 0.64));       // 円の左右に方位の文字（直径の 5%）
    const gap = d * 0.05;
    const cx = bx + trimW / 2, top = bx + px(m) + gap, cy = top + d / 2;
    const W = trimW;
    const size = { title: W * 0.056, date: W * 0.026, place: W * 0.02, credit: W * 0.011, dir: d * 0.026, con: d * 0.0125 };
    const bottom = bx + trimH - px(m);                          // 余白の内側の下端
    const creditY = bottom;                                     // 出典の行（下揃え）
    const areaTop = cy + d / 2 + gap * 1.6, areaBottom = creditY - size.credit * 2.2;
    const block = size.title * 1.0 + size.date * 2.0 + size.place * 1.8;
    const y0 = areaTop + Math.max(0, (areaBottom - areaTop - block) / 2);
    return {
      paper: P, dpi, marginMm: m, bleedMm: b, pageW, pageH, trimX: bx, trimY: bx, trimW, trimH,
      circle: { cx, cy, d, gap }, size,
      text: { title: y0 + size.title, date: y0 + size.title + size.date * 2.0, place: y0 + size.title + size.date * 2.0 + size.place * 1.8, credit: creditY },
      textBlockBottom: y0 + block, areaBottom,
      // PDF の箱（pt。原点は左下）
      pt: { w: mmToPt(P.w + 2 * b), h: mmToPt(P.h + 2 * b), trim: [mmToPt(b), mmToPt(b), mmToPt(b + P.w), mmToPt(b + P.h)] },
      starDpr: d / REF_D,
    };
  }

  /**
   * 地平座標 h（東・北・天頂の単位ベクトル）→ 空の円の上の点（px）。
   * 描画器を「真上（高度 90°）・方位 180°・視野 180°」に向けたときと同じ式（立体射影、北が上・東が左。見上げた空）
   */
  function skyXY(h, c) {
    const k = c.d / 2 / (1 + h[2]);
    return { x: c.cx - h[0] * k, y: c.cy - h[1] * k, visible: h[2] >= 0 };
  }
  /** 同じ点を高度・方位（ラジアン。方位は北 0・東 90°）から別の式で（テストの突き合わせ用） */
  function altAzXY(alt, az, c) {
    const r = c.d / 2 * Math.tan((Math.PI / 2 - alt) / 2);
    return { x: c.cx - r * Math.sin(az), y: c.cy - r * Math.cos(az) };
  }
  /** 描画器（render/night-gl.js の draw）に渡す向き。真上を中心に視野 180° で地平線が円の縁 */
  const VIEW = { az: Math.PI, alt: Math.PI / 2, zoom: 1, fovDeg: 180 };

  /* ---------- 日時（その土地の時刻 ⇄ UNIX ミリ秒。UTC との差は時間で） ---------- */
  function localToMs(date, time, offsetH) {
    const d = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/), t = String(time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!d || !t) return NaN;
    return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - (+offsetH || 0) * 3600e3;
  }
  function msToLocal(ms, offsetH) {
    const s = new Date(ms + (+offsetH || 0) * 3600e3).toISOString();
    return { date: s.slice(0, 10), time: s.slice(11, 16) };
  }
  /** 既定の 2 行（利用者が書き換える）。日付と場所だけで、名前は入れない */
  function defaultLines(ms, offsetH, placeName, lat, lon) {
    const l = msToLocal(ms, offsetH), [y, mo, d] = l.date.split('-').map(Number);
    const tz = Math.abs(+offsetH - 9) < 1e-9 ? '' : `（UTC${offsetH >= 0 ? '+' : '−'}${Math.abs(offsetH)}）`;
    const coord = `${lat >= 0 ? '北緯' : '南緯'}${Math.abs(lat).toFixed(2)}° ${lon >= 0 ? '東経' : '西経'}${Math.abs(lon).toFixed(2)}°`;
    return { date: `${y}年${mo}月${d}日 ${+l.time.slice(0, 2)}:${l.time.slice(3)}${tz}`, place: placeName ? `${placeName}　${coord}` : coord };
  }

  /* ---------- 帯（大きな紙は canvas を縦に分ける） ---------- */
  function bands(pageW, pageH, maxPx = MAX_CANVAS_PX) {
    const n = Math.max(1, Math.ceil(pageW * pageH / maxPx)), h = Math.ceil(pageH / n), out = [];
    for (let y = 0; y < pageH; y += h) out.push({ y, h: Math.min(h, pageH - y) });
    return out;
  }

  /* ---------- PDF（JPEG の帯を並べた 1 ページ。文字も画像の中なので字形の埋め込みは要らない） ---------- */
  const latin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  const num = (x) => (Math.round(x * 1000) / 1000).toString();
  /**
   * o = { w, h（pt）, trim: [x0,y0,x1,y1]|null（塗り足しがあるとき仕上がりの箱）, images: [{ data: Uint8Array(JPEG), pxW, pxH, x, y, dw, dh（pt。左下原点）}] }
   */
  function buildPdf(o) {
    const objs = [];   // 1 始まりの番号 → Uint8Array の中身
    const add = (parts) => { objs.push(parts); return objs.length; };
    const catalog = add(null), pages = add(null);
    const imgIds = o.images.map((im) => add([latin1(`<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`), im.data, latin1('\nendstream')]));
    const content = o.images.map((im, i) => `q ${num(im.dw)} 0 0 ${num(im.dh)} ${num(im.x)} ${num(im.y)} cm /Im${i} Do Q`).join('\n');
    const contentId = add([latin1(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)]);
    const xo = imgIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
    const box = (b) => `[${b.map(num).join(' ')}]`;
    const media = [0, 0, o.w, o.h];
    const boxes = `/MediaBox ${box(media)}` + (o.trim ? ` /BleedBox ${box(media)} /TrimBox ${box(o.trim)}` : '');
    const page = add([latin1(`<< /Type /Page /Parent ${pages} 0 R ${boxes} /Resources << /XObject << ${xo} >> >> /Contents ${contentId} 0 R >>`)]);
    objs[catalog - 1] = [latin1(`<< /Type /Catalog /Pages ${pages} 0 R >>`)];
    objs[pages - 1] = [latin1(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`)];
    const info = add([latin1('<< /Producer (yorozu-craft hoshizora-night poster) >>')]);   // 題名など利用者の文字は入れない
    const chunks = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    let off = chunks[0].length;
    const offs = [];
    objs.forEach((parts, i) => {
      offs.push(off);
      const head = latin1(`${i + 1} 0 obj\n`), tail = latin1('\nendobj\n');
      for (const c of [head, ...parts, tail]) { chunks.push(c); off += c.length; }
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('');
    chunks.push(latin1(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`));
    const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  /* ---------- PNG に解像度（pHYs）を書き込む（印刷所のソフトが dpi を読めるように） ---------- */
  let CRC = null;
  function crc32(bytes) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function pngWithDpi(png, dpi) {
    const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set(latin1('pHYs'), 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const at = 8 + 25;   // 署名 8 バイト＋IHDR（長さ 4・種類 4・中身 13・CRC 4）の直後
    const out = new Uint8Array(png.length + 21);
    out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + 21);
    return out;
  }
  /** PNG の pHYs から dpi を読む（無ければ null） */
  function pngDpi(png) {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    for (let i = 8; i + 8 <= png.length;) {
      const len = dv.getUint32(i), type = String.fromCharCode(...png.subarray(i + 4, i + 8));
      if (type === 'pHYs') return png[i + 16] === 1 ? Math.round(dv.getUint32(i + 8) * 0.0254) : null;
      if (type === 'IDAT') return null;
      i += 12 + len;
    }
    return null;
  }

  /** PDF の中身を読む（確かめ用: tests/poster.test.js・tools/check-k43.cjs）。Node の Buffer か Uint8Array */
  function readPdf(buf) {
    let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray ? buf.subarray(i, i + 8192) : buf.slice(i, i + 8192));
    const box = (k) => { const m = s.match(new RegExp(`/${k} \\[([^\\]]+)\\]`)); return m && m[1].split(' ').map(Number); };
    const imgs = [...s.matchAll(/\/Width (\d+) \/Height (\d+)/g)].map((m) => [+m[1], +m[2]]);
    // xref の位置が本当に各オブジェクトの頭を指すか
    const start = +s.match(/startxref\n(\d+)/)[1];
    const xr = s.slice(start).split('\n'), n = +xr[1].split(' ')[1];
    const offs = xr.slice(3, 2 + n).map((l) => +l.slice(0, 10));
    const xrefOk = offs.every((o, i) => s.startsWith(`${i + 1} 0 obj`, o));
    return { media: box('MediaBox'), trim: box('TrimBox'), imgs, xrefOk, text: s };
  }

  const api = { PAPERS, DPIS, MARGINS, BLEED_MM, REF_D, MAX_CANVAS_PX, mmToPx, mmToPt, layout, skyXY, altAzXY, VIEW, localToMs, msToLocal, defaultLines, bands, buildPdf, readPdf, crc32, pngWithDpi, pngDpi };
  if (typeof module !== 'undefined') module.exports = api; else root.NightPoster = api;
})(typeof window !== 'undefined' ? window : globalThis);
