// 把构建产物发布成 gh-pages 分支的内容：一个只有一次提交的新仓库，强制推上去。
// 每次发布都是全新的一次提交，分支不会越积越大，也不会留下旧版本。
//
// 用法：node tools/publish-pages.mjs <产物目录> [远程地址]
//   远程地址默认从环境变量拼出（GITHUB_REPOSITORY + GITHUB_TOKEN，只在 CI 里有）；
//   本地试验时传一个本地仓库的路径，不会碰真的远程。
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [dir, remoteArg] = process.argv.slice(2);
if (!dir) {
  console.error('用法：node tools/publish-pages.mjs <产物目录> [远程地址]');
  process.exit(1);
}

const { GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_TOKEN } = process.env;
const remote = remoteArg ?? (GITHUB_REPOSITORY && GITHUB_TOKEN ? `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git` : null);
if (!remote) {
  console.error('没有远程地址：在 CI 里需要 GITHUB_REPOSITORY 和 GITHUB_TOKEN，本地请把远程地址作为第二个参数传进来');
  process.exit(1);
}
const short = (GITHUB_SHA ?? 'local').slice(0, 7);

// 复制到临时目录再改：不动 dist/web，本地构建的结果不被污染
const work = mkdtempSync(join(tmpdir(), 'pages-'));
cpSync(resolve(dir), work, { recursive: true });

// 给脚本加版本参数：手机浏览器会缓存 game.js，不加的话发布了新版本也可能还在跑旧的
const indexPath = join(work, 'index.html');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('src="game.js"')) throw new Error('index.html 里没有找到 <script src="game.js">，不知道往哪里加版本参数');
writeFileSync(indexPath, html.replace('src="game.js"', `src="game.js?v=${short}"`));
// 页面上看不到版本，试玩时对不上哪一版就看这个文件
writeFileSync(join(work, 'version.txt'), `${short} ${new Date().toISOString()}\n`);
// 不让 GitHub 当成 Jekyll 站点处理
writeFileSync(join(work, '.nojekyll'), '');

const git = (...args) => execFileSync('git', args, { cwd: work, stdio: ['ignore', 'inherit', 'inherit'] });
git('init', '-q', '-b', 'gh-pages');
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('add', '-A');
git('commit', '-q', '-m', `试玩版 ${short}`);
git('push', '-q', '--force', remote, 'gh-pages');
console.log(`✓ 已发布 ${short} 到 gh-pages`);
