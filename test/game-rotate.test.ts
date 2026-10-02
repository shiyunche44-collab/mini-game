import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SHAKE_CELLS } from '../src/game/PlayScene.ts';
import type { DrawCall } from './fake-platform.ts';
import { dragIn, emojiCalls, emojiPos, FRAME, frame, setup, trayOrigin, traySlotCenter } from './play-helpers.ts';

// 第 2 关：4 列 4 行，可以旋转。托盘顺序：
//   0 登山靴（4 个朝向）  1 雨伞（2 个）  2 帽子（2 个）  3 书（只有 1 个朝向）  4 运动鞋（2 个）  5 帽子（2 个）
const BOOT = 0;
const UMBRELLA = 1;
const BOOKS = 3;

const oiOf = (c: ReturnType<typeof setup>, id: number) => c.game.pieces[id]?.oi;
const rotates = (calls: DrawCall[]) => calls.filter((c) => c.op === 'rotate').map((c) => c.args[0] as number);
/** 抖动时画物品前会 translate(dx, 0)；转动的 translate 两个方向都不为 0（除非中心恰好在原点） */
const shakeOffsets = (calls: DrawCall[]) =>
  calls.filter((c) => c.op === 'translate' && c.args[1] === 0 && c.args[0] !== 0).map((c) => c.args[0] as number);

describe('点按旋转：托盘里', () => {
  it('点一下，顺时针转到下一个朝向；4 个朝向的转 4 下回到原样', () => {
    const c = setup(2);
    const start = oiOf(c, BOOT) ?? 0;
    const n = c.game.pieces[BOOT]?.item.orients.length ?? 0;
    assert.equal(n, 4);
    c.p.touch.tap(...traySlotCenter(c, BOOT));
    assert.equal(oiOf(c, BOOT), (start + 1) % n);
    for (let i = 0; i < 3; i++) {
      c.p.advance(300);
      c.p.touch.tap(...traySlotCenter(c, BOOT));
    }
    assert.equal(oiOf(c, BOOT), start);
  });

  it('点按物品位置里的空白处也能转（外框里缺的那一角）', () => {
    const c = setup(2);
    const { x, y, o, t } = trayOrigin(c, BOOT); // 登山靴是 L 形，外框 2×2，缺一角
    const has = new Set(o.cells.map(([r, col]) => `${r},${col}`));
    let hole: [number, number] | null = null;
    for (let r = 0; r < o.h; r++) for (let col = 0; col < o.w; col++) if (!has.has(`${r},${col}`)) hole = [r, col];
    assert.ok(hole);
    const before = oiOf(c, BOOT) ?? 0;
    c.p.touch.tap(x + (hole[1] + 0.5) * t, y + (hole[0] + 0.5) * t);
    assert.notEqual(oiOf(c, BOOT), before);
  });

  it('转的时候有动画：从倒转 90° 的样子转回正，最后恢复静止', () => {
    const c = setup(2);
    c.p.touch.tap(...traySlotCenter(c, UMBRELLA));
    const angles: number[] = [];
    for (let i = 0; i < 30; i++) angles.push(...rotates(frame(c.p)));
    const first = angles[0] ?? 0;
    assert.ok(first < 0 && first > -Math.PI / 2, `第一帧的角度 ${first}`);
    // 转过头一点再回来：中间有大于 0 的角度，最后一次旋转调用是 0 或很接近 0
    assert.ok(angles.some((a) => a > 0), '没有过冲');
    assert.ok(Math.abs(angles.at(-1) ?? 1) < 0.05);
    // 动画放完之后不再有旋转调用
    assert.equal(rotates(frame(c.p)).length, 0);
    assert.equal(c.p.ctx.saveDepth, 0);
  });

  it('绕物品转动后外框的中心转', () => {
    const c = setup(2);
    c.p.touch.tap(...traySlotCenter(c, UMBRELLA));
    const calls = frame(c.p);
    const { x, y, o, t } = trayOrigin(c, UMBRELLA); // 转好之后的朝向和位置
    const i = calls.findIndex((x2) => x2.op === 'rotate');
    assert.ok(i > 0);
    const before = calls[i - 1];
    assert.equal(before?.op, 'translate');
    assert.deepEqual(before?.args, [x + (o.w * t) / 2, y + (o.h * t) / 2]);
    // 转完要平移回来
    assert.deepEqual(calls[i + 1]?.args, [-(x + (o.w * t) / 2), -(y + (o.h * t) / 2)]);
  });

  it('旋转后物品还在自己的位置里居中，别的物品一动不动', () => {
    const c = setup(2);
    const others = [0, 2, 3, 4, 5].filter((id) => id !== UMBRELLA);
    const emojiOf = (id: number) => c.game.pieces[id]?.item.emoji ?? '';
    // 同样的 emoji 可能多件（两顶帽子），取每件物品位置里最近的一个，用位置比较
    const before = new Map(others.map((id) => [id, emojiPos(frame(c.p), emojiOf(id))]));
    c.p.touch.tap(...traySlotCenter(c, UMBRELLA));
    c.p.advance(500);
    const calls = frame(c.p);
    for (const id of others) {
      const e = calls.filter((x) => x.op === 'fillText' && x.args[0] === emojiOf(id)).map((x) => [x.args[1], x.args[2]]);
      const b = before.get(id);
      assert.ok(b && e.some(([ex, ey]) => ex === b[0] && ey === b[1]), `第 ${id} 件物品的位置变了`);
    }
    const slot = c.scene.layout.tray.slots[UMBRELLA];
    const { x, y, o, t } = trayOrigin(c, UMBRELLA);
    assert.ok(slot);
    assert.ok(x >= slot.x - 1e-9 && x + o.w * t <= slot.x + slot.w + 1e-9);
    assert.ok(y >= slot.y - 1e-9 && y + o.h * t <= slot.y + slot.h + 1e-9);
  });

  it('连点：接着当前的角度继续转，不会跳回开头；转的次数都算数', () => {
    const c = setup(2);
    const start = oiOf(c, BOOT) ?? 0;
    c.p.touch.tap(...traySlotCenter(c, BOOT));
    c.p.advance(50);
    const midway = rotates(frame(c.p)).at(-1) ?? 0; // 第一下转到一半，还差一点没转正
    assert.ok(midway < 0 && midway > -Math.PI / 2);
    c.p.touch.tap(...traySlotCenter(c, BOOT));
    assert.equal(oiOf(c, BOOT), (start + 2) % 4);
    const next = rotates(frame(c.p))[0] ?? 0;
    // 第二下是在当前角度上再倒转 90°，所以比连点前那一帧又往回转了一大截；如果是从头开始，只会比 -90° 浅
    assert.ok(next < midway - 0.5, `连点前 ${midway}，连点后第一帧 ${next}`);
    c.p.advance(1000);
    assert.equal(rotates(frame(c.p)).length, 0);
  });
});

describe('点按旋转：箱子里', () => {
  it('箱子里的物品点一下也能转，周围有空位就转得开，还在箱子里', () => {
    const c = setup(2);
    assert.ok(c.game.place(UMBRELLA, 0, 0, 0)); // 雨伞横着放在左上角
    c.p.advance(FRAME);
    const { grid, cell } = c.scene.layout.board;
    const before = oiOf(c, UMBRELLA);
    c.p.touch.tap(grid.x + 0.5 * cell, grid.y + 0.5 * cell);
    assert.notEqual(oiOf(c, UMBRELLA), before);
    assert.ok(c.game.pieces[UMBRELLA]?.pos);
    assert.equal(rotates(frame(c.p)).length > 0, true);
  });

  it('周围没空位转不开：状态不变，物品左右抖一下，然后停下', () => {
    const c = setup(2);
    while (c.game.hint()) { /* 全部按答案摆满，箱子里没有一个空格 */ }
    assert.equal(c.game.remaining, 0);
    c.p.advance(FRAME);
    const solved = JSON.stringify(c.game.snapshot());
    const { grid, cell } = c.scene.layout.board;
    const spot = c.game.pieces[UMBRELLA]?.pos;
    assert.ok(spot);
    c.p.touch.tap(grid.x + (spot.c + 0.5) * cell, grid.y + (spot.r + 0.5) * cell);
    assert.equal(JSON.stringify(c.game.snapshot()), solved);

    const offsets: number[] = [];
    let spun = 0;
    for (let i = 0; i < 25; i++) {
      const calls = frame(c.p);
      offsets.push(...shakeOffsets(calls));
      spun += rotates(calls).length;
    }
    assert.equal(spun, 0, '转不开不该有转动动画');
    assert.ok(offsets.some((d) => d > 0) && offsets.some((d) => d < 0), '左右都该抖到');
    const max = Math.max(...offsets.map(Math.abs));
    assert.ok(max <= cell * SHAKE_CELLS + 1e-9, `抖得太大：${max}`);
    // 停下之后没有任何偏移
    assert.equal(shakeOffsets(frame(c.p)).length, 0);
    assert.equal(c.p.ctx.saveDepth, 0);
  });

  it('连点转不开的物品：重新开始抖，不叠加', () => {
    const c = setup(2);
    while (c.game.hint()) { /* 摆满 */ }
    c.p.advance(FRAME);
    const { grid, cell } = c.scene.layout.board;
    const spot = c.game.pieces[UMBRELLA]?.pos;
    assert.ok(spot);
    const at = [grid.x + (spot.c + 0.5) * cell, grid.y + (spot.r + 0.5) * cell] as const;
    c.p.touch.tap(...at);
    c.p.advance(100);
    c.p.touch.tap(...at);
    c.p.advance(1000);
    assert.equal(shakeOffsets(frame(c.p)).length, 0);
  });
});

describe('点按旋转：不该转的时候', () => {
  it('这一关不能旋转（第 1 关）：点了没反应，也没有动画', () => {
    const c = setup(1);
    const before = JSON.stringify(c.game.snapshot());
    c.p.touch.tap(...traySlotCenter(c, 0));
    assert.equal(JSON.stringify(c.game.snapshot()), before);
    const calls = frame(c.p);
    assert.equal(rotates(calls).length, 0);
    assert.equal(shakeOffsets(calls).length, 0);
  });

  it('怎么转都一样的物品（2×2 的书）：点了没反应，也没有动画', () => {
    const c = setup(2);
    const before = JSON.stringify(c.game.snapshot());
    c.p.touch.tap(...traySlotCenter(c, BOOKS));
    assert.equal(JSON.stringify(c.game.snapshot()), before);
    const calls = frame(c.p);
    assert.equal(rotates(calls).length, 0);
    assert.equal(shakeOffsets(calls).length, 0);
  });

  it('点在空白处没反应', () => {
    const c = setup(2);
    const before = JSON.stringify(c.game.snapshot());
    c.p.touch.tap(c.scene.layout.header.x + 30, c.scene.layout.header.y + 20);
    c.p.touch.tap(c.scene.layout.board.grid.x + 5, c.scene.layout.board.grid.y + 5); // 空格子
    assert.equal(JSON.stringify(c.game.snapshot()), before);
    assert.equal(rotates(frame(c.p)).length, 0);
  });

  it('正在飞的物品不能点：落位动画放完才能转', () => {
    const c = setup(2);
    // 雨伞按答案放进箱子（需要它的答案朝向，先转到位）
    const sol = c.game.level.pieces[UMBRELLA]?.solution;
    assert.ok(sol);
    while (oiOf(c, UMBRELLA) !== sol.oi) {
      c.p.touch.tap(...traySlotCenter(c, UMBRELLA));
      c.p.advance(300);
    }
    dragIn(c, UMBRELLA, sol.r, sol.c);
    assert.ok(c.game.pieces[UMBRELLA]?.pos);
    const { grid, cell } = c.scene.layout.board;
    const at = [grid.x + (sol.c + 0.5) * cell, grid.y + (sol.r + 0.5) * cell] as const;
    const oi = oiOf(c, UMBRELLA);
    c.p.touch.tap(...at); // 还在飞
    assert.equal(oiOf(c, UMBRELLA), oi);
    c.p.advance(500);
    c.p.touch.tap(...at); // 落定了
    assert.notEqual(oiOf(c, UMBRELLA), oi);
  });

  it('拖动不会触发旋转', () => {
    const c = setup(2);
    const before = oiOf(c, BOOT);
    const [x, y] = traySlotCenter(c, BOOT);
    c.p.touch.drag([[x, y], [x + 30, y], [x + 60, y]]);
    c.p.advance(500);
    assert.equal(oiOf(c, BOOT), before);
  });
});

describe('点按旋转：和拖动配合', () => {
  it('转好朝向再拖进箱子，按转好的朝向放；点按、拖动一起把第 2 关通关', () => {
    const c = setup(2);
    for (let id = 0; id < c.game.pieces.length; id++) {
      const sol = c.game.level.pieces[id]?.solution;
      assert.ok(sol);
      let taps = 0;
      while (oiOf(c, id) !== sol.oi) {
        assert.ok(++taps <= 3, `第 ${id} 件转了 ${taps} 下还没转对`);
        c.p.touch.tap(...traySlotCenter(c, id));
        c.p.advance(300);
      }
      dragIn(c, id, sol.r, sol.c);
      c.p.advance(300);
      assert.deepEqual(c.game.pieces[id]?.pos, { r: sol.r, c: sol.c }, `第 ${id} 件`);
    }
    assert.equal(c.game.isComplete(), true);
    assert.equal(c.p.ctx.saveDepth, 0);
  });

  it('旋转后托盘里画出的 emoji 数不变', () => {
    const c = setup(2);
    const count = () => emojiCalls(frame(c.p), '🥾').length;
    const before = count();
    c.p.touch.tap(...traySlotCenter(c, BOOT));
    assert.equal(count(), before);
  });
});
