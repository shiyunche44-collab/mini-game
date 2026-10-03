// 关卡生成。关卡号就是随机种子，同一关号在所有设备上生成出一模一样的关卡（ADR 0003）。
//
// 做法：先随机把箱子正好铺满，这就是答案；再把物品打乱放进托盘。所以每一关都保证有解。
//
// 要保持确定性，这个文件里：
// - 随机数只用 rng.ts 的种子随机数
// - 回溯搜索的预算按步数算，不按耗时算（慢手机上也要搜出同样的结果）
// - 不用 Math.pow 这类允许近似的函数（test/core-determinism.test.ts 会检查）
import { ITEMS, type Item, type Tier } from './items.ts';
import { createRng, shuffle, weightedOrder, type Rng } from './rng.ts';

/**
 * 生成结果的版本号。生成器的任何改动只要会让某一关的内容变样（物品、位置、朝向、顺序），就要加 1，
 * 同时更新 test/levels.test.ts 里的指纹。存档里记下进行中的关卡是哪个版本生成的，对不上就让这一关重新开始。
 */
export const GENERATOR_VERSION = 2;

// ---------------------------------------------------------------------------
// 关卡名：每一关是一次出行，用真实的机场三字码
// ---------------------------------------------------------------------------

export interface Destination {
  readonly code: string;
  readonly city: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { code: 'HGH', city: '杭州' },
  { code: 'CTU', city: '成都' },
  { code: 'SYX', city: '三亚' },
  { code: 'HRB', city: '哈尔滨' },
  { code: 'DLU', city: '大理' },
  { code: 'CKG', city: '重庆' },
  { code: 'XIY', city: '西安' },
  { code: 'XMN', city: '厦门' },
  { code: 'TAO', city: '青岛' },
  { code: 'CSX', city: '长沙' },
  { code: 'KMG', city: '昆明' },
  { code: 'LXA', city: '拉萨' },
  { code: 'KWL', city: '桂林' },
  { code: 'URC', city: '乌鲁木齐' },
  { code: 'LJG', city: '丽江' },
  { code: 'DLC', city: '大连' },
  { code: 'NKG', city: '南京' },
  { code: 'WUH', city: '武汉' },
  { code: 'KWE', city: '贵阳' },
  { code: 'PEK', city: '北京' },
];

// ---------------------------------------------------------------------------
// 难度参数
// ---------------------------------------------------------------------------

export interface LevelConfig {
  readonly cols: number;
  readonly rows: number;
  /** 用到哪几档物品：只用 tier 不超过它的 */
  readonly tier: Tier;
  /** 玩家能不能旋转。false 时托盘里的物品一开始就是正确朝向 */
  readonly rotate: boolean;
  /** 最多有几个单格物品 */
  readonly singles: number;
  /** 拉杆槽（不能放东西的格子）的数量 */
  readonly blocked: number;
  /** 这一关开始时的教学提示 */
  readonly tip: string | null;
  /** 这一关必须出现的物品（id）：教学关用它保证新形状在指定的关卡第一次露面 */
  readonly feature: readonly string[];
  /** 这一关不许出现的物品（id）：新形状一个一个地引入，不让几个难的同时冒出来 */
  readonly ban: readonly string[];
  /**
   * 形状一样的物品按形状算权重（见 SHAPE_PEERS）。第 1、2 关不开：这两关用户试玩过，
   * 内容保持原样（第 1 关就是登山靴、帽子、登山靴、书）；从第 3 关起都开。
   */
  readonly groupShapes: boolean;
}

// 前几关手工定难度和教学节奏，每一关只引入一样新东西：
//   第 1 关不用旋转，第 2 关教旋转，第 3 关 T 恤（第一个"凸出一块"的形状），第 4 关法棍（最长的一条），
//   第 5 关外套，第 6 关拉杆槽（这关不出新形状），第 7、8、9 关各引入牛仔裤、玩偶、裙子。
// 难的五格形状（tier 3）靠 ban 一个一个放开，不然第一次出现在哪一关全看随机。
const TIER3_ALL = ['coat', 'jeans', 'teddy', 'dress'];
const without = (...keep: string[]): readonly string[] => TIER3_ALL.filter((id) => !keep.includes(id));
const NONE: readonly string[] = [];
const PRESETS: readonly LevelConfig[] = [
  { cols: 4, rows: 3, tier: 1, rotate: false, singles: 0, blocked: 0, tip: '把物品拖进箱子，全部装下就能出发', feature: NONE, ban: NONE, groupShapes: false },
  { cols: 4, rows: 4, tier: 1, rotate: true, singles: 0, blocked: 0, tip: '点一下物品可以旋转', feature: NONE, ban: NONE, groupShapes: false },
  { cols: 4, rows: 5, tier: 2, rotate: true, singles: 1, blocked: 0, tip: null, feature: ['tshirt'], ban: NONE, groupShapes: true },
  { cols: 5, rows: 5, tier: 2, rotate: true, singles: 1, blocked: 0, tip: null, feature: ['baguette'], ban: NONE, groupShapes: true },
  { cols: 5, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 0, tip: null, feature: ['coat'], ban: without('coat'), groupShapes: true },
  { cols: 5, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 2, tip: '灰色凸起是拉杆槽，放不了东西', feature: NONE, ban: without('coat'), groupShapes: true },
  { cols: 6, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 1, tip: null, feature: ['jeans'], ban: without('coat', 'jeans'), groupShapes: true },
  { cols: 5, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 1, tip: null, feature: ['teddy'], ban: without('coat', 'jeans', 'teddy'), groupShapes: true },
  { cols: 6, rows: 6, tier: 3, rotate: true, singles: 0, blocked: 2, tip: null, feature: ['dress'], ban: NONE, groupShapes: true },
];

// 之后在这几档之间循环：难度有起有伏，不会一路涨到没法玩
const CYCLE: readonly { readonly cols: number; readonly rows: number; readonly blocked: number }[] = [
  { cols: 5, rows: 6, blocked: 1 },
  { cols: 6, rows: 6, blocked: 2 },
  { cols: 6, rows: 7, blocked: 1 },
  { cols: 5, rows: 5, blocked: 0 },
  { cols: 6, rows: 7, blocked: 3 },
  { cols: 6, rows: 6, blocked: 0 },
];

// 大件更容易被选中，避免全是小碎件；同一种物品出现越多权重越低
const SIZE_WEIGHT: Readonly<Record<number, number>> = { 1: 0.5, 2: 1, 3: 1.3, 4: 1.6, 5: 1.6, 6: 1.1 };

// 形状完全一样的物品（运动鞋、防晒霜、帽子都是 1×2）只是换个图案，权重按形状算：
// 一个形状里有几个物品，每个就只拿它的几分之一，这样加一个同形状的物品不会让这个形状更常出现。
// 不这样的话 1×2 的三件加起来占了所有物品的三成，关卡偏琐碎。
const SHAPE_PEERS = new Map<string, number>();
for (const it of ITEMS) {
  const key = it.orients.map((o) => o.key).join('|');
  SHAPE_PEERS.set(key, (SHAPE_PEERS.get(key) ?? 0) + 1);
}
const peersOf = (it: Item): number => SHAPE_PEERS.get(it.orients.map((o) => o.key).join('|')) ?? 1;

/** 必须出现的物品还没放进去时，权重乘上这个数：让它尽早被选中，少一些重来 */
const FEATURE_BOOST = 5;

function assertLevelNumber(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`关卡号必须是从 1 开始的整数，收到 ${n}`);
}

export function levelConfig(n: number): LevelConfig {
  assertLevelNumber(n);
  const preset = PRESETS[n - 1];
  if (preset) return preset;
  const base = CYCLE[(n - PRESETS.length - 1) % CYCLE.length] as (typeof CYCLE)[number];
  return { tier: 3, rotate: true, singles: n % 3 === 0 ? 0 : 1, tip: null, feature: NONE, ban: NONE, groupShapes: true, ...base };
}

// ---------------------------------------------------------------------------
// 关卡
// ---------------------------------------------------------------------------

/** 物品在箱子里的一个摆法：用第 oi 个朝向，朝向外框的左上角放在第 r 行第 c 列 */
export interface Slot {
  readonly oi: number;
  readonly r: number;
  readonly c: number;
}

export interface Piece {
  readonly item: Item;
  /** 答案里它放在哪。提示就是按它给的 */
  readonly solution: Slot;
  /** 在托盘里一开始是第几个朝向 */
  readonly startOi: number;
}

export interface Level {
  readonly n: number;
  readonly cols: number;
  readonly rows: number;
  /** 拉杆槽所在的格子，下标 = 行 * cols + 列 */
  readonly blocked: readonly number[];
  /** 玩家能不能旋转物品。false 时物品的朝向固定，托盘里一开始就是答案的朝向 */
  readonly rotate: boolean;
  /** 托盘里物品的顺序（已打乱） */
  readonly pieces: readonly Piece[];
  readonly tip: string | null;
  /** 这一关去哪，下一关去哪 */
  readonly dest: Destination;
  readonly next: Destination;
}

const EMPTY = -1;
const BLOCKED = -2;
const MAX_ATTEMPTS = 200;
// 一次铺箱子最多试多少步，超过就换个种子重来。按步数算，不按时间算。
// 取得小是为了控制最坏耗时：绝大多数关卡几十步就铺好了，少数卡住的与其硬搜不如直接换种子。
// 实测 2 万关里每次尝试的成功率都在 80% 以上，最多重试 7 次，离 MAX_ATTEMPTS 很远。
const SEARCH_BUDGET = 300;

export function generateLevel(n: number): Level {
  const cfg = levelConfig(n);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng((Math.imul(n, 2654435761) ^ Math.imul(attempt + 1, 40503)) >>> 0);
    const result = tile(cfg, rng);
    if (!result) continue;
    const pieces = shuffle(
      result.placed.map(
        (p): Piece => ({
          item: p.item,
          solution: { oi: p.oi, r: p.r, c: p.c },
          startOi: cfg.rotate ? Math.floor(rng() * p.item.orients.length) : p.oi,
        }),
      ),
      rng,
    );
    return {
      n,
      cols: cfg.cols,
      rows: cfg.rows,
      blocked: result.blocked,
      rotate: cfg.rotate,
      pieces,
      tip: cfg.tip,
      dest: DESTINATIONS[(n - 1) % DESTINATIONS.length] as Destination,
      next: DESTINATIONS[n % DESTINATIONS.length] as Destination,
    };
  }
  throw new Error(`第 ${n} 关生成失败`);
}

interface Placed {
  readonly item: Item;
  readonly oi: number;
  readonly r: number;
  readonly c: number;
}

// 先随机放拉杆槽，再用回溯把剩下的格子正好铺满
function tile(
  { cols, rows, tier, singles, blocked, feature, ban, groupShapes }: LevelConfig,
  rng: Rng,
): { placed: Placed[]; blocked: number[] } | null {
  const board: number[] = new Array(cols * rows).fill(EMPTY);
  const blockedCells: number[] = [];
  while (blockedCells.length < blocked) {
    const i = Math.floor(rng() * board.length);
    if (board[i] === EMPTY) {
      board[i] = BLOCKED;
      blockedCells.push(i);
    }
  }

  const pool = ITEMS.filter((it) => it.tier <= tier && !ban.includes(it.id));
  const placed: Placed[] = [];
  const used = new Map<string, number>();
  let singlesLeft = singles;
  let budget = SEARCH_BUDGET;

  const fits = (cells: readonly (readonly [number, number])[], r0: number, c0: number): boolean =>
    cells.every(([r, c]) => {
      const rr = r0 + r;
      const cc = c0 + c;
      return rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr * cols + cc] === EMPTY;
    });
  const mark = (cells: readonly (readonly [number, number])[], r0: number, c0: number, v: number): void => {
    for (const [r, c] of cells) board[(r0 + r) * cols + c0 + c] = v;
  };

  // 每次填最靠前的空格，物品的第一格必须落在这里
  function solve(): boolean {
    if (budget-- <= 0) return false;
    const idx = board.indexOf(EMPTY);
    if (idx < 0) return true;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const order = weightedOrder(
      pool,
      (it) => {
        const w = (SIZE_WEIGHT[it.size] ?? 1) / (groupShapes ? peersOf(it) : 1) / (1 + 2 * (used.get(it.id) ?? 0));
        return feature.includes(it.id) && !used.get(it.id) ? w * FEATURE_BOOST : w;
      },
      rng,
    );
    for (const it of order) {
      if (it.size === 1 && singlesLeft <= 0) continue;
      for (const oi of shuffle(it.orients.map((_, i) => i), rng)) {
        const o = it.orients[oi];
        if (!o) continue;
        const first = o.cells[0];
        if (!first) continue;
        const r0 = r - first[0];
        const c0 = c - first[1];
        if (!fits(o.cells, r0, c0)) continue;
        mark(o.cells, r0, c0, placed.length);
        placed.push({ item: it, oi, r: r0, c: c0 });
        used.set(it.id, (used.get(it.id) ?? 0) + 1);
        if (it.size === 1) singlesLeft--;
        if (solve()) return true;
        if (it.size === 1) singlesLeft++;
        used.set(it.id, (used.get(it.id) ?? 1) - 1);
        placed.pop();
        mark(o.cells, r0, c0, EMPTY);
        if (budget <= 0) return false;
      }
    }
    return false;
  }

  if (!solve()) return null;
  // 必须出现的物品没出现，换个种子重来
  if (!feature.every((id) => placed.some((p) => p.item.id === id))) return null;
  // 物品太少就太简单了，重新来
  if (placed.length < Math.ceil((cols * rows - blocked) / 4.5)) return null;
  return { placed, blocked: blockedCells };
}

// ---------------------------------------------------------------------------
// 检查答案
// ---------------------------------------------------------------------------

/**
 * 检查一关的答案是不是真的把箱子正好铺满：每件物品都在箱子里、不压拉杆槽、互不重叠，
 * 并且除拉杆槽以外的每一格都被盖住。返回发现的问题，没有问题返回空数组。
 */
export function findSolutionProblems(level: Level): string[] {
  const { cols, rows } = level;
  const problems: string[] = [];
  const cover: number[] = new Array(cols * rows).fill(0);
  for (const i of level.blocked) {
    if (!Number.isInteger(i) || i < 0 || i >= cover.length) problems.push(`拉杆槽的位置 ${i} 不在箱子里`);
    else cover[i] = BLOCKED;
  }
  level.pieces.forEach((p, k) => {
    const name = `第 ${k} 件（${p.item.id}）`;
    const o = p.item.orients[p.solution.oi];
    if (!o) {
      problems.push(`${name}的答案朝向 ${p.solution.oi} 不存在`);
      return;
    }
    if (!p.item.orients[p.startOi]) problems.push(`${name}的起始朝向 ${p.startOi} 不存在`);
    for (const [r, c] of o.cells) {
      const rr = p.solution.r + r;
      const cc = p.solution.c + c;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) {
        problems.push(`${name}超出了箱子：第 ${rr} 行第 ${cc} 列`);
        continue;
      }
      const at = rr * cols + cc;
      if (cover[at] === BLOCKED) problems.push(`${name}压在拉杆槽上：第 ${rr} 行第 ${cc} 列`);
      else if (cover[at] !== 0) problems.push(`${name}和别的物品重叠：第 ${rr} 行第 ${cc} 列`);
      else cover[at] = 1;
    }
  });
  cover.forEach((v, at) => {
    if (v === 0) problems.push(`第 ${Math.floor(at / cols)} 行第 ${at % cols} 列没有被盖住`);
  });
  return problems;
}
