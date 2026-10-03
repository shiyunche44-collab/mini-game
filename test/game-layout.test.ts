import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateLevel } from '../src/core/levels.ts';
import { computeLayout, MAX_CONTENT_WIDTH, packTray, type Rect } from '../src/game/layout.ts';
import type { ScreenInfo } from '../src/platform/types.ts';

function screen(width: number, height: number, safe: Partial<ScreenInfo['safeArea']> = {}): ScreenInfo {
  return { width, height, dpr: 2, safeArea: { top: 0, right: 0, bottom: 0, left: 0, ...safe } };
}

const EPS = 1e-6;
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.h <= outer.y + outer.h + EPS;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

// 前 60 关：覆盖开头手工定的关卡和之后难度循环里每一档
const LEVELS = Array.from({ length: 60 }, (_, i) => generateLevel(i + 1));

const SIZES: readonly [string, ScreenInfo, { board: number; tray: number }][] = [
  ['375×667', screen(375, 667), { board: 30, tray: 18 }],
  ['390×844', screen(390, 844), { board: 40, tray: 22 }],
  ['桌面 1280×800', screen(1280, 800), { board: 40, tray: 22 }],
  ['小屏 320×568', screen(320, 568), { board: 20, tray: 18 }],
  ['带刘海 390×844', screen(390, 844, { top: 47, bottom: 34 }), { board: 38, tray: 20 }],
];

describe('computeLayout：各种屏幕上都放得下', () => {
  for (const [name, scr, min] of SIZES) {
    it(`${name}：前 60 关所有元素都在内容区里，互不重叠，托盘里每件物品都有位置`, () => {
      for (const level of LEVELS) {
        const l = computeLayout(scr, level);
        const where = `第 ${level.n} 关`;

        // 都在内容区里
        const parts: [string, Rect][] = [
          ['行李牌', l.header],
          ['箱子', l.board.frame],
          ['托盘', l.tray.panel],
          ['重来', l.buttons.restart],
          ['提示', l.buttons.hint],
          ['跳关', l.buttons.skip],
        ];
        if (l.tip) parts.push(['提示语', l.tip]);
        for (const [what, r] of parts) assert.ok(inside(r, l.content), `${where}：${what} 超出了内容区`);

        // 从上到下互不重叠
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            const [na, a] = parts[i] as [string, Rect];
            const [nb, b] = parts[j] as [string, Rect];
            assert.ok(!overlap(a, b), `${where}：${na}和${nb}重叠了`);
          }
        }
        // 静音开关在行李牌里面，够大（手指点得中）
        assert.ok(inside(l.sound, l.header), `${where}：静音开关超出了行李牌`);
        assert.ok(l.sound.w >= 32 && l.sound.h >= 32, `${where}：静音开关太小`);
        // 提手在箱子上面，格子在箱子里面
        assert.ok(l.board.handle.y + l.board.handle.h <= l.board.frame.y + 2 + EPS);
        assert.ok(inside(l.board.grid, l.board.frame), `${where}：格子超出了箱子`);
        assert.equal(l.board.grid.w, level.cols * l.board.cell);
        assert.equal(l.board.grid.h, level.rows * l.board.cell);

        // 托盘：每件物品一个位置，都在托盘里，互不重叠，放得下它最长的一边
        assert.equal(l.tray.slots.length, level.pieces.length);
        l.tray.slots.forEach((s, i) => {
          assert.ok(inside(s, l.tray.panel), `${where}：第 ${i} 件物品超出托盘`);
          assert.equal(s.w, (level.pieces[i]?.item.maxDim ?? 0) * l.tray.cell, `${where}：第 ${i} 件物品的位置大小不对`);
        });
        for (let i = 0; i < l.tray.slots.length; i++) {
          for (let j = i + 1; j < l.tray.slots.length; j++) {
            assert.ok(!overlap(l.tray.slots[i] as Rect, l.tray.slots[j] as Rect), `${where}：物品 ${i} 和 ${j} 重叠了`);
          }
        }

        // 格子够大，看得清、点得准
        assert.ok(l.board.cell >= min.board, `${where}：箱子格子只有 ${l.board.cell}px`);
        assert.ok(l.tray.cell >= min.tray, `${where}：托盘格子只有 ${l.tray.cell}px`);
        assert.ok(l.tray.cell <= l.board.cell);
      }
    });
  }
});

describe('computeLayout：屏幕边缘', () => {
  it('内容不超过最大宽度，在可用区域里居中', () => {
    const l = computeLayout(screen(1280, 800), generateLevel(1));
    assert.equal(l.content.w, MAX_CONTENT_WIDTH);
    assert.equal(l.content.x, (1280 - MAX_CONTENT_WIDTH) / 2);
  });

  it('手机上内容占满宽度，两边留边距', () => {
    const l = computeLayout(screen(375, 667), generateLevel(1));
    assert.equal(l.content.x, 12);
    assert.equal(l.content.w, 375 - 24);
  });

  it('避开安全区：刘海在上面，内容从刘海下面开始；底部横条上面是按钮', () => {
    const l = computeLayout(screen(390, 844, { top: 47, bottom: 34, left: 10, right: 20 }), generateLevel(1));
    assert.ok(l.header.y >= 47);
    assert.ok(l.buttons.hint.y + l.buttons.hint.h <= 844 - 34);
    assert.ok(l.content.x >= 10 && l.content.x + l.content.w <= 390 - 20);
  });

  it('同样的输入，每次算出同样的结果', () => {
    const level = generateLevel(17);
    assert.deepEqual(computeLayout(screen(375, 667), level), computeLayout(screen(375, 667), level));
  });
});

describe('computeLayout：这一关的内容决定哪些东西存在', () => {
  it('有教学提示的关卡有提示语的位置，没有的没有；提示语在行李牌和箱子之间', () => {
    const withTip = computeLayout(screen(375, 667), generateLevel(1));
    const without = computeLayout(screen(375, 667), generateLevel(3));
    assert.ok(withTip.tip);
    assert.equal(without.tip, null);
    assert.ok(withTip.tip && withTip.tip.y >= withTip.header.y + withTip.header.h);
    assert.ok(withTip.tip && withTip.tip.y + withTip.tip.h <= withTip.board.handle.y);
  });

  it('箱子越大格子越小：宽度方向放不下时缩小格子', () => {
    const small = computeLayout(screen(375, 900), generateLevel(1)); // 4 列
    const big = computeLayout(screen(375, 900), generateLevel(11)); // 6 列
    assert.ok(big.board.cell < small.board.cell);
    assert.ok(big.board.frame.w <= big.content.w);
  });
});

describe('packTray：托盘摆放', () => {
  const area: Rect = { x: 0, y: 0, w: 300, h: 200 };

  it('放得下就返回不超过 maxCell 的最大格子', () => {
    const r = packTray([2, 2, 2], area, 30, 10);
    assert.ok(r);
    assert.equal(r?.cell, 30); // 3 件 60px 的正方形，一排放得下
  });

  it('放不下就缩小，缩到最小还放不下返回 null', () => {
    const many = new Array(40).fill(3);
    const r = packTray(many, area, 40, 10);
    assert.ok(r && r.cell < 40);
    assert.equal(packTray(many, { x: 0, y: 0, w: 100, h: 50 }, 40, 10), null);
  });

  it('单件比托盘还宽时那个格子大小不行', () => {
    // 4 格的法棍：格子 > 75 时一件就宽过 300
    const r = packTray([4], area, 100, 10);
    assert.ok(r && r.cell <= 75);
  });

  it('结果按原来的序号排，不按摆放的顺序', () => {
    const r = packTray([1, 4, 2], area, 30, 10);
    assert.deepEqual(
      r?.slots.map((s) => s.w / (r?.cell ?? 1)),
      [1, 4, 2],
    );
  });

  it('托盘没有面积就放不下', () => {
    assert.equal(packTray([1], { x: 0, y: 0, w: 0, h: 100 }, 30, 10), null);
  });
});
