# ほしぞらさんぽ フル版

公開 URL: **https://yorozu-craft.com/hoshizora-night/**（英語 `/hoshizora-night/en/`）。公開の目標は 2026 年 11 月中（ROADMAP 7.15.1）

星空さんぽ（[hoshizora-sanpo](https://github.com/YouheiOonuki/hoshizora-sanpo)）と同じ機能・同じ計算で、見せ方だけを作り込んだ重くてよい版。広告なし。日英。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。
要件は yorozu-plans の `docs/ROADMAP.md` 7.15（K132）と、方向（試し描き A）を決めた設計 7.15.1 の 10 項目。企画書は yorozu-plans の `docs/58_星空さんぽフル版.md`。

## 機能

- 濃紺の空（天頂 `#050a1e` → 地平線 `#1b2a52`、薄明は地平線だけ `#3a4a7a` へ 20 分で）、地面 `#060810`、加算合成でにじむ星（半径は等級で 10・7.5・5・3.5・2.5・1.8・1.4 px、1.5 等より明るい星は外側にもう一段の光、色は B−V から彩度 35% まで。オーナー決定 2026-10-03 で 7.15.1 の 6・4・3・2・1.5 px・20% から変えた）
- 星は 6.5 等まで: 通常版の星表（`engine/catalog.js`、5.6 等まで）に、追加の星表 `render/catalog-extra.js`（5.6 等より暗く 6.5 等まで 5,155 個。同じ Yale BSC5 の JSON から `tools/build-catalog-extra.cjs` で作る生成物）を足して描く。通常版の星表は変えない（突き合わせはそのまま）
- 天の川: 通常版の `data.js` の中心線（`MW`）からの距離で濃さを決め、3 次元のノイズでむらを付けて空の画素ごとに描く（新しいデータは持たない）。月が出ていると薄くなる。4 等までに絞った段階では描かない
- 開いたとき 1 回だけ、夕方の空から夜へ 3.5 秒で暗くなり、星が明るい順に灯る。流れ星は平均 30 秒に 1 本（その夜が流星群の極大なら 10 秒）。どちらも `prefers-reduced-motion` では無し
- 地平線に淡い山並みのシルエット（方位の滑らかな関数。山の後ろの星は描かない）。星座線を全部出す切り替え（星座名も出す。既定はタップした星座だけ）
- 日周運動（1 秒 ＝ 1 分）・24 時間のつまみ・止める／いま。3 等より明るい星だけまたたく（±10%、0.5〜1 Hz）。`prefers-reduced-motion` なら止めた状態で開き、またたかない
- ドラッグで見回す・ピンチ（とホイール）で 1〜3 倍・星をタップで名前と星座線（`#8fb0ff`・30%・1 秒でフェード）。月は満ち欠けつき、惑星も点で
- 場所は位置情報（0.1° に丸める）か都道府県庁 47 か所の一覧（`render/prefectures.js`）。英語版は通常版の英語と同じ世界の都市も。画面には場所の名前、位置情報なら最寄りの都道府県庁＋「付近」（150 km より遠ければ出さない）と緯度経度を出す
- 今夜の見どころ（その夜の流星群の極大・満月・惑星。3 件まで）を右上に。`engine/official-events.js`（通常版の写し）から、文は官製の表の語
- 「共有」で `/hoshizora-night/m/<月>/#lat,lon,unixtime` の URL（月ごとのページは OG 画像がその月。開くとその瞬間で止まる）。通常版と同じ `?t=<日時>&loc=<場所>` でも開ける
- 最初の 3 秒の fps の中央値が 24 未満なら 4 等までに絞り、それでも 24 未満なら通常版へのリンクを画面の中央に出す（`?probe=off` で測らない。スクショ・計測用）
- 土台のまま残すもの: WebGL の技術確認（`tech/`）、試し描き 3 枚（`sketches/`）
- WebGL が使えない端末では通常版（`/hoshizora-sanpo/`、英語の画面なら `/hoshizora-sanpo/en/`）へ送る
- 入力（場所・時刻）は端末の外に出さない。保存（localStorage）は使わない（場所と時刻は URL の `#` だけ）。広告なし（AdSense は所有確認の meta だけ）・音なし

## 計算と星表は通常版から写す（手で分岐させない）

`engine/astro.js`・`engine/catalog.js`・`engine/data.js` は通常版の同名のファイル、`engine/official-events.js` は通常版の `tools/official-events.js` の**生成物**。手で編集しない。
`--check` は、「今夜の見どころ」の流星群の名前（`render/look.js` の `SHOWERS`）が通常版の `tools/calendar-pages.js`・`calendar-pages-en.js` と同じかも確かめる。

| やること | コマンド |
|---|---|
| 通常版の main の最新を写す | `node tools/sync-from-sanpo.mjs`（手元にクローンがあれば `SANPO_DIR=../hoshizora-sanpo` を付けると速い） |
| 写しが元と 1 バイトも違わないか確かめる | `node tools/sync-from-sanpo.mjs --check`（CI でも走る。通常版の main が進んでいれば知らせる） |

- 各ファイルの先頭 1 行に、写し元のコミット・確認日・元の sha256 を書く。2 行目以降は元と同じ
- `engine/SOURCE.json` に同じ情報（`commit`・`checked`・各ファイルの `sha256`）
- `tests/engine.test.js` が、先頭行と SOURCE.json の食い違い・手での書き換え（sha256 の不一致）を見つける

## 座標の流れ（通常版との違い）

- 通常版: 星ごとに `precessor` → `altAz`（CPU で 1 個ずつ）
- フル版: 星の J2000 の単位ベクトルを GPU に置き、毎フレーム 3×3 の行列を 1 つ渡す（`render/sky.js`）。行列は `astro.precessor` と `astro.lstRad` から作り、式や定数を持たない
- `tests/match.test.js`: 時刻 5 × 場所 2（東京・シドニー）の 10 点で、星表の全星・星座の星・太陽・月・惑星の方位と高度の差が 0.1° 以内（GPU と同じ 32 ビットに丸めた場合も）。わざと 1 分ずらすと外れることも確かめる

## WebGL の技術確認

`NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=<ブラウザの置き場> node tools/measure-webgl.cjs [出力先]`

- `tech/` の fps（390×844・DPR 3 と 1280×800・DPR 1）。ヘッドレスの Chromium はソフトウェア描画（SwiftShader）なので**参考値**。実機の値ではない
- WebGL を切ったブラウザで `tech/`・`sketches/` を開くと `/hoshizora-sanpo/` に送られるか
- 試し描き 3 枚のスクショ（`?t=秒` でその瞬間に止めて撮る）
- iPhone Safari・Android Chrome の実機での確認はオーナー（公開の条件。ROADMAP 7.15 の要件 3）

## 確かめ方（ROADMAP 7.15.1 の受け入れ）

| 受け入れ | どこで |
|---|---|
| 同じ星の突き合わせ 0.1° 以内 | `tests/match.test.js` |
| `prefers-reduced-motion` で日周運動とまたたきが止まる | `tools/check-k132.cjs`（2） |
| 広告・外向きの要求なし | `tests/pages.test.js`（script とコード）・`tools/check-k132.cjs`（3。Cloudflare のビーコンだけ） |
| 英語の UI 文字列 20 語以内 | `tests/look.test.js`・`tests/pages.test.js`（画面の文字がすべて `TEXT.en` のもの） |
| OG 画像 12 枚 | `tests/pages.test.js` |
| 通常版と相互リンク | `tests/pages.test.js`（こちら側）。通常版の「フル版を見る」は hoshizora-sanpo 側 |
| JS 600 KB（gzip）・画像 1 MB | `tests/pages.test.js` |
| fps が低い端末の段階 | `tests/look.test.js`（決まり）・`tools/check-k132.cjs`（4。CPU を 20 倍遅くする） |
| iPhone で表示崩れなし | `tools/check-k132.cjs`（1。WebKit が無いので Chromium に iPhone 13 の設定） |
| Android 実機で fps 中央値 30 以上 | オーナー（`/hoshizora-night/?probe=off&fps=show` を開くと、左下に 3 秒ごとの fps・これまでの中央値（回数）が出る） |

`NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=<ブラウザの置き場> node tools/check-k132.cjs [出力先]`

## 試し描き（`sketches/`）

各 1 画面。配色・星の描き方・動きの 3 つだけを変え、文は入れない。時刻と場所は 3 枚とも同じ（東京、2027-01-15 21:00）。方向を選ぶのはオーナー。

| | 配色 | 星の描き方 | 動き |
|---|---|---|---|
| `a.html` | 濃紺 | にじむ光点（B−V の色） | 日周運動（1 恒星日を 120 秒） |
| `b.html` | 生成りに墨 | 硬い点・全天の円 | 明るい星から順に灯る（6 秒） |
| `c.html` | 黒と金 | 光芒の十字 | 地平近くがまたたく |

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 通常版の `astro.js`・`catalog.js`・`data.js`・`tools/official-events.js` が変わったとき（CI の「お知らせ」） | 写し直して tests が通るか（見どころは通常版が国立天文台の発表を足すと増える） | `node tools/sync-from-sanpo.mjs` → `node --test tests/*.test.js` |
| 画面の文字・`<head>` を変えるとき | 26 枚のページをひな形から作り直す | `tools/build-pages.mjs` を直して `node tools/build-pages.mjs` |
| 見せ方を変えたとき | OG 画像 12 枚を撮り直し、受け入れを確かめる | `node tools/build-og.cjs`・`node tools/check-k132.cjs`（下の「確かめ方」） |
| 都道府県庁が移ったとき（まれ） | 住所を地理院地図の住所検索で引き直す | `render/prefectures.js` |

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` / `en/index.html` | 入口（日英。検索に出す。`tools/build-pages.mjs` の生成物） |
| `m/01/`〜`m/12/`・`en/m/01/`〜`en/m/12/` | 共有の URL（中身は入口と同じ。OG 画像がその月。noindex・canonical は入口。生成物） |
| `sitemap.xml` | 入口の日英（hreflang つき。生成物） |
| `app/night.js` | 画面（操作・時刻・場所・共有・fps の段階） |
| `render/look.js` | 見せ方の決まり（7.15.1 の数値）・今夜の見どころ・#・UI の文字列（日英） |
| `render/night-gl.js` | フル版の描画器（空・星・惑星・月・星座線）。K43 のポスターもこれを大きな canvas に向けて出す設計 |
| `render/prefectures.js` | 都道府県庁 47 か所（出典と確認日はファイルの冒頭） |
| `render/catalog-extra.js` | 追加の星表（5.6〜6.5 等、5,155 個。生成物。出典はファイルの冒頭） |
| `og/01.jpg`〜`12.jpg`・`og/og.json` | 共有用の画像（1200×630。東京・各月 15 日 21 時の南の空。文字は URL だけなので K124 の結果カードと共用できる） |
| `engine/` | 通常版から写した計算と星表（生成物）と `SOURCE.json` |
| `render/sky.js` | 星の位置の行列（GPU 向け。計算は engine を呼ぶだけ） |
| `render/gl-stars.js` | 星を WebGL の点で描く最小の描画器 |
| `render/gate.js` | WebGL が無いときに通常版へ送る |
| `tech/index.html` | WebGL の技術確認（星表 3,249 点を回す。fps を表示） |
| `sketches/` | 試し描き 3 枚 |
| `night.css` | 見た目（フル版の画面・試し描き・技術確認） |
| `tools/sync-from-sanpo.mjs` | 通常版から engine/ に写す・写しを確かめる |
| `tools/measure-webgl.cjs` | 土台のときの fps・通常版への送り・試し描きのスクショ（Playwright） |
| `tools/build-pages.mjs` | ページ 26 枚と sitemap をひな形から作る（`--check` で古いものを知らせる） |
| `tools/build-og.cjs` | OG 画像 12 枚を描画器で撮る（`--json` で og.json だけ） |
| `tools/build-catalog-extra.cjs` | 追加の星表を作る（同じ元データから 5.6 等までを取ると `engine/catalog.js` と一致することを確かめてから書く） |
| `tools/check-k132.cjs` | 受け入れの確かめ（iPhone の表示・reduced motion・外向きの要求・fps の段階・WebGL 無し・共有・位置情報の拒否） |
| `tools/serve.cjs` | 手元の確かめ用のサーバー（本番と同じ形の URL） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` | アイコン（通常版と同じ） |
| `apple-touch-icon.png` | テンプレートの仮の絵（公開までに作り直す） |
| `tests/*.test.js` | テスト（`node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに自動実行） |

## ライセンス

MIT License（`LICENSE`）。星表は Yale Bright Star Catalogue, 5th Revised Ed.（Hoffleit & Warren 1991）から通常版が作ったもの（`engine/catalog.js` の冒頭）。
