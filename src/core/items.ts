// 物品定义。shape 里 # 表示占一格，形状尽量贴近实物：靴子是 L 形，裤子是 ∩ 形。
// 每个物品在加载时算好它所有不重复的朝向，以及 emoji 画在哪。
//
// 坐标约定：[行, 列]，行向下、列向右，和屏幕一致。

export type Cell = readonly [row: number, col: number];

/** 从哪一档难度开始出现：1 入门，2 进阶，3 困难 */
export type Tier = 1 | 2 | 3;

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  /** 每行一个字符串，# 占一格，. 是空 */
  readonly shape: readonly string[];
  readonly color: string;
  readonly tier: Tier;
}

/** emoji 的位置，单位是格子，原点在这个朝向外框的左上角 */
export interface LabelSpot {
  readonly x: number;
  readonly y: number;
  /** true：画在 2×2 以上的实心块中间，emoji 可以画大一号 */
  readonly big: boolean;
}

/** 物品的一个朝向 */
export interface Orientation {
  /** 已平移到左上角对齐（最小行、最小列都是 0），按行再按列排序 */
  readonly cells: readonly Cell[];
  readonly w: number;
  readonly h: number;
  /** 形状的唯一标识，形状相同的朝向 key 相同，例如 '0,0;0,1;1,0' */
  readonly key: string;
  readonly label: LabelSpot;
}

export interface Item extends ItemDef {
  /** 占几格 */
  readonly size: number;
  /**
   * 所有不重复的朝向。第 0 个是 shape 原样画出来的朝向，之后每个比前一个再顺时针转 90°。
   * 只能旋转，不能翻面；转了还是同样形状的（比如方块）只算一个。
   */
  readonly orients: readonly Orientation[];
  /** 所有朝向里最长的一边 */
  readonly maxDim: number;
}

const DEFS: readonly ItemDef[] = [
  { id: 'sneaker', name: '运动鞋', emoji: '👟', shape: ['##'], color: '#FF8A80', tier: 1 },
  { id: 'sunscreen', name: '防晒霜', emoji: '🧴', shape: ['##'], color: '#FFD166', tier: 1 },
  { id: 'cap', name: '帽子', emoji: '🧢', shape: ['##'], color: '#5ED3C3', tier: 1 },
  { id: 'umbrella', name: '雨伞', emoji: '🌂', shape: ['###'], color: '#F4A259', tier: 1 },
  { id: 'boot', name: '登山靴', emoji: '🥾', shape: ['#.', '##'], color: '#C9A27E', tier: 1 },
  { id: 'books', name: '书', emoji: '📚', shape: ['##', '##'], color: '#7BD389', tier: 1 },
  { id: 'laptop', name: '电脑', emoji: '💻', shape: ['###', '###'], color: '#A8DADC', tier: 1 },
  { id: 'socks', name: '袜子', emoji: '🧦', shape: ['#'], color: '#F78FB3', tier: 2 },
  { id: 'earphones', name: '耳机', emoji: '🎧', shape: ['#'], color: '#B8A9FF', tier: 2 },
  { id: 'tshirt', name: 'T恤', emoji: '👕', shape: ['###', '.#.'], color: '#7CC6FE', tier: 2 },
  { id: 'scarf', name: '围巾', emoji: '🧣', shape: ['##.', '.##'], color: '#FF6F59', tier: 2 },
  { id: 'highboot', name: '长靴', emoji: '👢', shape: ['#.', '#.', '##'], color: '#C08497', tier: 2 },
  { id: 'baguette', name: '法棍', emoji: '🥖', shape: ['####'], color: '#E9C46A', tier: 2 },
  { id: 'jeans', name: '牛仔裤', emoji: '👖', shape: ['###', '#.#'], color: '#6C8CFF', tier: 3 },
  { id: 'teddy', name: '玩偶', emoji: '🧸', shape: ['.#.', '###', '.#.'], color: '#E5989B', tier: 3 },
  { id: 'coat', name: '外套', emoji: '🧥', shape: ['##', '##', '#.'], color: '#9DB4C0', tier: 3 },
  { id: 'dress', name: '裙子', emoji: '👗', shape: ['###', '.#.', '.#.'], color: '#CDB4DB', tier: 3 },
];

/** 由定义算出朝向、占几格等。shape 为空、含 # 和 . 以外的字符、没有 # 时抛错。 */
export function buildItem(def: ItemDef): Item {
  const base: Cell[] = [];
  def.shape.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '#') base.push([r, c]);
      else if (ch !== '.') throw new Error(`物品 ${def.id} 的 shape 里有不认识的字符 '${ch}'，只能用 # 和 .`);
    });
  });
  if (base.length === 0) throw new Error(`物品 ${def.id} 的 shape 里没有 #`);

  const orients: Orientation[] = [];
  const seen = new Set<string>();
  let cells: readonly Cell[] = base;
  for (let i = 0; i < 4; i++) {
    const o = normalize(cells);
    if (!seen.has(o.key)) {
      seen.add(o.key);
      orients.push(o);
    }
    cells = cells.map(([r, c]): Cell => [c, -r]); // 顺时针转 90°
  }
  const maxDim = Math.max(...orients.map((o) => Math.max(o.w, o.h)));
  return { ...def, size: base.length, orients, maxDim };
}

export const ITEMS: readonly Item[] = DEFS.map(buildItem);

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

/** 按 id 找物品，找不到抛错（存档里的 id 可能来自旧版本，调用方要处理） */
export function itemById(id: string): Item {
  const it = BY_ID.get(id);
  if (!it) throw new Error(`没有这个物品：${id}`);
  return it;
}

function normalize(cells: readonly Cell[]): Orientation {
  const minR = Math.min(...cells.map((p) => p[0]));
  const minC = Math.min(...cells.map((p) => p[1]));
  const out = cells
    .map(([r, c]): Cell => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const h = Math.max(...out.map((p) => p[0])) + 1;
  const w = Math.max(...out.map((p) => p[1])) + 1;
  return { cells: out, w, h, key: out.map((p) => p.join(',')).join(';'), label: labelSpot(out, w, h) };
}

// emoji 画在哪：整块矩形画正中间；有 2×2 实心块就画在块中间（大一号）；否则画在离重心最近的格子。
// 距离用乘法算平方，不用 ** 或 Math.pow，保持 core 里没有允许近似的运算。
function labelSpot(cells: readonly Cell[], w: number, h: number): LabelSpot {
  if (cells.length === w * h && Math.min(w, h) >= 2) return { x: w / 2, y: h / 2, big: true };

  const has = new Set(cells.map((p) => p.join(',')));
  const cy = cells.reduce((s, p) => s + p[0], 0) / cells.length + 0.5;
  const cx = cells.reduce((s, p) => s + p[1], 0) / cells.length + 0.5;
  const dist = (x: number, y: number) => (x - cx) * (x - cx) + (y - cy) * (y - cy);

  let best: (LabelSpot & { d: number }) | null = null;
  for (const [r, c] of cells) {
    if (has.has(`${r},${c + 1}`) && has.has(`${r + 1},${c}`) && has.has(`${r + 1},${c + 1}`)) {
      const d = dist(c + 1, r + 1);
      if (!best || d < best.d) best = { x: c + 1, y: r + 1, d, big: true };
    }
  }
  if (best) return { x: best.x, y: best.y, big: true };

  for (const [r, c] of cells) {
    const d = dist(c + 0.5, r + 0.5);
    if (!best || d < best.d) best = { x: c + 0.5, y: r + 0.5, d, big: false };
  }
  // cells 不会为空（buildItem 已检查），best 一定有值
  const b = best as LabelSpot;
  return { x: b.x, y: b.y, big: false };
}
