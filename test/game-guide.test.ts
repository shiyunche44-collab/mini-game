import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newProgress, SAVE_KEY } from '../src/core/progress.ts';
import { dragPose, GUIDE_IDLE_MS, rotatePose } from '../src/game/Guide.ts';
import { GUIDE_LAST_LEVEL } from '../src/game/Session.ts';
import { FakePlatform } from './fake-platform.ts';
import { dragIn, emojiCalls, emojiPos, flush, frame, setupSession, traySlotCenter, type SessionCtx } from './play-helpers.ts';

const FINGER = '👆';
const progressAt = (level: number) => ({ ...newProgress(), level });
const startAt = (level: number): SessionCtx => {
  const p = new FakePlatform();
  p.storage.set(SAVE_KEY, progressAt(level));
  return setupSession({}, p);
};
const fingerAt = (s: SessionCtx) => emojiPos(frame(s.p), FINGER);
const showing = (s: SessionCtx) => emojiCalls(frame(s.p), FINGER).length > 0;

describe('引导的时间线（纯函数）', () => {
  it('drag：手先出现，再走到终点，预览在手快到时亮起，最后手淡出', () => {
    assert.equal(dragPose(0).alpha, 0);
    assert.equal(dragPose(300).alpha, 1);
    assert.equal(dragPose(300).move, 0, '按下去之前还没开始走');
    assert.equal(dragPose(1300).move, 1);
    assert.equal(dragPose(500).ghost, 0);
    assert.equal(dragPose(1500).ghost, 1);
    assert.ok(dragPose(2000).alpha < 1 && dragPose(2000).alpha > 0, '淡出');
    assert.equal(dragPose(2300).alpha, 0, '一轮最后留一段空白');
    const moves = [400, 600, 800, 1000, 1300].map((t) => dragPose(t).move);
    assert.deepEqual([...moves].sort((a, b) => a - b), moves, '只往前走');
  });

  it('rotate：点两下，每下荡开一圈涟漪，按下的那一刻手最低', () => {
    assert.deepEqual(rotatePose(0).ripples, [-1, -1]);
    assert.ok(rotatePose(700).ripples[0] > 0 && rotatePose(700).ripples[1] === -1);
    assert.ok(rotatePose(1400).ripples[1] > 0 && rotatePose(1400).ripples[0] === -1);
    assert.equal(rotatePose(500).press, 1);
    assert.equal(rotatePose(900).press, 0);
    assert.equal(rotatePose(2500).alpha, 0);
  });
});

describe('第 1 关：演示拖动', () => {
  it('刚进来不演示，愣了一会儿才出现手', () => {
    const s = setupSession();
    assert.equal(showing(s), false);
    s.p.advance(GUIDE_IDLE_MS - 200);
    assert.equal(showing(s), false);
    s.p.advance(700);
    assert.equal(s.session.current.guiding, 'drag');
  });

  it('手从托盘里的物品出发，走向它在箱子里的位置，那里有预览', () => {
    const s = setupSession();
    s.p.advance(GUIDE_IDLE_MS + 300); // 手出现了
    const start = fingerAt(s);
    assert.ok(start);
    const slot = s.session.current.layout.tray.slots;
    assert.ok(slot.some((r) => start[0] > r.x && start[0] < r.x + r.w + 10 && start[1] > r.y), '起点在托盘里');
    s.p.advance(600);
    const mid = fingerAt(s);
    s.p.advance(500);
    const end = fingerAt(s);
    assert.ok(mid && end);
    const { grid, cell, frame: box } = s.session.current.layout.board;
    assert.ok(mid[1] < start[1], '往上走（托盘在箱子下面）');
    assert.ok(end[1] < mid[1]);
    assert.ok(end[0] > box.x && end[0] < box.x + box.w && end[1] > grid.y && end[1] < grid.y + grid.h, '终点在箱子里');
    // 到的时候预览亮着：画了半透明的物品
    const calls = frame(s.p);
    assert.ok(calls.some((c) => c.op === 'fillText' && c.style.globalAlpha < 1 && c.args[0] !== FINGER), '有半透明的预览');
    assert.ok(cell > 0);
  });

  it('演示的手一圈一圈地循环', () => {
    const s = setupSession();
    s.p.advance(GUIDE_IDLE_MS + 300);
    const first = fingerAt(s);
    s.p.advance(3200);
    assert.deepEqual(fingerAt(s), first);
    assert.equal(s.p.ctx.saveDepth, 0);
  });

  it('玩家一碰屏幕手就消失，再愣一会儿又出现', () => {
    const s = setupSession();
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.equal(showing(s), true);
    const [x, y] = [5, 5]; // 点在空白处
    s.p.touch.tap(x, y);
    assert.equal(showing(s), false);
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.equal(showing(s), true);
  });

  it('玩家拖过一次物品：这一关不再演示', () => {
    const s = setupSession();
    dragIn(s.ctx(), 1, 2, 0);
    s.p.advance(GUIDE_IDLE_MS * 4);
    assert.equal(showing(s), false);
    assert.equal(s.session.current.guiding, null);
  });

  it('演示挑还没摆的物品：玩家摆好第一件之后，手改从下一件出发', () => {
    const s = setupSession();
    const near = (id: number, at: [number, number] | null) => {
      const [cx, cy] = traySlotCenter(s.ctx(), id);
      return at !== null && Math.abs(at[0] - cx) < 12 && Math.abs(at[1] - cy) < 30;
    };
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.ok(near(0, fingerAt(s)), '从第 0 件出发');
    // 直接摆（不是玩家拖的，所以引导还在）：把第 0 件摆在它的答案位置
    assert.ok(s.session.current.game.place(0, 1, 2));
    assert.ok(near(1, fingerAt(s)), '改从第 1 件出发');
  });

  it('答案的位置被别的物品占着：不演示这一件，演示下一件', () => {
    const s = setupSession();
    assert.ok(s.session.current.game.place(1, 1, 2)); // 帽子占了第 0 件（登山靴）的答案位置
    s.p.advance(GUIDE_IDLE_MS + 300);
    const at = fingerAt(s);
    const [cx] = traySlotCenter(s.ctx(), 0);
    assert.ok(at && Math.abs(at[0] - cx) > 12, '不是从第 0 件出发');
  });

  it('装满了（过关画面出来）就不再演示', () => {
    const s = setupSession({ level: 1, hints: 99 });
    s.p.advance(GUIDE_IDLE_MS * 3);
    assert.equal(emojiCalls(frame(s.p), FINGER).length, 0);
  });
});

describe('第 2、3 关：演示点按旋转', () => {
  it('第 2 关：手点在一件朝向不对的物品上，荡开涟漪', () => {
    const s = startAt(2);
    assert.equal(showing(s), false);
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.equal(s.session.current.guiding, 'rotate');
    const at = fingerAt(s);
    assert.ok(at);
    const game = s.session.current.game;
    const target = game.pieces.find((p) => !p.pos && p.item.orients.length > 1 && p.oi !== game.level.pieces[p.id]?.solution.oi);
    assert.ok(target);
    const slot = s.session.current.layout.tray.slots[target.id];
    assert.ok(slot && at[0] > slot.x && at[0] < slot.x + slot.w + 10, '手在这件物品的位置上');
    s.p.advance(250);
    const rippling = frame(s.p).filter((c) => c.op === 'arc' && c.style.globalAlpha < 1 && c.style.globalAlpha > 0);
    assert.ok(rippling.length > 0, '有涟漪');
  });

  it('玩家转过一次：不再演示旋转，也不改演示拖动', () => {
    const s = startAt(2);
    const game = s.session.current.game;
    const target = game.pieces.find((p) => p.item.orients.length > 1);
    assert.ok(target);
    s.p.touch.tap(...traySlotCenter(s.ctx(), target.id));
    s.p.advance(GUIDE_IDLE_MS * 3);
    assert.equal(showing(s), false);
  });

  it('第 1 关里转不了：不演示旋转', () => {
    const s = setupSession();
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.equal(s.session.current.guiding, 'drag');
  });

  it('玩家在前面的关卡会了，后面的关卡就不演示：拖过之后进第 2 关，只演示旋转，转过之后第 3 关什么都不演示', async () => {
    const s = setupSession();
    dragIn(s.ctx(), 1, 2, 0);
    s.p.advance(300);
    press(s, 'skip');
    await flush();
    s.p.advance(500);
    assert.equal(s.session.current.game.level.n, 2);
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.equal(s.session.current.guiding, 'rotate', '拖会了，旋转还没教');
    const game = s.session.current.game;
    const target = game.pieces.find((p) => p.item.orients.length > 1);
    assert.ok(target);
    s.p.touch.tap(...traySlotCenter(s.ctx(), target.id));
    s.p.advance(300);
    press(s, 'skip');
    await flush();
    s.p.advance(500);
    assert.equal(s.session.current.game.level.n, 3);
    s.p.advance(GUIDE_IDLE_MS * 3);
    assert.equal(s.session.current.guiding, null);
    assert.equal(showing(s), false);
  });
});

describe('引导只在前几关', () => {
  it(`第 ${GUIDE_LAST_LEVEL + 1} 关起不演示，愣多久都不演示`, () => {
    for (const n of [GUIDE_LAST_LEVEL + 1, 10, 50]) {
      const s = startAt(n);
      s.p.advance(GUIDE_IDLE_MS * 5);
      assert.equal(showing(s), false, `第 ${n} 关`);
      assert.equal(s.session.current.guiding, null);
    }
  });

  it('重新打开游戏：不存档，所以在第 3 关重新打开最多再演示一次', () => {
    const s = startAt(3);
    s.p.advance(GUIDE_IDLE_MS + 300);
    assert.ok(s.session.current.guiding);
  });

  it('不影响存档：演示什么都不写', () => {
    const s = setupSession();
    s.p.advance(GUIDE_IDLE_MS * 3);
    assert.equal(s.p.storage.get(SAVE_KEY, null), null);
  });
});

import type { ButtonKind } from '../src/game/PlayScene.ts';
function press(s: SessionCtx, kind: ButtonKind): void {
  const r = s.session.current.layout.buttons[kind];
  s.p.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
}
