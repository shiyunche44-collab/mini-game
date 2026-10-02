// 包体检查：每个平台的 JS 产物不能超过 300KB（压缩后，不含 sourcemap）。超了就报错，退出码为 1。
// 在内存里打包，不用先跑 build，也不写 dist/。
import { pathToFileURL } from 'node:url';
import { bundle, TARGETS } from './build.mjs';

export const LIMIT_BYTES = 300 * 1024;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

/** 返回每个平台的 JS 产物大小（字节） */
export async function measure() {
  const sizes = {};
  for (const name of Object.keys(TARGETS)) {
    const { outputFiles } = await bundle(name, { write: false });
    sizes[name] = outputFiles.filter((f) => f.path.endsWith('.js')).reduce((sum, f) => sum + f.contents.length, 0);
  }
  return sizes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sizes = await measure();
  let failed = false;
  for (const [name, bytes] of Object.entries(sizes)) {
    const over = bytes > LIMIT_BYTES;
    console.log(`${over ? '✗' : '✓'} ${name}: ${kb(bytes)} / ${kb(LIMIT_BYTES)}`);
    if (over) failed = true;
  }
  if (failed) console.error('产物超过了包体上限。先看是不是引了不该进游戏的东西，再考虑精简；要放宽上限必须先写 ADR。');
  process.exit(failed ? 1 : 0);
}
