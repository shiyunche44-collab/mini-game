import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { generateLevel } from '../src/core/levels.ts';
import { findSnap, SNAP_RADIUS } from '../src/game/snap.ts';

// 第 1 关：4 列 3 行的箱子，没有拉杆槽，不能旋转。托盘顺序：
//   0 登山靴（3 格 L 形）  1 帽子（1×2，横着）  2 登山靴  3 书（2×2）
const BOOT = 0;
const CAP = 1;
const BOOKS = 3;
const level1 = (): Game => new Game(generateLevel(1));

describe('findSnap：吸附到最近的、放得下的位置', () => {
  it('正对着某个格点，就吸到那里', () => {
    assert.deepEqual(findSnap(level1(), BOOKS, 0, 0), { r: 0, c: 0 });
    assert.deepEqual(findSnap(level1(), BOOKS, 1, 2), { r: 1, c: 2 });
  });

  it('偏一点（不到半格）也吸到最近的格点', () => {
    assert.deepEqual(findSnap(level1(), BOOKS, 0.3, 0.2), { r: 0, c: 0 });
    assert.deepEqual(findSnap(level1(), BOOKS, 0.8, 1.6), { r: 1, c: 2 });
  });

  it('最近的格点放不下（会伸出箱子），就吸到旁边放得下的', () => {
    // 书是 2×2，放在第 1 行就到底了。拖到 r=1.6：最近的格点 r=2 会伸出箱子，吸到 r=1
    assert.deepEqual(findSnap(level1(), BOOKS, 1.6, 0), { r: 1, c: 0 });
    // 同理列方向：4 列，书最右只能从第 2 列开始
    assert.deepEqual(findSnap(level1(), BOOKS, 0, 2.7), { r: 0, c: 2 });
  });

  it('离所有放得下的位置都太远（超过吸附半径），就是没有对准', () => {
    assert.equal(findSnap(level1(), CAP, -3, -3), null);
    assert.equal(findSnap(level1(), CAP, 10, 10), null);
    // 帽子是 1×2，r=2 是最下面一行。拖到 r=3.5，离 r=2 有 1.5 格
    assert.equal(findSnap(level1(), CAP, 3.5, 0), null);
    // 刚好在半径以内、以外
    assert.deepEqual(findSnap(level1(), CAP, 2 + SNAP_RADIUS - 0.01, 0), { r: 2, c: 0 });
    assert.equal(findSnap(level1(), CAP, 2 + SNAP_RADIUS + 0.01, 0), null);
  });

  it('被别的物品占着的地方放不下，吸到离得近的空位', () => {
    const g = level1();
    assert.ok(g.place(BOOKS, 0, 0)); // 书占了左上 2×2
    // 帽子想放到 (0,0)：周围 0.8 格内没有空位
    assert.equal(findSnap(g, CAP, 0, 0), null);
    // 稍微往右一点，(0,2) 是空的
    assert.deepEqual(findSnap(g, CAP, 0.2, 1.6), { r: 0, c: 2 });
  });

  it('自己占着的地方算空的：拿起来在原位附近放，能吸回原位', () => {
    const g = level1();
    assert.ok(g.place(BOOKS, 0, 0));
    assert.deepEqual(findSnap(g, BOOKS, 0.1, 0.1), { r: 0, c: 0 });
  });

  it('拉杆槽挡着的格子放不下', () => {
    // 第 6 关：5 列 6 行，2 个拉杆槽
    const g = new Game(generateLevel(6));
    const blocked = g.level.blocked.map((i) => ({ r: Math.floor(i / g.level.cols), c: i % g.level.cols }));
    assert.equal(blocked.length, 2);
    for (let id = 0; id < g.pieces.length; id++) {
      for (const b of blocked) {
        const snap = findSnap(g, id, b.r, b.c);
        if (!snap) continue;
        const o = g.pieces[id]?.item.orients[g.pieces[id]?.oi ?? 0];
        assert.ok(o);
        // 吸到的位置，物品的每个格子都不在拉杆槽上
        for (const [dr, dc] of o.cells) assert.equal(g.isBlocked(snap.r + dr, snap.c + dc), false);
      }
    }
  });

  it('距离一样近时取靠上、靠左的，结果稳定', () => {
    // 帽子 1×2：r=1.5 离 r=1 和 r=2 一样远；c=0 时只有 c=0 一个合适的列
    assert.deepEqual(findSnap(level1(), CAP, 1.5, 0), { r: 1, c: 0 });
    // 列方向：帽子占 2 列，c 可以是 0、1、2。c=0.5 离 0 和 1 一样远，取 0
    assert.deepEqual(findSnap(level1(), CAP, 0, 0.5), { r: 0, c: 0 });
  });

  it('不存在的物品返回 null', () => {
    assert.equal(findSnap(level1(), 99, 0, 0), null);
  });

  it('不修改 Game 的状态', () => {
    const g = level1();
    const before = JSON.stringify(g.snapshot());
    findSnap(g, BOOT, 1.2, 1.1);
    assert.equal(JSON.stringify(g.snapshot()), before);
  });
});
