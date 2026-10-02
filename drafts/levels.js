import { ITEMS } from './items.js';
import { createRng, shuffle, weightedOrder } from './rng.js';

// 每一关是一次出行，用真实的机场三字码当关卡名
export const DESTINATIONS = [
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

// 前几关手工定难度：第 1 关不用旋转，第 2 关教旋转，第 6 关引入拉杆槽
const PRESETS = [
  { cols: 4, rows: 3, tier: 1, rotate: false, singles: 0, blocked: 0, tip: '把物品拖进箱子，全部装下就能出发' },
  { cols: 4, rows: 4, tier: 1, rotate: true, singles: 0, blocked: 0, tip: '点一下物品可以旋转' },
  { cols: 4, rows: 5, tier: 2, rotate: true, singles: 1, blocked: 0 },
  { cols: 5, rows: 5, tier: 2, rotate: true, singles: 1, blocked: 0 },
  { cols: 5, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 0 },
  { cols: 5, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 2, tip: '灰色凸起是拉杆槽，放不了东西' },
  { cols: 6, rows: 6, tier: 3, rotate: true, singles: 1, blocked: 1 },
];

// 之后在这几档之间循环：难度有起有伏，不会一路涨到没法玩
const CYCLE = [
  { cols: 5, rows: 6, blocked: 1 },
  { cols: 6, rows: 6, blocked: 2 },
  { cols: 6, rows: 7, blocked: 1 },
  { cols: 5, rows: 5, blocked: 0 },
  { cols: 6, rows: 7, blocked: 3 },
  { cols: 6, rows: 6, blocked: 0 },
];

// 大件更容易被选中，避免全是小碎件；同一种物品出现越多权重越低
const SIZE_WEIGHT = { 1: 0.5, 2: 1, 3: 1.3, 4: 1.6, 5: 1.6, 6: 1.1 };

export function levelConfig(n) {
  if (n <= PRESETS.length) return PRESETS[n - 1];
  const base = CYCLE[(n - PRESETS.length - 1) % CYCLE.length];
  return { tier: 3, rotate: true, singles: n % 3 === 0 ? 0 : 1, tip: null, ...base };
}

export function generateLevel(n) {
  const cfg = levelConfig(n);
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = createRng((Math.imul(n, 2654435761) ^ Math.imul(attempt + 1, 40503)) >>> 0);
    const result = tile(cfg, rng);
    if (!result) continue;
    const pieces = shuffle(
      result.placed.map((p) => ({
        item: p.item,
        solution: { oi: p.oi, r: p.r, c: p.c },
        startOi: cfg.rotate ? Math.floor(rng() * p.item.orients.length) : p.oi,
      })),
      rng,
    );
    return {
      n,
      cols: cfg.cols,
      rows: cfg.rows,
      blocked: result.blocked,
      pieces,
      tip: cfg.tip || null,
      dest: DESTINATIONS[(n - 1) % DESTINATIONS.length],
      next: DESTINATIONS[n % DESTINATIONS.length],
    };
  }
  throw new Error(`第 ${n} 关生成失败`);
}

// 先随机把箱子正好铺满（这就是答案），再把物品打乱放进托盘，所以每一关都保证有解
function tile({ cols, rows, tier, singles, blocked }, rng) {
  const EMPTY = -1;
  const board = new Array(cols * rows).fill(EMPTY);
  const blockedCells = [];
  while (blockedCells.length < blocked) {
    const i = Math.floor(rng() * board.length);
    if (board[i] === EMPTY) {
      board[i] = -2;
      blockedCells.push(i);
    }
  }

  const pool = ITEMS.filter((it) => it.tier <= tier);
  const placed = [];
  const used = new Map();
  let singlesLeft = singles;
  let budget = 4000;

  const fits = (o, r0, c0) =>
    o.cells.every(([r, c]) => {
      const rr = r0 + r;
      const cc = c0 + c;
      return rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr * cols + cc] === EMPTY;
    });
  const mark = (o, r0, c0, v) => {
    for (const [r, c] of o.cells) board[(r0 + r) * cols + c0 + c] = v;
  };

  // 每次填最靠前的空格，物品的第一格必须落在这里
  function solve() {
    if (budget-- <= 0) return false;
    const idx = board.indexOf(EMPTY);
    if (idx < 0) return true;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const order = weightedOrder(pool, (it) => SIZE_WEIGHT[it.size] / (1 + 2 * (used.get(it.id) || 0)), rng);
    for (const it of order) {
      if (it.size === 1 && singlesLeft <= 0) continue;
      for (const oi of shuffle(it.orients.map((_, i) => i), rng)) {
        const o = it.orients[oi];
        const r0 = r - o.cells[0][0];
        const c0 = c - o.cells[0][1];
        if (!fits(o, r0, c0)) continue;
        mark(o, r0, c0, placed.length);
        placed.push({ item: it, oi, r: r0, c: c0 });
        used.set(it.id, (used.get(it.id) || 0) + 1);
        if (it.size === 1) singlesLeft--;
        if (solve()) return true;
        if (it.size === 1) singlesLeft++;
        used.set(it.id, used.get(it.id) - 1);
        placed.pop();
        mark(o, r0, c0, EMPTY);
        if (budget <= 0) return false;
      }
    }
    return false;
  }

  if (!solve()) return null;
  // 物品太少就太简单了，重新来
  if (placed.length < Math.ceil((cols * rows - blocked) / 4.5)) return null;
  return { placed, blocked: blockedCells };
}
