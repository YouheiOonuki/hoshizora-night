/* 生成物・手で編集しない: YouheiOonuki/hoshizora-sanpo@76c59616be72931be0d94e312a06354cdfeb20cb の tools/official-events.js を tools/sync-from-sanpo.mjs で写した（確認日 2026-10-14、元の sha256 98694d04fa0d2ef9137c1933fd99f80c92f6771f428b7284beefbfbc0d5e6c8f） */
'use strict';
/* 天文カレンダーの「公的機関の発表」データ（手で入れる。推測で埋めない）
 *
 * ルール
 * - 1件ごとに出典（src: 下の SRC のキーまたは URL）を付ける。出典のない行はビルドでエラーになる
 * - 日時はすべて日本時間。時刻の分からないもの（「このころ」）は時刻を入れない
 * - 満月・新月・上弦・下弦は tests/calendar.test.js で自前の計算（Meeus）と突き合わせ、2分以上ずれたら失敗する
 * - 毎年2月に国立天文台が翌年の暦要項を、月ごとに「ほしぞら情報」を発表するので、それを見て足す
 * 確認日: CHECKED（この日に出典ページを見て書き写した）
 */
const CHECKED = '2026-09-23';
const CHECKED_QUARTERS = '2026-10-02'; // 上弦・下弦（MOON_QUARTERS）を暦要項から書き写した日

const SRC = {
  'rekiyou2026-moon': ['国立天文台 暦計算室「令和8年（2026）暦要項 朔弦望」', 'https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou263.html'],
  'rekiyou2027-moon': ['国立天文台 暦計算室「令和9年（2027）暦要項 朔弦望」', 'https://eco.mtk.nao.ac.jp/koyomi/yoko/2027/rekiyou273.html'],
  'rekiyou2026-eclipse': ['国立天文台 暦計算室「令和8年（2026）暦要項 日食・月食など」', 'https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou265.html'],
  'rekiyou2027-eclipse': ['国立天文台 暦計算室「令和9年（2027）暦要項 日食・月食など」', 'https://eco.mtk.nao.ac.jp/koyomi/yoko/2027/rekiyou275.html'],
  'eclipsedb': ['国立天文台 暦計算室「日月食等データベース」（2026〜2030年、中央標準時、日本付近での見え方）', 'https://eco.mtk.nao.ac.jp/cgi-bin/koyomi/eclipsedb.cgi'],
  'sky2026-09': ['国立天文台「ほしぞら情報 2026年9月」', 'https://www.nao.ac.jp/astro/sky/2026/09.html'],
  'sky2026-09-meigetsu': ['国立天文台「中秋の名月（2026年9月）」', 'https://www.nao.ac.jp/astro/sky/2026/09-topics03.html'],
  'sky2026-10': ['国立天文台「ほしぞら情報 2026年10月」', 'https://www.nao.ac.jp/astro/sky/2026/10.html'],
  'sky2026-11': ['国立天文台「ほしぞら情報 2026年11月」', 'https://www.nao.ac.jp/astro/sky/2026/11.html'],
  'sky2026-12': ['国立天文台「ほしぞら情報 2026年12月」', 'https://www.nao.ac.jp/astro/sky/2026/12.html'],
  'sky2026-12-geminids': ['国立天文台「ふたご座流星群が極大（2026年12月）」', 'https://www.nao.ac.jp/astro/sky/2026/12-topics02.html'],
  'sky2027-01': ['国立天文台「ほしぞら情報 2027年1月」', 'https://www.nao.ac.jp/astro/sky/2027/01.html'],
  'sky2027-01-quadrantids': ['国立天文台「しぶんぎ座流星群が極大（2027年1月）」', 'https://www.nao.ac.jp/astro/sky/2027/01-topics03.html'],
  'sky2027-02': ['国立天文台「ほしぞら情報 2027年2月」', 'https://www.nao.ac.jp/astro/sky/2027/02.html'],
  'sky2027-03': ['国立天文台「ほしぞら情報 2027年3月」', 'https://www.nao.ac.jp/astro/sky/2027/03.html'],
  'sky2027-04': ['国立天文台「ほしぞら情報 2027年4月」', 'https://www.nao.ac.jp/astro/sky/2027/04.html'],
  'sky2027-05': ['国立天文台「ほしぞら情報 2027年5月」', 'https://www.nao.ac.jp/astro/sky/2027/05.html'],
  'sky2027-07': ['国立天文台「ほしぞら情報 2027年7月」', 'https://www.nao.ac.jp/astro/sky/2027/07.html'],
  'sky2027-08': ['国立天文台「ほしぞら情報 2027年8月」', 'https://www.nao.ac.jp/astro/sky/2027/08.html'],
  'sky2027-09': ['国立天文台「ほしぞら情報 2027年9月」', 'https://www.nao.ac.jp/astro/sky/2027/09.html'],
  'sky2027-10': ['国立天文台「ほしぞら情報 2027年10月」', 'https://www.nao.ac.jp/astro/sky/2027/10.html'],
  'sky2027-11': ['国立天文台「ほしぞら情報 2027年11月」', 'https://www.nao.ac.jp/astro/sky/2027/11.html'],
  'sky2027-12': ['国立天文台「ほしぞら情報 2027年12月」', 'https://www.nao.ac.jp/astro/sky/2027/12.html'],
};

/* 新月（朔）・満月（望）[日時, 種類, 出典の年]。暦要項の表から機械的に書き出した */
const MOON_PHASES = [
  ['2026-09-27T01:49+09:00', 'full', 2026],
  ['2026-10-11T00:50+09:00', 'new', 2026],
  ['2026-10-26T13:12+09:00', 'full', 2026],
  ['2026-11-09T16:02+09:00', 'new', 2026],
  ['2026-11-24T23:54+09:00', 'full', 2026],
  ['2026-12-09T09:52+09:00', 'new', 2026],
  ['2026-12-24T10:28+09:00', 'full', 2026],
  ['2027-01-08T05:24+09:00', 'new', 2027],
  ['2027-01-22T21:17+09:00', 'full', 2027],
  ['2027-02-07T00:56+09:00', 'new', 2027],
  ['2027-02-21T08:24+09:00', 'full', 2027],
  ['2027-03-08T18:29+09:00', 'new', 2027],
  ['2027-03-22T19:44+09:00', 'full', 2027],
  ['2027-04-07T08:51+09:00', 'new', 2027],
  ['2027-04-21T07:27+09:00', 'full', 2027],
  ['2027-05-06T19:59+09:00', 'new', 2027],
  ['2027-05-20T19:59+09:00', 'full', 2027],
  ['2027-06-05T04:40+09:00', 'new', 2027],
  ['2027-06-19T09:44+09:00', 'full', 2027],
  ['2027-07-04T12:02+09:00', 'new', 2027],
  ['2027-07-19T00:45+09:00', 'full', 2027],
  ['2027-08-02T19:05+09:00', 'new', 2027],
  ['2027-08-17T16:29+09:00', 'full', 2027],
  ['2027-09-01T02:41+09:00', 'new', 2027],
  ['2027-09-16T08:04+09:00', 'full', 2027],
  ['2027-09-30T11:36+09:00', 'new', 2027],
  ['2027-10-15T22:47+09:00', 'full', 2027],
  ['2027-10-29T22:37+09:00', 'new', 2027],
  ['2027-11-14T12:26+09:00', 'full', 2027],
  ['2027-11-28T12:24+09:00', 'new', 2027],
  ['2027-12-14T01:09+09:00', 'full', 2027],
  ['2027-12-28T05:12+09:00', 'new', 2027],
].map(([at, type, y]) => ({ at, type, src: `rekiyou${y}-moon` }));

/* 上弦・下弦 [日時, 種類（first 上弦 / last 下弦）, 出典の年]。新月・満月と同じ暦要項の朔弦望の表から機械的に書き出した（2026-10-02）。
 * ページの一覧には出さず、カレンダーの購読（data/tenmon.ics）の「朔弦望」に使う */
const MOON_QUARTERS = [
  ['2026-10-03T22:25+09:00', 'last', 2026],
  ['2026-10-19T01:13+09:00', 'first', 2026],
  ['2026-11-02T05:28+09:00', 'last', 2026],
  ['2026-11-17T20:48+09:00', 'first', 2026],
  ['2026-12-01T15:09+09:00', 'last', 2026],
  ['2026-12-17T14:43+09:00', 'first', 2026],
  ['2026-12-31T03:59+09:00', 'last', 2026],
  ['2027-01-16T05:35+09:00', 'first', 2027],
  ['2027-01-29T19:55+09:00', 'last', 2027],
  ['2027-02-14T16:58+09:00', 'first', 2027],
  ['2027-02-28T14:17+09:00', 'last', 2027],
  ['2027-03-16T01:25+09:00', 'first', 2027],
  ['2027-03-30T09:54+09:00', 'last', 2027],
  ['2027-04-14T07:57+09:00', 'first', 2027],
  ['2027-04-29T05:18+09:00', 'last', 2027],
  ['2027-05-13T13:44+09:00', 'first', 2027],
  ['2027-05-28T22:58+09:00', 'last', 2027],
  ['2027-06-11T19:56+09:00', 'first', 2027],
  ['2027-06-27T13:54+09:00', 'last', 2027],
  ['2027-07-11T03:39+09:00', 'first', 2027],
  ['2027-07-27T01:55+09:00', 'last', 2027],
  ['2027-08-09T13:54+09:00', 'first', 2027],
  ['2027-08-25T11:27+09:00', 'last', 2027],
  ['2027-09-08T03:31+09:00', 'first', 2027],
  ['2027-09-23T19:20+09:00', 'last', 2027],
  ['2027-10-07T20:47+09:00', 'first', 2027],
  ['2027-10-23T02:29+09:00', 'last', 2027],
  ['2027-11-06T17:00+09:00', 'first', 2027],
  ['2027-11-21T09:48+09:00', 'last', 2027],
  ['2027-12-06T14:22+09:00', 'first', 2027],
  ['2027-12-20T18:11+09:00', 'last', 2027],
].map(([at, type, y]) => ({ at, type, src: `rekiyou${y}-moon` }));

/* 満月に添える注記（ほしぞら情報）。en は英語版（en/calendar/）の表記。日付・時刻は持たせない（上のデータから取る） */
const MOON_NOTES = [
  { date: '2026-12-24', note: '2026年で地球に最も近い満月', en: 'Closest full moon of 2026', src: 'sky2026-12' },
  { date: '2027-01-22', note: '2027年で地球に最も近い満月', en: 'Closest full moon of 2027', src: 'sky2027-01' },
  { date: '2027-07-19', note: '2027年で地球から最も遠い満月', en: 'Farthest full moon of 2027', src: 'sky2027-07' },
];

/* お月見（国立天文台が二十四節気と朔から求めた日付） */
const MOON_VIEWING = [
  { date: '2026-09-25', name: '中秋の名月', note: '満月（9月27日）と日付が2日ずれる', en: 'Two days before the full moon (Sep 27)', src: 'sky2026-09-meigetsu' },
  { date: '2026-10-23', name: '十三夜', src: 'sky2026-09-meigetsu' },
  { date: '2027-09-15', name: '中秋の名月', note: '満月は翌16日', en: 'The full moon is the next day (Sep 16)', src: 'sky2027-09' },
];

/* 流星群の極大（ほしぞら情報。極大日時は IMO の予報にもとづく）
 * peak: 極大日時（「このころ」は日付だけ）／best・rate・moon: ほしぞら情報の見頃・流星数のめやす・月の条件
 * view: 「この日の星空を見る」で開く時刻（best の時間帯から選んだ例。極大日時ではない） */
const METEOR_PEAKS = [
  { shower: 'orionids', peak: '2026-10-22', best: '極大を中心とした前後数日間の夜半から未明', rate: '1時間に5〜10個程度', moon: '未明に月が沈んだ後は条件が良い', view: '2026-10-23T03:00+09:00', src: 'sky2026-10' },
  { shower: 'taurids-s', peak: '2026-11-06', best: '11月上旬で、ほぼ一晩中見える', rate: '1時間に2〜3個程度', moon: '夜半前は月の条件が良い', view: '2026-11-06T22:00+09:00', src: 'sky2026-11' },
  { shower: 'taurids-n', peak: '2026-11-13', best: '11月上旬から中旬で、ほぼ一晩中見える', rate: '1時間に2個程度', moon: '月の条件は比較的良い', view: '2026-11-13T22:00+09:00', src: 'sky2026-11' },
  { shower: 'leonids', peak: '2026-11-18T09:00+09:00', best: '11月18日未明', rate: '1時間に5個程度', moon: '月の条件は良い', view: '2026-11-18T04:00+09:00', src: 'sky2026-11' },
  { shower: 'geminids', peak: '2026-12-14T23:00+09:00', best: '14日深夜から15日未明（最も多いのは15日0時から2時ごろ）', rate: '1時間に60個程度', moon: '月明かりがなく、極大時刻も良いため絶好の条件', view: '2026-12-15T01:00+09:00', src: 'sky2026-12-geminids' },
  { shower: 'quadrantids', peak: '2027-01-04T12:00+09:00', best: '4日未明（最も多いのは5時ごろ）', rate: '1時間に15〜20個程度', moon: '月の条件は良い。流星数は年による当たり外れが大きい', view: '2027-01-04T05:00+09:00', src: 'sky2027-01-quadrantids' },
  { shower: 'lyrids', peak: '2027-04-23T11:00+09:00', best: '23日未明', rate: '1時間に5個程度', moon: '月が明るく条件は悪い', view: '2027-04-23T03:00+09:00', src: 'sky2027-04' },
  { shower: 'eta-aquariids', peak: '2027-05-07T00:00+09:00', best: '6日〜8日の未明', rate: '1時間に5〜10個程度', moon: '月明かりがなく絶好の条件', view: '2027-05-07T03:30+09:00', src: 'sky2027-05' },
  { shower: 'delta-aquariids-s', peak: '2027-08-01', best: '極大を中心とした数日間の深夜から未明', rate: '1時間に5個程度', moon: '月の条件は良い', view: '2027-08-02T01:00+09:00', src: 'sky2027-08' },
  { shower: 'perseids', peak: '2027-08-13T17:00+09:00', best: '14日未明', rate: '1時間に35個程度', moon: '未明に月が沈んだ後は条件が良い', view: '2027-08-14T03:00+09:00', src: 'sky2027-08' },
  { shower: 'orionids', peak: '2027-10-22', best: '極大を中心とした前後数日間の夜半から未明', rate: '1時間に3〜5個程度', moon: '月が明るく条件は悪い', view: '2027-10-23T03:00+09:00', src: 'sky2027-10' },
  { shower: 'taurids-s', peak: '2027-11-06', best: '11月上旬で、ほぼ一晩中見える', rate: '1時間に3〜4個程度', moon: '夜半後は月の条件が良い', view: '2027-11-07T02:00+09:00', src: 'sky2027-11' },
  { shower: 'taurids-n', peak: '2027-11-13', best: '11月上旬から中旬で、ほぼ一晩中見える', rate: '1時間に1〜2個程度', moon: '月が明るく条件は悪い', view: '2027-11-13T22:00+09:00', src: 'sky2027-11' },
  { shower: 'leonids', peak: '2027-11-18T15:00+09:00', best: '18日未明と19日未明', rate: '1時間に3〜5個程度', moon: '月が明るく条件は悪い', view: '2027-11-18T04:00+09:00', src: 'sky2027-11' },
  { shower: 'geminids', peak: '2027-12-15T05:00+09:00', best: '14日深夜から15日未明', rate: '1時間に25個程度', moon: '月がたいへん明るく悪条件', view: '2027-12-15T01:00+09:00', src: 'sky2027-12' },
];

/* 日食・月食。暦要項（詳しい時刻つき）と日月食等データベース（日付と日本付近での見え方）
 * japan: 'visible' 見える / 'none' 見えない / 'central' 中心食（金環・皆既が見られる地域がある）
 * 半影月食は暦要項と同じく含めない */
const ECLIPSES = [
  { date: '2026-03-03', body: 'moon', type: '皆既月食', japan: 'visible', src: 'rekiyou2026-eclipse',
    tokyo: { start: '18:49.8', totalStart: '20:04.0', max: '20:33.7', totalEnd: '21:03.4', end: '22:17.6', mag: '1.156' },
    note: '日本では全国で皆既食が見られた', en: 'Totality was visible across Japan' },
  { date: '2026-08-13', body: 'sun', type: '皆既日食', japan: 'none', src: 'rekiyou2026-eclipse' },
  { date: '2026-08-28', body: 'moon', type: '部分月食', japan: 'none', src: 'rekiyou2026-eclipse' },
  { date: '2027-02-07', dateLabel: '2027年2月6〜7日', body: 'sun', type: '金環日食', japan: 'none', src: 'rekiyou2027-eclipse' },
  { date: '2027-08-02', body: 'sun', type: '皆既日食', japan: 'none', src: 'rekiyou2027-eclipse' },
  { date: '2028-01-12', body: 'moon', type: '部分月食', japan: 'none', src: 'eclipsedb' },
  { date: '2028-01-27', body: 'sun', type: '金環日食', japan: 'none', src: 'eclipsedb' },
  { date: '2028-07-07', body: 'moon', type: '部分月食', japan: 'visible', src: 'eclipsedb' },
  { date: '2028-07-22', body: 'sun', type: '皆既日食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-01-01', body: 'moon', type: '皆既月食', japan: 'visible', src: 'eclipsedb' },
  { date: '2029-01-15', body: 'sun', type: '部分日食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-06-12', body: 'sun', type: '部分日食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-06-26', body: 'moon', type: '皆既月食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-07-12', body: 'sun', type: '部分日食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-12-06', body: 'sun', type: '部分日食', japan: 'none', src: 'eclipsedb' },
  { date: '2029-12-21', body: 'moon', type: '皆既月食', japan: 'visible', src: 'eclipsedb' },
  { date: '2030-06-01', body: 'sun', type: '金環日食', japan: 'central', src: 'eclipsedb' },
  { date: '2030-06-16', body: 'moon', type: '部分月食', japan: 'visible', src: 'eclipsedb' },
  { date: '2030-11-25', body: 'sun', type: '皆既日食', japan: 'none', src: 'eclipsedb' },
];

/* 惑星の見ごろ（ほしぞら情報のカレンダー）。天王星・海王星は肉眼で見えないので入れない
 * kind: 'opposition' 衝 / 'elong-east' 東方最大離角（夕方の西の空）/ 'elong-west' 西方最大離角（明け方の東の空）/ 'brightest' 最大光度 */
const PLANET_EVENTS = [
  { date: '2026-10-04', planet: 'saturn', kind: 'opposition', src: 'sky2026-10' },
  { date: '2026-10-12', planet: 'mercury', kind: 'elong-east', src: 'sky2026-10' },
  { date: '2026-11-21', planet: 'mercury', kind: 'elong-west', src: 'sky2026-11' },
  { date: '2026-11-30', planet: 'venus', kind: 'brightest', note: 'マイナス4.9等', en: 'magnitude −4.9', src: 'sky2026-11' },
  { date: '2027-01-04', planet: 'venus', kind: 'elong-west', src: 'sky2027-01' },
  { date: '2027-02-03', planet: 'mercury', kind: 'elong-east', src: 'sky2027-02' },
  { date: '2027-02-11', planet: 'jupiter', kind: 'opposition', src: 'sky2027-02' },
  { date: '2027-02-20', planet: 'mars', kind: 'opposition', note: '同じ日に地球に最接近', en: 'Closest to Earth the same day', src: 'sky2027-02' },
  { date: '2027-03-17', planet: 'mercury', kind: 'elong-west', src: 'sky2027-03' },
  { date: '2027-05-28', planet: 'mercury', kind: 'elong-east', src: 'sky2027-05' },
  { date: '2027-07-16', planet: 'mercury', kind: 'elong-west', src: 'sky2027-07' },
  { date: '2027-09-25', planet: 'mercury', kind: 'elong-east', src: 'sky2027-09' },
  { date: '2027-10-18', planet: 'saturn', kind: 'opposition', src: 'sky2027-10' },
  { date: '2027-11-04', planet: 'mercury', kind: 'elong-west', src: 'sky2027-11' },
];

/* データがそろっている期間（これより先は暦要項・ほしぞら情報の発表を待って足す） */
const COVERAGE = { from: '2026-09-23', to: '2027-12-31' };

module.exports = { CHECKED, CHECKED_QUARTERS, SRC, MOON_PHASES, MOON_QUARTERS, MOON_NOTES, MOON_VIEWING, METEOR_PEAKS, ECLIPSES, PLANET_EVENTS, COVERAGE };
