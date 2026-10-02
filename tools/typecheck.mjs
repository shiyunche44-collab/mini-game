// 按分层逐个类型检查。某一层还没有 .ts 文件时跳过（tsc 对空目录会报错）。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const LAYERS = ['src/core', 'src/engine', 'src/game', 'src/platform', 'src/entry', 'test'];

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
  const r = spawnSync('npx', ['tsc', '-p', layer], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`${r.status === 0 ? '✓' : '✗'} ${layer}`);
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
