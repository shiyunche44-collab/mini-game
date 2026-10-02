// 关卡预览：在命令行打印关卡的文字版网格和物品清单，用来判断难度梯度合不合理（roadmap 1.3）。
//
// 用法：
//   npm run levels:preview             前 10 关
//   npm run levels:preview -- 30       前 30 关
//   npm run levels:preview -- 11-20    第 11～20 关
//
// 网格画的是生成器给的答案，玩家不一定只有这一种摆法。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GENERATOR_VERSION, generateLevel } from '../src/core/levels.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BLOCKED = '#';
const DEFAULT_COUNT = 10;

const USAGE = '用法：npm run levels:preview -- [关数 | 起-止]，例如 20 表示前 20 关，11-20 表示第 11～20 关';

/** 解析命令行参数，返回 { from, to }。不传参数时是前 10 关；参数不对时抛 RangeError，消息里带用法。 */
export function parseRange(args) {
  if (args.length === 0) return { from: 1, to: DEFAULT_COUNT };
  const m = args.length === 1 ? /^(\d+)(?:-(\d+))?$/.exec(args[0]) : null;
  const from = m ? (m[2] === undefined ? 1 : Number(m[1])) : NaN;
  const to = m ? Number(m[2] ?? m[1]) : NaN;
  if (!(from >= 1 && to >= from && Number.isSafeInteger(to))) {
    throw new RangeError(`参数不对：${args.join(' ')}\n${USAGE}`);
  }
  return { from, to };
}

// 中文和 emoji 在等宽字体里占两格，对齐时要按显示宽度算，不能按字符数算
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

export function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));
const padStart = (s, w) => ' '.repeat(Math.max(0, w - displayWidth(s))) + s;

/**
 * 从托盘里的朝向转到答案的朝向要点几下。
 * items.ts 里每个朝向是前一个顺时针转 90°，所以按"每下顺时针转 90°"算。
 */
export function turnsNeeded(piece) {
  const n = piece.item.orients.length;
  return (piece.solution.oi - piece.startOi + n) % n;
}

/** 一关的概况，汇总表里的一行。seen：前面的关卡里出现过的物品 id */
export function summarize(level, seen) {
  const cells = level.pieces.reduce((s, p) => s + p.item.size, 0);
  const fresh = [];
  for (const p of level.pieces) if (!seen.has(p.item.id) && !fresh.includes(p.item)) fresh.push(p.item);
  return {
    n: level.n,
    size: `${level.cols}×${level.rows}`,
    blocked: level.blocked.length,
    pieces: level.pieces.length,
    avg: level.pieces.length === 0 ? 0 : cells / level.pieces.length,
    turns: level.pieces.filter((p) => turnsNeeded(p) > 0).length,
    fresh,
  };
}

/** 一关的详细预览：标题、答案网格、物品清单。seen：前面的关卡里出现过的物品 id，用来标"新" */
export function renderLevel(level, seen = new Set()) {
  const { cols, rows } = level;
  if (level.pieces.length > LETTERS.length) throw new Error(`第 ${level.n} 关有 ${level.pieces.length} 件物品，字母不够用`);

  // 生成器保证铺满，正常不会剩下 '.'；剩下了说明答案有问题，一眼能看出来
  const grid = new Array(cols * rows).fill('.');
  for (const i of level.blocked) grid[i] = BLOCKED;
  level.pieces.forEach((p, k) => {
    const o = p.item.orients[p.solution.oi];
    for (const [r, c] of o.cells) grid[(p.solution.r + r) * cols + p.solution.c + c] = LETTERS[k];
  });

  const out = [
    `第 ${level.n} 关  ${level.dest.code} ${level.dest.city} → ${level.next.code} ${level.next.city}`,
    `箱子 ${cols}×${rows}，拉杆槽 ${level.blocked.length} 个，${level.pieces.length} 件物品，${level.rotate ? '可以旋转' : '不能旋转'}`,
  ];
  if (level.tip) out.push(`教学提示：${level.tip}`);

  const border = `  +${'-'.repeat(cols * 2 + 1)}+`;
  out.push('', border);
  for (let r = 0; r < rows; r++) out.push(`  | ${grid.slice(r * cols, (r + 1) * cols).join(' ')} |`);
  out.push(border, '');

  const nameWidth = Math.max(...level.pieces.map((p) => displayWidth(p.item.name)));
  level.pieces.forEach((p, k) => {
    const t = turnsNeeded(p);
    const turn = t === 0 ? '不用转' : `转 ${t} 下`;
    const line = `  ${LETTERS[k]} ${p.item.emoji} ${padEnd(p.item.name, nameWidth)}  ${p.item.size} 格  ${padEnd(turn, 7)}${seen.has(p.item.id) ? '' : '  新'}`;
    out.push(line.trimEnd());
  });
  return out.join('\n');
}

/** 汇总表：每关一行，方便横着比较难度 */
export function renderOverview(summaries) {
  const cols = [
    ['关卡', (s) => String(s.n)],
    ['箱子', (s) => s.size],
    ['槽', (s) => String(s.blocked)],
    ['件数', (s) => String(s.pieces)],
    ['均格', (s) => s.avg.toFixed(1)],
    ['要转', (s) => String(s.turns)],
  ];
  const widths = cols.map(([head, get]) => Math.max(displayWidth(head), ...summaries.map((s) => displayWidth(get(s)))));
  const line = (cells, last) => [...cells.map((c, i) => padStart(c, widths[i])), last].join('  ').trimEnd();
  return [
    '汇总：槽 = 拉杆槽个数，均格 = 平均每件几格，要转 = 托盘里朝向不对的件数',
    '',
    line(cols.map(([head]) => head), '新物品'),
    ...summaries.map((s) => line(cols.map(([, get]) => get(s)), s.fresh.map((it) => it.emoji).join(''))),
  ].join('\n');
}

/** 第 from～to 关的完整预览。"新"从第 1 关算起，所以总是从第 1 关开始生成 */
export function preview(from, to) {
  const out = [
    `关卡预览：第 ${from}～${to} 关（生成器版本 ${GENERATOR_VERSION}）`,
    `网格画的是答案，玩家不一定只有这一种摆法。同一个字母是同一件物品，${BLOCKED} 是拉杆槽。`,
    '字母按托盘里的顺序排。"转 n 下"：从托盘里的朝向开始，每下顺时针转 90°。"新"：这一关第一次出现的物品。',
  ];
  const seen = new Set();
  const summaries = [];
  for (let n = 1; n <= to; n++) {
    const level = generateLevel(n);
    if (n >= from) {
      out.push('', '='.repeat(36), renderLevel(level, seen));
      summaries.push(summarize(level, seen));
    }
    for (const p of level.pieces) seen.add(p.item.id);
  }
  out.push('', '='.repeat(36), renderOverview(summaries));
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { from, to } = parseRange(process.argv.slice(2));
    console.log(preview(from, to));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
}
