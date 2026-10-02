import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIFT_CELLS } from '../src/game/PlayScene.ts';
import { startGame } from '../src/game/start.ts';
import { FakePlatform } from './fake-platform.ts';
import {
  dragIn,
  emojiCalls,
  emojiPos,
  FRAME,
  fingerFor,
  fontSize,
  frame,
  grabInTray,
  setup,
  trayOrigin,
  type Ctx,
} from './play-helpers.ts';

// 第 1 关：4 列 3 行，托盘顺序  0 登山靴（L，3 格）  1 帽子（1×2）  2 登山靴  3 书（2×2）。不能旋转。
// 答案：书 (0,0)，帽子 (2,0)，靴 0 在 (1,2)，靴 2 在 (0,2)。
const BOOT_A = 0;
const CAP = 1;
const BOOKS = 3;

describe('拖动：把物品拖进箱子', () => {
  it('把书从托盘拖到箱子左上角，放进去了', () => {
    const ctx = setup();
    assert.equal(ctx.game.pieces[BOOKS]?.pos, null);
    dragIn(ctx, BOOKS, 0, 0);
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
    assert.equal(ctx.game.remaining, 3);
  });

  it('落位之后画在箱子里，托盘里留下虚线框', () => {
    const ctx = setup();
    dragIn(ctx, BOOKS, 0, 0);
    ctx.p.advance(500);
    const calls = frame(ctx.p);
    const { grid, cell } = ctx.scene.layout.board;
    const pos = emojiPos(calls, '📚');
    assert.ok(pos);
    // 2×2 的书，emoji 画在中间：离左上角 1 格
    assert.ok(Math.abs(pos[0] - (grid.x + cell)) < 1e-6 && Math.abs(pos[1] - (grid.y + cell)) < 1e-6);
    assert.equal(calls.filter((c) => c.op === 'setLineDash').length, 1);
  });

  it('偏一点也吸附到格子上，不是停在手指松开的地方', () => {
    const ctx = setup();
    dragIn(ctx, BOOKS, 0.3, 0.2);
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
    ctx.p.advance(500);
    const { grid, cell } = ctx.scene.layout.board;
    const pos = emojiPos(frame(ctx.p), '📚');
    assert.ok(pos && Math.abs(pos[0] - (grid.x + cell)) < 1e-6);
  });

  it('拖到哪个位置就落在哪个位置', () => {
    const ctx = setup();
    dragIn(ctx, CAP, 2, 2);
    assert.deepEqual(ctx.game.pieces[CAP]?.pos, { r: 2, c: 2 });
  });

  it('不用等放大动画：按下、移动、抬起一气呵成也放得进去', () => {
    const ctx = setup();
    dragIn(ctx, BOOKS, 1, 2); // fake 的 drag 里时间没有流逝
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 1, c: 2 });
  });

  it('按住的不是物品（行李牌、空白处），拖动什么都不会发生', () => {
    const ctx = setup();
    const before = JSON.stringify(ctx.game.snapshot());
    const { header } = ctx.scene.layout;
    ctx.p.touch.drag([[header.x + 20, header.y + 20], [header.x + 80, header.y + 40], [200, 300]]);
    assert.equal(JSON.stringify(ctx.game.snapshot()), before);
    ctx.p.advance(500);
    assert.equal(frame(ctx.p).filter((c) => c.op === 'setLineDash').length, 0);
  });

  it('只点一下物品（不拖）不会改变任何东西', () => {
    const ctx = setup();
    const before = JSON.stringify(ctx.game.snapshot());
    const g = grabInTray(ctx, BOOKS);
    ctx.p.touch.tap(g.px, g.py);
    assert.equal(JSON.stringify(ctx.game.snapshot()), before);
  });

  it('托盘里物品位置里的空白处也能按住（L 形缺的那一角）', () => {
    const ctx = setup();
    const { x, y, o, t } = trayOrigin(ctx, BOOT_A);
    // 登山靴是 L 形，外框 2×2，缺一角。找到缺的那一格
    const has = new Set(o.cells.map(([r, c]) => `${r},${c}`));
    let hole: [number, number] | null = null;
    for (let r = 0; r < o.h; r++) for (let c = 0; c < o.w; c++) if (!has.has(`${r},${c}`)) hole = [r, c];
    assert.ok(hole);
    const px = x + (hole[1] + 0.5) * t;
    const py = y + (hole[0] + 0.5) * t;
    ctx.p.touch.drag([[px, py], [px + 15, py], [px + 30, py]]);
    ctx.p.advance(500); // 没放进箱子，飞回托盘，状态不变
    assert.equal(ctx.game.pieces[BOOT_A]?.pos, null);
  });
});

describe('拖动：手指拿着物品时', () => {
  function holding(c: Ctx, id: number, r: number, col: number) {
    const g = grabInTray(c, id);
    const [fx, fy] = fingerFor(c, g, r, col);
    c.p.touch.down(g.px, g.py);
    c.p.touch.move(g.px + 15, g.py);
    c.p.advance(300); // 放大动画走完
    c.p.touch.move(fx, fy);
    return { g, fx, fy };
  }

  it('放大到箱子里的大小', () => {
    const ctx = setup();
    const before = fontSize(emojiCalls(frame(ctx.p), '📚')[0]);
    holding(ctx, BOOKS, 0, 0);
    const during = fontSize(emojiCalls(frame(ctx.p), '📚')[0]);
    assert.equal(during, Math.round(ctx.scene.layout.board.cell * 1.2));
    assert.ok(during > before, `拿起前 ${before}px，拿起后 ${during}px`);
  });

  it('跟着手指走：手指挪动，物品也挪动同样的距离', () => {
    const ctx = setup();
    const { fx, fy } = holding(ctx, BOOKS, 0, 0);
    const a = emojiPos(frame(ctx.p), '📚');
    ctx.p.touch.move(fx + 40, fy + 25);
    const b = emojiPos(frame(ctx.p), '📚');
    assert.ok(a && b);
    assert.ok(Math.abs(b[0] - a[0] - 40) < 1e-6 && Math.abs(b[1] - a[1] - 25) < 1e-6);
  });

  it('比手指高：抓的那一点在手指上方', () => {
    const ctx = setup();
    const { g, fx, fy } = holding(ctx, BOOKS, 0, 0);
    const { cell } = ctx.scene.layout.board;
    // 外框左上角 = 手指 - 抓的比例 × 外框大小 - 抬高。抓点（外框内 fx, fy 处）比手指高 LIFT_CELLS 格
    const pos = emojiPos(frame(ctx.p), '📚');
    assert.ok(pos);
    // emoji 在外框中心 (1, 1) 格处；抓点在 (g.fx*2, g.fy*2) 格处
    const grabY = pos[1] - (1 - g.fy * 2) * cell;
    assert.ok(Math.abs(grabY - (fy - LIFT_CELLS * cell)) < 1e-6);
    assert.ok(Math.abs(pos[0] - (1 - g.fx * 2) * cell - fx) < 1e-6);
  });

  it('托盘里留下虚线框，物品不在托盘里重复画', () => {
    const ctx = setup();
    holding(ctx, BOOKS, 0, 0);
    const calls = frame(ctx.p);
    assert.equal(calls.filter((c) => c.op === 'setLineDash').length, 1);
    assert.equal(emojiCalls(calls, '📚').length, 2); // 预览一个，手上拿着的一个
  });

  it('拖到放得下的位置，在那里画半透明的预览', () => {
    const ctx = setup();
    holding(ctx, BOOKS, 0, 0);
    const calls = frame(ctx.p);
    const { grid, cell } = ctx.scene.layout.board;
    const ghost = emojiCalls(calls, '📚').find((c) => c.style.globalAlpha < 1);
    assert.ok(ghost, '没有画预览');
    assert.deepEqual([ghost.args[1], ghost.args[2]], [grid.x + cell, grid.y + cell]);
    assert.equal(ghost.style.globalAlpha, 0.5);
  });

  it('拖到放不下的地方（被占着、箱子外），没有预览', () => {
    const ctx = setup();
    ctx.game.place(BOOKS, 0, 0);
    holding(ctx, CAP, 0, 0); // 帽子拖到书上面
    assert.equal(emojiCalls(frame(ctx.p), '🧢').filter((c) => c.style.globalAlpha < 1).length, 0);

    const ctx2 = setup();
    const g = grabInTray(ctx2, BOOKS);
    ctx2.p.touch.down(g.px, g.py);
    ctx2.p.touch.move(g.px + 15, g.py);
    ctx2.p.touch.move(ctx2.scene.layout.header.x + 50, ctx2.scene.layout.header.y + 30);
    assert.equal(emojiCalls(frame(ctx2.p), '📚').filter((c) => c.style.globalAlpha < 1).length, 0);
  });

  it('拿着的时候状态不变，松手才改', () => {
    const ctx = setup();
    holding(ctx, BOOKS, 0, 0);
    assert.equal(ctx.game.pieces[BOOKS]?.pos, null);
    assert.equal(ctx.game.remaining, 4);
  });

  it('手指拖着物品经过别的位置，预览跟着换', () => {
    const ctx = setup();
    const { g } = holding(ctx, BOOKS, 0, 0);
    const [fx, fy] = fingerFor(ctx, g, 1, 2);
    ctx.p.touch.move(fx, fy);
    const { grid, cell } = ctx.scene.layout.board;
    const ghost = emojiCalls(frame(ctx.p), '📚').find((c) => c.style.globalAlpha < 1);
    assert.deepEqual([ghost?.args[1], ghost?.args[2]], [grid.x + 3 * cell, grid.y + 2 * cell]);
  });
});

describe('拖动：放不下就退回', () => {
  it('在箱子外松手：从托盘拿的飞回托盘，状态不变，回到原来的位置', () => {
    const ctx = setup();
    const home = emojiPos(frame(ctx.p), '📚');
    const g = grabInTray(ctx, BOOKS);
    const { header } = ctx.scene.layout;
    ctx.p.touch.drag([[g.px, g.py], [g.px + 15, g.py], [header.x + 50, header.y + 30]]);
    assert.equal(ctx.game.pieces[BOOKS]?.pos, null);

    ctx.p.advance(1000);
    assert.deepEqual(emojiPos(frame(ctx.p), '📚'), home);
    assert.equal(frame(ctx.p).filter((c) => c.op === 'setLineDash').length, 0);
  });

  it('飞回去是有过程的：中途在手指松开的位置和托盘之间', () => {
    const ctx = setup();
    const home = emojiPos(frame(ctx.p), '📚');
    assert.ok(home);
    const g = grabInTray(ctx, BOOKS);
    const { header } = ctx.scene.layout;
    ctx.p.touch.drag([[g.px, g.py], [g.px + 15, g.py], [header.x + 50, header.y + 30]]);
    const start = emojiPos(frame(ctx.p), '📚');
    ctx.p.advance(100);
    const mid = emojiPos(frame(ctx.p), '📚');
    assert.ok(start && mid);
    assert.ok(mid[1] > start[1] && mid[1] < home[1], `起 ${start[1]} 中 ${mid[1]} 终 ${home[1]}`);
  });

  it('放在被别的物品占着的位置：放不下，退回托盘，已经放好的不受影响', () => {
    const ctx = setup();
    ctx.game.place(BOOKS, 0, 0);
    dragIn(ctx, CAP, 0, 0);
    assert.equal(ctx.game.pieces[CAP]?.pos, null);
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
  });

  it('被打断（系统取消触摸）：什么都不改，物品飞回去', () => {
    const ctx = setup();
    const home = emojiPos(frame(ctx.p), '📚');
    const g = grabInTray(ctx, BOOKS);
    const [fx, fy] = fingerFor(ctx, g, 0, 0);
    ctx.p.touch.down(g.px, g.py);
    ctx.p.touch.move(g.px + 15, g.py);
    ctx.p.touch.move(fx, fy);
    ctx.p.touch.cancel(fx, fy);
    assert.equal(ctx.game.pieces[BOOKS]?.pos, null); // 就算正好拖在放得下的位置也不放
    ctx.p.advance(1000);
    assert.deepEqual(emojiPos(frame(ctx.p), '📚'), home);
  });
});

describe('拖动：箱子里的物品', () => {
  it('从箱子里拿起，放到另一个空位：挪过去了', () => {
    const ctx = setup();
    ctx.game.place(CAP, 2, 0);
    ctx.p.advance(FRAME);
    const { grid, cell } = ctx.scene.layout.board;
    // 按在帽子左边那一格的中心，拖到 (0, 2)：外框左上角落在 (0,2)，抓的点是第一格中心，占外框宽 1/4、高 1/2
    const px = grid.x + 0.5 * cell;
    const py = grid.y + 2.5 * cell;
    const fx = grid.x + 2 * cell + 0.25 * 2 * cell;
    const fy = grid.y + 0 * cell + 0.5 * cell + LIFT_CELLS * cell;
    ctx.p.touch.drag([[px, py], [px + 15, py], [fx, fy]]);
    assert.deepEqual(ctx.game.pieces[CAP]?.pos, { r: 0, c: 2 });
  });

  it('拿起来在原位附近放下：回到原位', () => {
    const ctx = setup();
    ctx.game.place(CAP, 2, 0);
    ctx.p.advance(FRAME);
    const { grid, cell } = ctx.scene.layout.board;
    const px = grid.x + 0.5 * cell;
    const py = grid.y + 2.5 * cell;
    ctx.p.touch.drag([[px, py], [px + 15, py], [px + 10, py + LIFT_CELLS * cell]]);
    assert.deepEqual(ctx.game.pieces[CAP]?.pos, { r: 2, c: 0 });
  });

  it('从箱子里拿起，松手在放不下的地方：回到原来的位置，不是回托盘', () => {
    const ctx = setup();
    ctx.game.place(CAP, 2, 0);
    ctx.game.place(BOOKS, 0, 0);
    ctx.p.advance(FRAME);
    const { grid, cell } = ctx.scene.layout.board;
    const { header } = ctx.scene.layout;
    ctx.p.touch.drag([[grid.x + 0.5 * cell, grid.y + 2.5 * cell], [grid.x + 0.5 * cell + 15, grid.y + 2.5 * cell], [header.x + 40, header.y + 30]]);
    assert.deepEqual(ctx.game.pieces[CAP]?.pos, { r: 2, c: 0 });
    ctx.p.advance(1000);
    const { grid: g2 } = ctx.scene.layout.board;
    const pos = emojiPos(frame(ctx.p), '🧢');
    assert.ok(pos);
    assert.ok(pos[0] >= g2.x && pos[1] >= g2.y); // 画在箱子里
  });

  it('从箱子里拿起，松手在托盘上：退回托盘', () => {
    const ctx = setup();
    ctx.game.place(CAP, 2, 0);
    ctx.p.advance(FRAME);
    const { grid, cell, } = ctx.scene.layout.board;
    const { panel } = ctx.scene.layout.tray;
    ctx.p.touch.drag([[grid.x + 0.5 * cell, grid.y + 2.5 * cell], [grid.x + 0.5 * cell + 15, grid.y + 2.5 * cell], [panel.x + panel.w / 2, panel.y + panel.h / 2]]);
    assert.equal(ctx.game.pieces[CAP]?.pos, null);
    assert.equal(ctx.game.remaining, 4);
    ctx.p.advance(1000);
    assert.equal(frame(ctx.p).filter((c) => c.op === 'setLineDash').length, 0);
  });

  it('拿起来的那一刻箱子里的格子空出来：它原来占的位置不会挡着自己', () => {
    const ctx = setup();
    ctx.game.place(CAP, 2, 0);
    ctx.p.advance(FRAME);
    const { grid, cell } = ctx.scene.layout.board;
    // 往右挪一格（和自己原来占的格子有重叠）
    const px = grid.x + 0.5 * cell;
    const py = grid.y + 2.5 * cell;
    ctx.p.touch.drag([[px, py], [px + 15, py], [px + cell, py + LIFT_CELLS * cell]]);
    assert.deepEqual(ctx.game.pieces[CAP]?.pos, { r: 2, c: 1 });
  });
});

describe('拖动：别的情况', () => {
  it('第二根手指不影响第一根的拖动', () => {
    const ctx = setup();
    const g = grabInTray(ctx, BOOKS);
    const [fx, fy] = fingerFor(ctx, g, 0, 0);
    ctx.p.touch.down(g.px, g.py, 1);
    ctx.p.touch.move(g.px + 15, g.py, 1);
    ctx.p.touch.down(10, 10, 2);
    ctx.p.touch.move(300, 300, 2);
    ctx.p.touch.up(300, 300, 2);
    ctx.p.touch.move(fx, fy, 1);
    ctx.p.touch.up(fx, fy, 1);
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
  });

  it('正在落位的物品不能被马上抓走；落定之后可以', () => {
    const ctx = setup();
    dragIn(ctx, BOOKS, 0, 0);
    const { grid, cell } = ctx.scene.layout.board;
    const inBook = [grid.x + 0.5 * cell, grid.y + 0.5 * cell] as const;
    // 刚松手，还在飞：按在它上面拖，抓不起来
    ctx.p.touch.drag([inBook, [inBook[0] + 15, inBook[1]], [inBook[0] + 15, inBook[1] + 200]]);
    assert.deepEqual(ctx.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
    ctx.p.advance(500);
    // 落定后可以拿起来，拖到托盘退回
    const { panel } = ctx.scene.layout.tray;
    ctx.p.touch.drag([inBook, [inBook[0] + 15, inBook[1]], [panel.x + panel.w / 2, panel.y + panel.h / 2]]);
    assert.equal(ctx.game.pieces[BOOKS]?.pos, null);
  });

  it('一局里每件物品都能拖进箱子：照答案拖完，过关', () => {
    const ctx = setup();
    for (let id = 0; id < ctx.game.pieces.length; id++) {
      const s = ctx.game.level.pieces[id]?.solution;
      assert.ok(s);
      dragIn(ctx, id, s.r, s.c);
      ctx.p.advance(300);
      assert.deepEqual(ctx.game.pieces[id]?.pos, { r: s.r, c: s.c }, `第 ${id} 件`);
    }
    assert.equal(ctx.game.isComplete(), true);
    assert.equal(ctx.game.remaining, 0);
  });

  it('拖动全程 save / restore 配对，没有残留的虚线或透明度', () => {
    const ctx = setup();
    const g = grabInTray(ctx, BOOKS);
    const [fx, fy] = fingerFor(ctx, g, 0, 0);
    ctx.p.touch.down(g.px, g.py);
    ctx.p.touch.move(g.px + 15, g.py);
    ctx.p.touch.move(fx, fy);
    ctx.p.advance(200);
    assert.equal(ctx.p.ctx.saveDepth, 0);
    assert.equal(ctx.p.ctx.globalAlpha, 1);
    ctx.p.touch.up(fx, fy);
    ctx.p.advance(500);
    assert.equal(ctx.p.ctx.saveDepth, 0);
    assert.equal(ctx.p.ctx.globalAlpha, 1);
  });
});

describe('startGame：接好了手势', () => {
  it('从入口启动的游戏，拖动也有效：画面里出现了手上拿着的物品', () => {
    const p = new FakePlatform();
    startGame(p, { level: 1 });
    p.advance(FRAME);
    const book = p.ctx.calls.filter((c) => c.op === 'fillText' && c.args[0] === '📚');
    assert.equal(book.length, 1);
    const [, x, y] = book[0]?.args as [string, number, number];
    p.touch.down(x, y);
    p.touch.move(x + 15, y);
    p.touch.move(x + 15, y - 120);
    p.advance(300);
    p.ctx.clearCalls();
    p.advance(FRAME);
    const now = p.ctx.calls.filter((c) => c.op === 'fillText' && c.args[0] === '📚');
    assert.ok(now.length >= 1);
    // 手指往上拖了，物品也跟着往上
    const moved = now[now.length - 1]?.args as [string, number, number];
    assert.ok(moved[2] < y);
  });
});
