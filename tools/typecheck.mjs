// 按分层逐个类型检查。某一层还没有 .ts 文件时跳过（tsc 对空目录会报错）。
//
// entry 层特殊：每个入口是一个平台的产物，要带各自平台的类型库（web 要 DOM，微信、抖音要各自的类型），
// 所以每个入口 X.ts 配一份 tsconfig.X.json，单独检查。入口没配 tsconfig 也算失败，免得新入口绕开检查。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LAYERS = ['src/core', 'src/engine', 'src/game', 'src/platform', 'src/entry', 'test'];

/** 这一层要跑的 tsc 项目；缺配置时返回错误信息 */
function projectsOf(layer) {
  if (layer !== 'src/entry') return { projects: [layer], missing: [] };
  const files = readdirSync(layer);
  const entries = files.filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -'.ts'.length));
  const missing = entries.filter((name) => !existsSync(join(layer, `tsconfig.${name}.json`)));
  const configured = entries.filter((name) => !missing.includes(name));
  return { projects: configured.map((name) => join(layer, `tsconfig.${name}.json`)), missing };
}

function hasTs(dir) {
  return readdirSync(dir, { withFileTypes: true }).some((e) =>
    e.isDirectory() ? hasTs(join(dir, e.name)) : e.name.endsWith('.ts'),
  );
}

let failed = false;
for (const layer of LAYERS) {
  if (!hasTs(layer)) {
    console.log(`- ${layer}: 还没有 .ts 文件，跳过`);
    continue;
  }
  const { projects, missing } = projectsOf(layer);
  for (const name of missing) {
    console.log(`✗ ${layer}/${name}.ts 没有对应的 ${layer}/tsconfig.${name}.json：每个入口要配自己平台的类型库`);
    failed = true;
  }
  for (const project of projects) {
    const r = spawnSync('npx', ['tsc', '-p', project], { stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`${r.status === 0 ? '✓' : '✗'} ${project}`);
    if (r.status !== 0) failed = true;
  }
}
process.exit(failed ? 1 : 0);
