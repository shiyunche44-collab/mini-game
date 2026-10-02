import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildItem, ITEMS, itemById, type Cell, type ItemDef, type Orientation } from '../src/core/items.ts';

function def(shape: string[]): ItemDef {
  return { id: 'x', name: '测试', emoji: '❓', shape, color: '#000000', tier: 1 };
}

/** 把一个朝向画成字符串，方便和 shape 对照 */
function draw(o: Orientation): string[] {
  const rows = Array.from({ length: o.h }, () => Array.from({ length: o.w }, () => '.'));
  for (const [r, c] of o.cells) (rows[r] as string[])[c] = '#';
  return rows.map((row) => row.join(''));
}

/** 格子是否连成一块（上下左右相邻） */
function isConnected(cells: readonly Cell[]): boolean {
  const key = (r: number, c: number) => `${r},${c}`;
  const left = new Set(cells.map(([r, c]) => key(r, c)));
  const first = cells[0] as Cell;
  const stack = [first];
  left.delete(key(first[0], first[1]));
  while (stack.length > 0) {
    const [r, c] = stack.pop() as Cell;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = key(r + dr, c + dc);
      if (left.delete(k)) stack.push([r + dr, c + dc]);
    }
  }
  return left.size === 0;
}

describe('旋转和去重', () => {
  it('第 0 个朝向就是 shape 原样，之后每个都顺时针转 90°', () => {
    const boot = buildItem(def(['#.', '##']));
    assert.deepEqual(boot.orients.map(draw), [
      ['#.', '##'],
      ['##', '#.'],
      ['##', '.#'],
      ['.#', '##'],
    ]);
  });

  it('转了还是同样形状的只算一个朝向', () => {
    const count = (shape: string[]) => buildItem(def(shape)).orients.length;
    assert.equal(count(['#']), 1); // 单格
    assert.equal(count(['##', '##']), 1); // 方块
    assert.equal(count(['.#.', '###', '.#.']), 1); // 十字
    assert.equal(count(['##']), 2); // 长条：转 180° 重合
    assert.equal(count(['##.', '.##']), 2); // S 形：转 180° 重合
    assert.equal(count(['###', '###']), 2);
    assert.equal(count(['#.', '##']), 4); // L 形
    assert.equal(count(['###', '.#.']), 4); // T 形
  });

  it('只旋转不翻面：S 和 Z 是两种不同的形状', () => {
    const s = buildItem(def(['.##', '##.']));
    const z = buildItem(def(['##.', '.##']));
    const sKeys = new Set(s.orients.map((o) => o.key));
    assert.ok(z.orients.every((o) => !sKeys.has(o.key)));
  });

  it('每个物品的各个朝向 key 互不相同、格数相同', () => {
    for (const it of ITEMS) {
      assert.equal(new Set(it.orients.map((o) => o.key)).size, it.orients.length, it.id);
      for (const o of it.orients) assert.equal(o.cells.length, it.size, `${it.id} ${o.key}`);
    }
  });

  it('每个朝向都平移到左上角，格子按行再按列排序，w、h 是外框大小', () => {
    for (const it of ITEMS) {
      for (const o of it.orients) {
        assert.equal(Math.min(...o.cells.map((p) => p[0])), 0, it.id);
        assert.equal(Math.min(...o.cells.map((p) => p[1])), 0, it.id);
        assert.equal(Math.max(...o.cells.map((p) => p[0])) + 1, o.h, it.id);
        assert.equal(Math.max(...o.cells.map((p) => p[1])) + 1, o.w, it.id);
        const sorted = [...o.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        assert.deepEqual(o.cells, sorted, it.id);
        assert.equal(o.key, o.cells.map((p) => p.join(',')).join(';'));
      }
    }
  });

  it('maxDim 是所有朝向里最长的一边', () => {
    assert.equal(itemById('baguette').maxDim, 4);
    assert.equal(itemById('laptop').maxDim, 3);
    assert.equal(itemById('books').maxDim, 2);
    assert.equal(itemById('socks').maxDim, 1);
  });

  it('具体物品的朝向数量', () => {
    const counts = Object.fromEntries(ITEMS.map((it) => [it.id, it.orients.length]));
    assert.deepEqual(counts, {
      sneaker: 2, sunscreen: 2, cap: 2, umbrella: 2, boot: 4, books: 1, laptop: 2,
      socks: 1, earphones: 1, tshirt: 4, scarf: 2, highboot: 4, baguette: 2,
      jeans: 4, teddy: 1, coat: 4, dress: 4,
    });
  });
});

describe('emoji 位置', () => {
  const label = (id: string, i = 0) => (itemById(id).orients[i] as Orientation).label;

  it('整块矩形画在正中间，大一号', () => {
    assert.deepEqual(label('books'), { x: 1, y: 1, big: true });
    assert.deepEqual(label('laptop'), { x: 1.5, y: 1, big: true }); // 3 宽 2 高
    assert.deepEqual(label('laptop', 1), { x: 1, y: 1.5, big: true }); // 转过来 2 宽 3 高
  });

  it('有 2×2 实心块的画在块中间，大一号', () => {
    assert.deepEqual(label('coat'), { x: 1, y: 1, big: true });
  });

  it('其余画在离重心最近的格子中心，正常大小', () => {
    assert.deepEqual(label('socks'), { x: 0.5, y: 0.5, big: false });
    assert.deepEqual(label('teddy'), { x: 1.5, y: 1.5, big: false }); // 十字的中心格
    assert.deepEqual(label('tshirt'), { x: 1.5, y: 0.5, big: false }); // T 字上面一横的中间
  });

  it('所有物品、所有朝向：位置都落在物品自己身上', () => {
    for (const it of ITEMS) {
      for (const o of it.orients) {
        const { x, y, big } = o.label;
        const has = (r: number, c: number) => o.cells.some((p) => p[0] === r && p[1] === c);
        const where = `${it.id} ${o.key}`;
        if (!big) {
          // 正常大小：在某一格的中心
          assert.ok(has(y - 0.5, x - 0.5), where);
        } else if (Number.isInteger(x) && Number.isInteger(y)) {
          // 2×2 块：四格都是物品的一部分
          assert.ok(has(y - 1, x - 1) && has(y - 1, x) && has(y, x - 1) && has(y, x), where);
        } else {
          // 整块矩形：物品就是外框
          assert.equal(o.cells.length, o.w * o.h, where);
          assert.deepEqual([x, y], [o.w / 2, o.h / 2], where);
        }
      }
    }
  });

  it('转 90° 后位置跟着转：2×2 以上的矩形转过来还是正中间', () => {
    for (const id of ['books', 'laptop']) {
      for (const o of itemById(id).orients) assert.deepEqual([o.label.x, o.label.y], [o.w / 2, o.h / 2]);
    }
  });
});

describe('物品表', () => {
  it('id 不重复，名字、emoji、颜色都有，颜色是 #RRGGBB', () => {
    assert.equal(new Set(ITEMS.map((it) => it.id)).size, ITEMS.length);
    for (const it of ITEMS) {
      assert.ok(it.name.length > 0 && it.emoji.length > 0, it.id);
      assert.match(it.color, /^#[0-9A-Fa-f]{6}$/, it.id);
    }
  });

  it('每个物品的格子都连成一块', () => {
    for (const it of ITEMS) assert.ok(isConnected((it.orients[0] as Orientation).cells), it.id);
  });

  it('每一档都有物品；第 1 档里没有单格物品（单格太好塞，从第 2 档开始）', () => {
    for (const tier of [1, 2, 3]) assert.ok(ITEMS.some((it) => it.tier === tier), `第 ${tier} 档`);
    assert.ok(ITEMS.filter((it) => it.tier === 1).every((it) => it.size >= 2));
  });

  it('形状贴近实物：靴子是 L 形，牛仔裤是 ∩ 形，电脑占 2×3', () => {
    assert.deepEqual(draw(itemById('boot').orients[0] as Orientation), ['#.', '##']);
    assert.deepEqual(draw(itemById('jeans').orients[0] as Orientation), ['###', '#.#']);
    const laptop = itemById('laptop');
    assert.equal(laptop.size, 6);
    assert.deepEqual([laptop.orients[0]?.w, laptop.orients[0]?.h], [3, 2]);
  });

  it('itemById：找得到就返回，找不到抛错', () => {
    assert.equal(itemById('boot').emoji, '🥾');
    assert.throws(() => itemById('nope'), /没有这个物品：nope/);
  });
});

describe('buildItem：输入检查', () => {
  it('shape 里有 # 和 . 以外的字符、或者没有 # 时抛错', () => {
    assert.throws(() => buildItem(def(['#x'])), /不认识的字符 'x'/);
    assert.throws(() => buildItem(def(['..', '..'])), /没有 #/);
    assert.throws(() => buildItem(def([])), /没有 #/);
  });

  it('shape 每行长度不一致也能处理', () => {
    const it = buildItem(def(['###', '#']));
    assert.equal(it.size, 4);
    assert.deepEqual(draw(it.orients[0] as Orientation), ['###', '#..']);
  });
});
