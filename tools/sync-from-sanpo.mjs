// 通常版（hoshizora-sanpo）の計算と星表を engine/ に写す。手で分岐させないための唯一の入口。
//
//   node tools/sync-from-sanpo.mjs            通常版の main の最新を写す（engine/*.js と engine/SOURCE.json を書き直す）
//   node tools/sync-from-sanpo.mjs --ref <sha> その版を写す
//   node tools/sync-from-sanpo.mjs --check    写しが SOURCE.json の版の元と 1 バイトも違わないかを確かめる（違えば終了コード 1）
//                                             あわせて、通常版の main が先に進んでいれば知らせる（失敗にはしない）
//
// 写し元: 環境変数 SANPO_DIR にクローンがあれば `git show <sha>:<file>`、無ければ GitHub から取る。
// 写しの先頭 1 行だけが生成の印（写し元のコミット・確認日・元の sha256）。2 行目以降は元と同じ。
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FILES = ['astro.js', 'catalog.js', 'data.js'];
export const REPO = 'YouheiOonuki/hoshizora-sanpo';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'engine');

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 写しの先頭行。1 行に収める（2 行目以降を元と比べるため） */
export function headerLine(file, commit, checked, hash) {
  return `/* 生成物・手で編集しない: ${REPO}@${commit} の ${file} を tools/sync-from-sanpo.mjs で写した（確認日 ${checked}、元の sha256 ${hash}） */\n`;
}

/** 写しから先頭行を外して元の中身に戻す */
export function stripHeader(text) {
  const i = text.indexOf('\n');
  if (!text.startsWith('/* 生成物・手で編集しない: ') || i < 0) throw new Error('生成の印（先頭行）がありません');
  return text.slice(i + 1);
}

function sanpoDir() {
  const d = process.env.SANPO_DIR;
  return d && fs.existsSync(path.join(d, '.git')) ? d : null;
}

async function resolveRef(ref) {
  const dir = sanpoDir();
  if (dir) {
    try { execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin'], { stdio: 'ignore' }); } catch { /* オフラインなら手元のまま */ }
    return execFileSync('git', ['-C', dir, 'rev-parse', ref === 'main' ? 'origin/main' : ref]).toString().trim();
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return (await r.json()).sha;
}

async function readSource(commit, file) {
  const dir = sanpoDir();
  if (dir) return execFileSync('git', ['-C', dir, 'show', `${commit}:${file}`], { maxBuffer: 1 << 26 }).toString('utf8');
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/${file}`);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return await r.text();
}

const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function sync(ref) {
  const commit = await resolveRef(ref);
  const checked = todayJst();
  const files = {};
  fs.mkdirSync(ENGINE, { recursive: true });
  for (const f of FILES) {
    const src = await readSource(commit, f);
    const hash = sha256(src);
    fs.writeFileSync(path.join(ENGINE, f), headerLine(f, commit, checked, hash) + src);
    files[f] = { sha256: hash, bytes: Buffer.byteLength(src) };
  }
  const meta = { repo: REPO, commit, checked, files };
  fs.writeFileSync(path.join(ENGINE, 'SOURCE.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`写しました: ${REPO}@${commit.slice(0, 7)}（確認日 ${checked}）`);
}

async function check() {
  const meta = JSON.parse(fs.readFileSync(path.join(ENGINE, 'SOURCE.json'), 'utf8'));
  let ng = 0;
  for (const f of FILES) {
    const body = stripHeader(fs.readFileSync(path.join(ENGINE, f), 'utf8'));
    const src = await readSource(meta.commit, f);
    const ok = body === src && sha256(src) === meta.files[f].sha256;
    if (!ok) ng++;
    console.log(`${ok ? 'OK ' : 'NG '} ${f}  ${REPO}@${meta.commit.slice(0, 7)} と${ok ? '一致' : '不一致'}`);
  }
  try {
    const latest = await resolveRef('main');
    if (latest !== meta.commit) console.log(`お知らせ: 通常版の main は ${latest.slice(0, 7)} に進んでいます。node tools/sync-from-sanpo.mjs で写し直し、tests を通してください`);
    else console.log('通常版の main と同じ版です');
  } catch (e) { console.log(`お知らせ: main の最新を確かめられませんでした（${e.message}）`); }
  if (ng) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--ref');
  (args.includes('--check') ? check() : sync(i >= 0 ? args[i + 1] : 'main')).catch((e) => { console.error(e.message); process.exit(1); });
}
