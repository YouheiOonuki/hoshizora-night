# ほしぞらさんぽ フル版

公開 URL: **https://yorozu-craft.com/hoshizora-night/**（準備中。2027 年 1 月公開の予定）

星空さんぽ（[hoshizora-sanpo](https://github.com/YouheiOonuki/hoshizora-sanpo)）と同じ機能・同じ計算で、見せ方だけを作り込んだ重くてよい版。広告なし。日英。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。
要件は yorozu-plans の `docs/ROADMAP.md` 7.15（K132）。今あるのは土台だけ（7.14 の 9）で、見せ方はまだ作っていない。

## 機能

- 今は土台だけ: 通常版の計算と星表の取り込み、同じ星が同じ位置に出ることの突き合わせ、WebGL の技術確認（`tech/`）、試し描き 3 枚（`sketches/`）
- WebGL が使えない端末では通常版（`/hoshizora-sanpo/`、英語の画面なら `/hoshizora-sanpo/en/`）へ送る
- 入力（場所・時刻）は端末の外に出さない。保存（localStorage）はまだ使っていない

## 計算と星表は通常版から写す（手で分岐させない）

`engine/astro.js`・`engine/catalog.js`・`engine/data.js` は通常版の同名のファイルの**生成物**。手で編集しない。

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
| 通常版の `astro.js`・`catalog.js`・`data.js` が変わったとき（CI の「お知らせ」） | 写し直して tests が通るか | `node tools/sync-from-sanpo.mjs` → `node --test tests/*.test.js` |

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` | 入口（準備中。noindex） |
| `engine/` | 通常版から写した計算と星表（生成物）と `SOURCE.json` |
| `render/sky.js` | 星の位置の行列（GPU 向け。計算は engine を呼ぶだけ） |
| `render/gl-stars.js` | 星を WebGL の点で描く最小の描画器 |
| `render/gate.js` | WebGL が無いときに通常版へ送る |
| `tech/index.html` | WebGL の技術確認（星表 3,249 点を回す。fps を表示） |
| `sketches/` | 試し描き 3 枚 |
| `night.css` | 全画面の canvas と案内の最小限の見た目 |
| `tools/sync-from-sanpo.mjs` | 通常版から engine/ に写す・写しを確かめる |
| `tools/measure-webgl.cjs` | fps・通常版への送り・スクショ（Playwright） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` | アイコン（通常版と同じ） |
| `apple-touch-icon.png` / `og-image.png` | テンプレートの仮の絵（公開までに作り直す） |
| `tests/*.test.js` | テスト（`node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに自動実行） |

## ライセンス

MIT License（`LICENSE`）。星表は Yale Bright Star Catalogue, 5th Revised Ed.（Hoffleit & Warren 1991）から通常版が作ったもの（`engine/catalog.js` の冒頭）。
