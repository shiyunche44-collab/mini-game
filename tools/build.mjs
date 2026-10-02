// 打包：用 esbuild 把入口打成一个 IIFE 文件，放进 dist/<平台>/。
//
// 用法：
//   node tools/build.mjs web            生产构建（压缩）
//   node tools/build.mjs web --serve    开发：监听改动自动重新打包，并起一个本地服务（端口默认 8000，可用 PORT 改）
// 平台：web、wechat、douyin。微信、抖音的产物目录可以直接导入各自的开发者工具（见 docs/devtools.md）。
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/** 每个平台：入口、产物目录、要原样复制进产物的模板文件 */
export const TARGETS = {
  web: {
    entry: 'src/entry/web.ts',
    outdir: 'dist/web',
    copy: [['platforms/web/index.html', 'index.html']],
  },
  // 小游戏要求入口文件叫 game.js，旁边放 game.json 和 project.config.json
  wechat: {
    entry: 'src/entry/wechat.ts',
    outdir: 'dist/wechat',
    copy: [
      ['platforms/wechat/game.json', 'game.json'],
      ['platforms/wechat/project.config.json', 'project.config.json'],
    ],
  },
  douyin: {
    entry: 'src/entry/douyin.ts',
    outdir: 'dist/douyin',
    copy: [
      ['platforms/douyin/game.json', 'game.json'],
      ['platforms/douyin/project.config.json', 'project.config.json'],
    ],
  },
};

/**
 * 打包一个平台。dev 为 true 时不压缩、带 sourcemap；write 为 false 时只在内存里打包，不写文件（包体检查用）。
 * 返回 esbuild 的结果，write 为 false 时 outputFiles 里是产物。
 */
export async function bundle(name, { dev = false, write = true } = {}) {
  const t = TARGETS[name];
  if (!t) throw new Error(`没有这个平台：${name}（现有：${Object.keys(TARGETS).join('、')}）`);
  // 写文件之前先清空输出目录：开发时留下的 sourcemap 之类的旧文件，不能混进生产构建的产物里
  if (write) rmSync(join(ROOT, t.outdir), { recursive: true, force: true });
  const result = await esbuild.build(buildOptions(t, { dev, write }));
  if (write) copyTemplates(t);
  return result;
}

function buildOptions(t, { dev, write }) {
  return {
    absWorkingDir: ROOT,
    entryPoints: [t.entry],
    outfile: join(t.outdir, 'game.js'),
    bundle: true,
    // IIFE：产物是一个自包含的脚本，没有 import / require，小游戏和 <script> 都能直接跑
    format: 'iife',
    target: 'es2020',
    minify: !dev,
    sourcemap: dev,
    legalComments: 'none',
    write,
    logLevel: 'warning',
  };
}

function copyTemplates(t) {
  mkdirSync(join(ROOT, t.outdir), { recursive: true });
  for (const [from, to] of t.copy) copyFileSync(join(ROOT, from), join(ROOT, t.outdir, to));
}

async function serve(name) {
  const t = TARGETS[name];
  rmSync(join(ROOT, t.outdir), { recursive: true, force: true });
  copyTemplates(t);
  const ctx = await esbuild.context({ ...buildOptions(t, { dev: true, write: true }), logLevel: 'info' });
  await ctx.watch();
  const port = Number(process.env.PORT) || 8000;
  const { hosts, port: actual } = await ctx.serve({ servedir: join(ROOT, t.outdir), host: '0.0.0.0', port });
  console.log(`开发服务已启动：http://localhost:${actual}/（监听 ${hosts.join('、')}），改代码后刷新页面即可`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, flag] = process.argv.slice(2);
  if (!name || (flag !== undefined && flag !== '--serve')) {
    console.error('用法：node tools/build.mjs <平台> [--serve]');
    process.exit(1);
  }
  if (flag === '--serve') await serve(name);
  else {
    await bundle(name);
    console.log(`✓ 已构建 ${TARGETS[name].outdir}/`);
  }
}
