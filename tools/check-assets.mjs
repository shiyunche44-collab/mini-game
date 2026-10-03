// 素材检查：assets/icons 里的图标要符合 docs/art-spec.md 的规格，不符合会在构建、提审时才发现问题，所以放进 npm run check。
// 没有图标（还没出图）不算错：游戏会画 emoji。
//
// 检查什么：文件名是不是物品 id、是不是 PNG、是不是 192×192、有没有透明、单张和总量有没有超限。
// 透明的判断：PNG 的颜色类型是带透明通道的（4、6），或者调色板图带 tRNS 块。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ITEMS } from '../src/core/items.ts';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
export const ICON_DIR = join(ROOT, 'assets', 'icons');
export const ICON_SIZE = 192;
/** 单张上限（字节）。规格写的是"尽量不超过 40KB"，这里留一点余地，超过 60KB 一定是没压缩 */
export const MAX_ICON_BYTES = 60 * 1024;
/** 总量上限：17 张按规格不到 700KB，小游戏主包有大小上限（微信我记得是 4MB，以后台为准），素材别吃掉太多 */
export const MAX_TOTAL_BYTES = 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 读 PNG 头部：宽、高、颜色类型，以及有没有 tRNS 块。不是 PNG 返回 null */
export function readPng(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const info = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25], hasTrns: false };
  // 逐块往后找 tRNS，遇到图像数据就不用再找了（tRNS 必须在它前面）
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tRNS') info.hasTrns = true;
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + len;
  }
  return info;
}

/** 检查一个目录，返回问题列表（空数组 = 没问题）。dir 和 itemIds 可以传，测试用 */
export function findAssetProblems(dir = ICON_DIR, itemIds = ITEMS.map((i) => i.id)) {
  const problems = [];
  if (!existsSync(dir)) return problems;
  let total = 0;
  for (const file of readdirSync(dir).sort()) {
    if (file.startsWith('.')) continue; // .gitkeep 之类
    if (!file.endsWith('.png')) {
      problems.push(`${file}：不是 .png 文件（图标只能放 PNG）`);
      continue;
    }
    const id = file.slice(0, -4);
    if (!itemIds.includes(id)) problems.push(`${file}：没有叫 ${id} 的物品（文件名必须是物品 id：${itemIds.join('、')}）`);
    const buf = readFileSync(join(dir, file));
    total += buf.length;
    if (buf.length > MAX_ICON_BYTES) problems.push(`${file}：${(buf.length / 1024).toFixed(0)}KB，超过 ${MAX_ICON_BYTES / 1024}KB，请压缩（规格见 docs/art-spec.md）`);
    const png = readPng(buf);
    if (!png) {
      problems.push(`${file}：不是有效的 PNG 文件`);
      continue;
    }
    if (png.width !== ICON_SIZE || png.height !== ICON_SIZE) problems.push(`${file}：${png.width}×${png.height}，必须是 ${ICON_SIZE}×${ICON_SIZE}`);
    const alpha = png.colorType === 4 || png.colorType === 6 || (png.colorType === 3 && png.hasTrns);
    if (!alpha) problems.push(`${file}：没有透明通道，背景必须是透明的`);
  }
  if (total > MAX_TOTAL_BYTES) problems.push(`图标总共 ${(total / 1024).toFixed(0)}KB，超过 ${MAX_TOTAL_BYTES / 1024}KB`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = existsSync(ICON_DIR) ? readdirSync(ICON_DIR).filter((f) => f.endsWith('.png')) : [];
  const problems = findAssetProblems();
  if (problems.length > 0) {
    console.error('素材检查没通过：');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  const have = new Set(files.map((f) => f.slice(0, -4)));
  const missing = ITEMS.filter((i) => !have.has(i.id)).map((i) => i.id);
  console.log(`✓ 物品图标 ${files.length}/${ITEMS.length} 张${missing.length ? `（还没有的画 emoji：${missing.join('、')}）` : ''}`);
}
