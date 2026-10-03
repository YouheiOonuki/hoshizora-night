// 企画書 75（フル版だけの 8 つの機能）の画面の確かめとスクショ（スマホ・PC、機能ごと）。CI では走らせない（ブラウザが要る）。
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check-wow2.cjs <出力先> [機能の番号…]
// スマホは Playwright の iPhone 13 の設定を Chromium で（WebKit が無い）。ヘッドレスはソフトウェア描画なので fps は見ない。
// 結果は <出力先>/result.json。OK でない項目があれば終了コード 1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { serve } = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'k132w2'));
const ONLY = process.argv.slice(3).map(Number);
const BLOCK = /cloudflareinsights|googlesyndication|doubleclick|google-analytics|googletagmanager/;
const ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const PHONE = devices['iPhone 13'];
const PC = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const WINTER = '#35.69,139.69,1800021600';  // 2027-01-15 23:00 JST 東京（冬の星座が南に）

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/hoshizora-night/`;
  const browser = await chromium.launch({ args: ARGS });
  const R = { date: new Date().toISOString(), browser: `Chromium ${browser.version()}`, features: {} };
  const ctxOf = async (dev, opt = {}) => { const c = await browser.newContext({ ...dev, ...opt }); await c.route(BLOCK, (r) => r.abort()); return c; };
  const ready = (p) => p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const open = async (dev, url, opt) => {
    const ctx = await ctxOf(dev, opt), p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(base + url); await ready(p); await p.waitForTimeout(300);
    return { ctx, p, errors };
  };
  const shot = async (p, name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); return f; };
  const want = (n) => !ONLY.length || ONLY.includes(n);

  /* 1 ジャイロ: 端末の向きのイベント（Android の deviceorientationabsolute）を送って、その方向の星が出るか */
  if (want(1)) {
    const F = { shots: [] };
    const { ctx, p, errors } = await open(PHONE, `?probe=off&gyro=show${WINTER}`, { reducedMotion: 'reduce' });
    F.visible = await p.isVisible('#gyro');
    await p.click('#gyro');
    // alpha 0（端末の上が磁北）・beta 120（30° 見上げる）。東京の偏角 約 −8° を足すので真北から西へ約 8° の方向
    const send = (a, b, g) => p.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: a, beta: b, gamma: g, absolute: true })), [a, b, g]);
    await send(0, 120, 0); await p.waitForTimeout(400);
    F.north = await p.evaluate(() => ({ g: window.__night.gyro, az: window.__night.view.az * 180 / Math.PI, alt: window.__night.view.alt * 180 / Math.PI, toast: window.__night.toast }));
    F.shots.push(await shot(p, '1-gyro-phone-north.png'));
    // 南（alpha 180）を 50° 見上げる → オリオン座の方へ
    await send(180, 140, 0); await p.waitForTimeout(400);
    F.south = await p.evaluate(() => ({ az: window.__night.view.az * 180 / Math.PI, alt: window.__night.view.alt * 180 / Math.PI }));
    F.shots.push(await shot(p, '1-gyro-phone-south.png'));
    // ドラッグでジャイロが止まる
    await p.touchscreen.tap(10, 400);
    const box = await p.locator('#sky').boundingBox();
    await p.mouse.move(box.width / 2, 400); await p.mouse.down(); await p.mouse.move(box.width / 2 + 80, 420, { steps: 5 }); await p.mouse.up();
    F.stoppedByDrag = await p.evaluate(() => window.__night.gyro === null && document.getElementById('gyro').getAttribute('aria-pressed') === 'false');
    // イベントが来ない端末: 時間切れでドラッグのまま
    await p.click('#gyro'); await p.waitForTimeout(1800);
    F.timeout = await p.evaluate(() => ({ pressed: document.getElementById('gyro').getAttribute('aria-pressed'), toast: window.__night.toast }));
    F.errors = errors;
    await ctx.close();
    // PC: ボタンは出ない（マウスの端末）
    const pc = await open(PC, `?probe=off${WINTER}`);
    F.pcHidden = !(await pc.p.isVisible('#gyro'));
    F.shots.push(await shot(pc.p, '1-gyro-pc-hidden.png'));
    await pc.ctx.close();
    const decl = -7.94;
    F.ok = F.visible && F.pcHidden && !errors.length && F.north.g && F.north.g.north === true
      && Math.abs((((F.north.az - (360 + decl)) % 360) + 540) % 360 - 180) < 0.6 && Math.abs(F.north.alt - 30) < 0.6
      && Math.abs((((F.south.az - (180 + decl)) % 360) + 540) % 360 - 180) < 0.6 && Math.abs(F.south.alt - 50) < 0.6
      && F.stoppedByDrag && F.timeout.pressed === 'false';
    R.features[1] = F;
  }

  /* 2 街明かり: つまみで田舎 → 都会。限界等級・天の川が下がり、空が明るくなる（同じ空を並べて撮る） */
  if (want(2)) {
    const F = { shots: [], steps: [] };
    const SUMMER = '#35.69,139.69,1817899200';   // 2027-08-10 21:00 JST 東京（夏の天の川が南に）
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const { ctx, p, errors } = await open(dev, `?probe=off&view=180,45${SUMMER}`, { reducedMotion: 'reduce' });
      await p.click('#lightBtn'); await p.waitForTimeout(200);
      for (const [u, name] of [[0, 'country'], [0.5, 'suburb'], [1, 'city']]) {
        await p.evaluate((u) => window.__night.setLight(u), u); await p.waitForTimeout(300);
        const st = await p.evaluate(() => ({ ...window.__night.light, read: document.getElementById('lightRead').textContent }));
        if (tag === 'phone') F.steps.push(st);
        // 空の明るさ（画面の中ほどの平均の明るさ）
        const buf = await p.screenshot({ clip: { x: 0, y: 140, width: dev.viewport.width, height: 260 } });
        st.png = buf.length;
        F.shots.push(await shot(p, `2-light-${tag}-${name}.png`));
      }
      await p.click('[data-close="lightPanel"]'); await p.waitForTimeout(200);
      F[tag + 'PressedAfterClose'] = await p.evaluate(() => document.getElementById('lightBtn').getAttribute('aria-pressed'));
      F[tag + 'Errors'] = errors;
      await ctx.close();
    }
    const [a, b, c] = F.steps;
    F.ok = a.limit >= 6.5 && b.limit < a.limit && c.limit < 4 && a.milky === 1 && c.milky === 0 && /6\.5/.test(a.read)
      && F.phonePressedAfterClose === 'true' && !F.phoneErrors.length && !F.pcErrors.length;
    R.features[2] = F;
  }

  /* 3 星座絵: 押すまで何も読まない → 押すと網（art.js）と、画面に入った星座の画像だけを読む。季節ごとにスマホ・PC。出典の行が出る */
  if (want(3)) {
    const F = { shots: [], seasons: {} };
    const at = (iso) => Math.round(Date.parse(iso) / 1000);
    const SEASONS = [   // 東京、夜 21 時（JST）ごろ。view = 方位,高度（向く方向）
      ['spring', at('2027-04-15T12:00:00Z'), '190,55'],   // しし・おとめ・うしかい・おおぐま
      ['summer', at('2027-08-10T12:00:00Z'), '150,50'],   // さそり・いて・へびつかい・わし・はくちょう・こと・ヘルクレス
      ['autumn', at('2026-10-15T12:00:00Z'), '120,60'],   // ペガスス・アンドロメダ・みずがめ・やぎ・うお・カシオペヤ
      ['winter', 1800021600, '175,40'],                   // オリオン・おうし・ふたご・おおいぬ・こいぬ
    ];
    const total = require('../render/art.js').ART.length;
    for (const [season, t, view] of SEASONS) {
      const S = (F.seasons[season] = {});
      for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
        const ctx = await ctxOf(dev, { reducedMotion: 'reduce' }), p = await ctx.newPage(), reqs = [], errors = [];
        p.on('request', (q) => reqs.push(q.url())); p.on('pageerror', (e) => errors.push(e.message));
        await p.goto(base + `?probe=off&view=${view}#35.69,139.69,${t}`); await ready(p); await p.waitForTimeout(600);
        const before = reqs.filter((u) => /render\/art/.test(u)).length;
        await p.click('#artBtn');
        await p.waitForFunction(() => Object.values(window.__night.artState()).some(Boolean), null, { timeout: 15000 });
        await p.waitForTimeout(1500);
        const imgs = [...new Set(reqs.filter((u) => /render\/art\/[a-z0-9-]+\.jpg/.test(u)).map((u) => u.match(/art\/([a-z0-9-]+)\.jpg/)[1]))];
        const loaded = Object.entries(await p.evaluate(() => window.__night.artState())).filter(([, v]) => v).map(([k]) => k);
        S[tag] = { before, js: reqs.some((u) => /render\/art\.js/.test(u)), imgs, loaded, credit: await p.isVisible('#artCredit'), errors };
        F.shots.push(await shot(p, `art-${season}-${tag}.png`));
        await ctx.close();
      }
    }
    const all = Object.values(F.seasons).flatMap((x) => [x.phone, x.pc]);
    F.total = total;
    F.ok = all.every((x) => x.before === 0 && x.js && x.imgs.length >= 1 && x.imgs.length < total && x.credit && !x.errors.length && x.loaded.length >= 1);
    R.features[3] = F;
  }

  /* 4 星雲・星団へのズーム: 実写が向き・大きさを合わせて出て、出典（ESA/Hubble の Credit の文）が見える。閉じると戻る */
  if (want(4)) {
    const F = { shots: [] };
    const AUTUMN = '#35.69,139.69,1798462800';   // 2026-12-28 21:00 JST 東京（M31 が西の空・M45 と M42 が東〜南東）
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const { ctx, p, errors } = await open(dev, `?probe=off${AUTUMN}`, { reducedMotion: 'reduce' });
      F[tag] = {};
      for (const id of ['m42', 'm45', 'm31']) {
        await p.evaluate((id) => window.__night.openDso(id), id);
        await p.waitForFunction((id) => window.__night.photoState()[id], id, { timeout: 15000 });
        await p.waitForTimeout(1300);
        F[tag][id] = await p.evaluate(() => ({ deep: window.__night.deep, zoom: window.__night.view.zoom, sheet: window.__night.sheet,
          credit: document.querySelector('.dso-credit a') && document.querySelector('.dso-credit a').textContent, href: document.querySelector('.dso-credit a') && document.querySelector('.dso-credit a').href }));
        F.shots.push(await shot(p, `4-dso-${tag}-${id}.png`));
      }
      await p.click('#dsoBack'); await p.waitForTimeout(400);
      F[tag].back = await p.evaluate(() => ({ deep: window.__night.deep, zoom: window.__night.view.zoom, sheet: window.__night.sheet }));
      // 一覧から（昼に開いて押すと、見やすい時刻へ移る）
      await p.click('#dsoBtn'); await p.waitForTimeout(200);
      F.shots.push(await shot(p, `4-dso-${tag}-list.png`));
      F[tag].errors = errors;
      await ctx.close();
    }
    const okOne = (o, id) => o.deep === id && o.sheet === 'dso' && o.zoom > 20 && /esahubble\.org\/images\//.test(o.href) && o.credit.length > 10;
    F.ok = ['phone', 'pc'].every((t) => ['m42', 'm45', 'm31'].every((id) => okOne(F[t][id], id)) && F[t].back.deep === null && F[t].back.zoom <= 3 && !F[t].errors.length);
    R.features[4] = F;
  }

  /* 5 星の軌跡: 早回し（600 倍）で光の筋が残る（北の空で北極星のまわり）。動きを減らす設定では止まった 1 枚 */
  if (want(5)) {
    const F = { shots: [] };
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const { ctx, p, errors } = await open(dev, `?probe=off&view=0,36${WINTER}`, { reducedMotion: 'no-preference' });
      await p.waitForTimeout(3800);   // 開いたときの演出の後
      const t0 = await p.evaluate(() => [window.__night.sim, performance.now()]);
      await p.click('#trailBtn');
      await p.waitForTimeout(tag === 'phone' ? 9000 : 7000);
      const t1 = await p.evaluate(() => [window.__night.sim, performance.now(), window.__night.trail, window.__night.trailFrames]);
      F[tag] = { speed: Math.round((t1[0] - t0[0]) / (t1[1] - t0[1])), trail: t1[2], frames: t1[3], errors };
      F.shots.push(await shot(p, `5-trail-${tag}-north.png`));
      await p.click('#trailBtn'); await p.waitForTimeout(300);
      F[tag].off = await p.evaluate(() => window.__night.trail);
      await ctx.close();
    }
    {
      const { ctx, p, errors } = await open(PHONE, `?probe=off&view=0,36${WINTER}`, { reducedMotion: 'reduce' });
      await p.click('#trailBtn'); await p.waitForTimeout(800);
      const a = await p.evaluate(() => window.__night.sim);
      const s1 = await p.screenshot(); await p.waitForTimeout(1200); const s2 = await p.screenshot();
      F.reduce = { still: Buffer.compare(s1, s2) === 0, simSame: a === await p.evaluate(() => window.__night.sim), toast: await p.evaluate(() => window.__night.toast), errors };
      F.shots.push(await shot(p, '5-trail-phone-reduced.png'));
      await ctx.close();
    }
    // 600 倍のうち、ボタンを押すまでは止まっている（共有の # で開くと止まった状態）ので、平均の倍率は 600 よりやや小さい
    F.ok = ['phone', 'pc'].every((t) => F[t].trail === true && F[t].frames > 20 && F[t].speed > 300 && F[t].off === false && !F[t].errors.length)
      && F.reduce.still && F.reduce.simSame && !F.reduce.errors.length;
    R.features[5] = F;
  }

  /* 6 双眼鏡・望遠鏡: 円い視野・拡大・暗い星（ヒッパルコス星表）を押したときに読む・限界等級が上がる。もう一度で望遠鏡、もう一度で肉眼 */
  if (want(6)) {
    const F = { shots: [] };
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const ctx = await ctxOf(dev, { reducedMotion: 'reduce' }), p = await ctx.newPage(), reqs = [], errors = [];
      p.on('request', (q) => reqs.push(q.url())); p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${base}?probe=off${WINTER}`); await ready(p); await p.waitForTimeout(400);
      const before = reqs.filter((u) => /render\/hip\.js/.test(u)).length;
      F[tag] = { alt: await p.evaluate(() => window.__night.lookAt(56.75, 24.12)) };   // すばる
      await p.click('#scopeBtn');
      await p.waitForFunction(() => window.__night.faint > 0, null, { timeout: 15000 }); await p.waitForTimeout(600);
      F[tag].bino = await p.evaluate(() => ({ scope: window.__night.scope, zoom: window.__night.view.zoom, faint: window.__night.faint, toast: window.__night.toast,
        mask: !document.getElementById('scopeMask').hidden, credit: !document.getElementById('hipCredit').hidden }));
      F.shots.push(await shot(p, `6-scope-${tag}-bino-m45.png`));
      await p.evaluate(() => window.__night.lookAt(83.82, -5.39));   // オリオン大星雲のあたり（望遠鏡）
      await p.click('#scopeBtn'); await p.waitForTimeout(500);
      F[tag].tele = await p.evaluate(() => ({ scope: window.__night.scope, zoom: window.__night.view.zoom, toast: window.__night.toast }));
      F.shots.push(await shot(p, `6-scope-${tag}-tele-orion.png`));
      await p.click('#scopeBtn'); await p.waitForTimeout(300);
      F[tag].off = await p.evaluate(() => ({ scope: window.__night.scope, zoom: window.__night.view.zoom, mask: !document.getElementById('scopeMask').hidden }));
      F[tag].hipBefore = before; F[tag].hipAfter = reqs.filter((u) => /render\/hip\.js/.test(u)).length; F[tag].errors = errors;
      await ctx.close();
    }
    F.ok = ['phone', 'pc'].every((t) => { const x = F[t]; return x.hipBefore === 0 && x.hipAfter === 1 && x.bino.scope === 'bino' && x.bino.faint > 50000 && x.bino.mask && x.bino.credit
      && x.bino.zoom > 10 && x.tele.scope === 'tele' && x.tele.zoom > 60 && x.off.scope === null && !x.off.mask && x.off.zoom <= 3 && !x.errors.length; });
    R.features[6] = F;
  }

  /* 7 イベントの再生: 一覧（次の皆既月食・流星群）→ 月食は月を追って 600 倍、動きを減らす設定は食の最大で止まる（赤い月）。流星群は放射点から流れ星 */
  if (want(7)) {
    const F = { shots: [] };
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      // 動きを減らす設定: 食の最大で止まった赤い月
      {
        const { ctx, p, errors } = await open(dev, '?probe=off', { reducedMotion: 'reduce' });
        await p.click('#eventBtn'); await p.waitForTimeout(300);
        F.shots.push(await shot(p, `7-event-${tag}-list.png`));
        F[tag] = { items: await p.evaluate(() => [...document.querySelectorAll('.evitem b')].map((e) => e.textContent)) };
        await p.click('.evitem button >> nth=0'); await p.waitForTimeout(900);
        F[tag].reduced = await p.evaluate(() => ({ ev: window.__night.event, sim: window.__night.sim, playing: window.__night.playing, ecl: window.__night.eclipse(), toast: window.__night.toast }));
        F.shots.push(await shot(p, `7-event-${tag}-eclipse-max.png`));
        F[tag].errorsR = errors; await ctx.close();
      }
      // 動きあり: 月食は月を追って進む、流星群は流れ星
      {
        const { ctx, p, errors } = await open(dev, '?probe=off', { reducedMotion: 'no-preference' });
        await p.evaluate(() => window.__night.playEvent(0)); await p.waitForTimeout(400);
        const a = await p.evaluate(() => [window.__night.sim, performance.now()]); await p.waitForTimeout(2500);
        const b = await p.evaluate(() => [window.__night.sim, performance.now(), window.__night.eclipse()]);
        F[tag].eclipseSpeed = Math.round((b[0] - a[0]) / (b[1] - a[1])); F[tag].moonPos = await p.evaluate(() => window.__night.where('moon'));
        F.shots.push(await shot(p, `7-event-${tag}-eclipse-play.png`));
        await p.evaluate(() => window.__night.playEvent(1)); await p.waitForTimeout(4000);
        F[tag].meteors = await p.evaluate(() => window.__night.evSpawned());
        F.shots.push(await shot(p, `7-event-${tag}-meteors.png`));
        await p.click('#evStop'); await p.waitForTimeout(200);
        F[tag].stopped = await p.evaluate(() => window.__night.event === null && document.getElementById('eventBar').hidden);
        F[tag].errors = errors; await ctx.close();
      }
    }
    const okT = (x) => x.items.length >= 2 && /皆既月食|Total lunar eclipse/.test(x.items[0]) && x.reduced.playing === false && x.reduced.ecl.sep < x.reduced.ecl.umbra - x.reduced.ecl.moonR
      && x.eclipseSpeed > 400 && x.meteors >= 3 && x.stopped && !x.errors.length && !x.errorsR.length;
    F.ok = okT(F.phone) && okT(F.pc);
    R.features[7] = F;
  }

  /* 8 日の出・日の入りの空の色: 東京 2026-12-15 の日の入り（16:31 ごろ）の前後を西南西に向けて。日の出（6:45 ごろ）は東南東。昼は青 */
  if (want(8)) {
    const F = { shots: [], frames: {} };
    const at = (iso) => Math.floor(Date.parse(iso) / 1000);
    const scenes = [['noon', '2026-12-15T12:00:00+09:00', '180,40'], ['sunset-plus3', '2026-12-15T16:05:00+09:00', '240,12'], ['sunset', '2026-12-15T16:30:00+09:00', '240,12'],
      ['dusk-minus4', '2026-12-15T16:52:00+09:00', '240,12'], ['dusk-minus9', '2026-12-15T17:15:00+09:00', '240,15'], ['sunrise', '2026-12-16T06:45:00+09:00', '118,12']];
    for (const [dev, tag] of [[PHONE, 'phone'], [PC, 'pc']]) {
      const { ctx, p, errors } = await open(dev, '?probe=off', { reducedMotion: 'reduce' });
      for (const [name, iso, view] of scenes) {
        await p.goto(`${base}?probe=off&view=${view}&s=${name}#35.69,139.69,${at(iso)}`); await ready(p); await p.waitForTimeout(500);
        const f = await shot(p, `8-sky-${tag}-${name}.png`); F.shots.push(f);
        F.frames[`${tag}-${name}`] = fs.statSync(f).size;
      }
      F[tag + 'Errors'] = errors; await ctx.close();
    }
    F.ok = !F.phoneErrors.length && !F.pcErrors.length && new Set(Object.values(F.frames)).size === Object.keys(F.frames).length;
    R.features[8] = F;
  }

  await browser.close(); srv.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 2));
  const ng = Object.entries(R.features).filter(([, f]) => !f.ok).map(([k]) => k);
  console.log(JSON.stringify(R, null, 1).slice(0, 4000));
  console.log(ng.length ? `NG: ${ng.join(', ')}` : 'すべて OK');
  if (ng.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
