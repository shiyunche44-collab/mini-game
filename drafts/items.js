// 物品定义。shape 里 # 表示占一格，形状尽量贴近实物：靴子是 L 形，裤子是 ∩ 形。
// tier 表示从哪一档难度开始出现：1 入门，2 进阶，3 困难。
const DEFS = [
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

export const ITEMS = DEFS.map(prepare);

function prepare(def) {
  const base = [];
  def.shape.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '#') base.push([r, c]);
    });
  });
  // 只允许旋转不允许翻面，去掉重复的朝向（比如方块转了还是方块）
  const orients = [];
  const seen = new Set();
  let cells = base;
  for (let i = 0; i < 4; i++) {
    const o = normalize(cells);
    if (!seen.has(o.key)) {
      seen.add(o.key);
      orients.push(o);
    }
    cells = cells.map(([r, c]) => [c, -r]); // 顺时针转 90°
  }
  const maxDim = Math.max(...orients.map((o) => Math.max(o.w, o.h)));
  return { ...def, size: base.length, orients, maxDim };
}

function normalize(cells) {
  const minR = Math.min(...cells.map((p) => p[0]));
  const minC = Math.min(...cells.map((p) => p[1]));
  const out = cells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const h = Math.max(...out.map((p) => p[0])) + 1;
  const w = Math.max(...out.map((p) => p[1])) + 1;
  return { cells: out, w, h, key: out.map((p) => p.join(',')).join(';'), label: labelSpot(out, w, h) };
}

// emoji 画在哪：整块矩形画正中间，有 2×2 实心块就画在块中间（大一号），否则画在离重心最近的格子
function labelSpot(cells, w, h) {
  if (cells.length === w * h && Math.min(w, h) >= 2) return { x: w / 2, y: h / 2, big: true };
  const has = new Set(cells.map((p) => p.join(',')));
  const cy = cells.reduce((s, p) => s + p[0], 0) / cells.length + 0.5;
  const cx = cells.reduce((s, p) => s + p[1], 0) / cells.length + 0.5;
  let best = null;
  for (const [r, c] of cells) {
    if (has.has(`${r},${c + 1}`) && has.has(`${r + 1},${c}`) && has.has(`${r + 1},${c + 1}`)) {
      const d = (c + 1 - cx) ** 2 + (r + 1 - cy) ** 2;
      if (!best || d < best.d) best = { x: c + 1, y: r + 1, d, big: true };
    }
  }
  if (best) return best;
  for (const [r, c] of cells) {
    const d = (c + 0.5 - cx) ** 2 + (r + 0.5 - cy) ** 2;
    if (!best || d < best.d) best = { x: c + 0.5, y: r + 0.5, d, big: false };
  }
  return best;
}
