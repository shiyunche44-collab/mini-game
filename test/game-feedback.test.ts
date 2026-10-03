import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SAVE_KEY, type Progress } from '../src/core/progress.ts';
import { PRESS_SCALE, type ButtonKind } from '../src/game/PlayScene.ts';
import { SLIDE_MS } from '../src/game/Session.ts';
import { theme } from '../src/game/theme.ts';
import { NEXT_LABEL } from '../src/game/WinOverlay.ts';
import type { DrawCall } from './fake-platform.ts';
import { dragIn, flush, frame, setupSession, solveLevel, textPos, type SessionCtx } from './play-helpers.ts';

// 第 1 关：4×3，不能旋转。托盘顺序 0 登山靴  1 帽子  2 登山靴  3 书。提示先摆最大的：书，答案在 (0,0)。
const CAP = 1;
const BOOKS = 3;

function press(s: SessionCtx, kind: ButtonKind): void {
  const r = s.session.current.layout.buttons[kind];
  s.p.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
}

const scales = (calls: DrawCall[]) => calls.filter((c) => c.op === 'scale').map((c) => c.args[0] as number);
/** 换关的整屏平移。纵向是 0；按钮、转动的平移纵向不是 0，不算 */
const translates = (calls: DrawCall[]) => calls.filter((c) => c.op === 'translate' && c.args[1] === 0).map((c) => c.args[0] as number);
/** 提示高亮是用 theme.hintGlow 填的整块轮廓 */
const glows = (calls: DrawCall[]) => calls.filter((c) => c.op === 'fill' && c.style.fillStyle === theme.hintGlow);

describe('按钮按下的反馈', () => {
  it('点中按钮：按钮缩下去再弹回原样', () => {
    const s = setupSession();
    assert.deepEqual(scales(frame(s.p)), [], '没点之前不缩放');
    press(s, 'restart');
    const sizes = [];
    for (let i = 0; i < 4; i++) sizes.push(Math.min(1, ...scales(frame(s.p))));
    assert.ok(Math.min(...sizes) < 1, '应该缩下去过');
    assert.ok(Math.min(...sizes) >= PRESS_SCALE - 1e-9, '缩得不会比 PRESS_SCALE 更小');
    s.p.advance(300);
    assert.deepEqual(scales(frame(s.p)), [], '弹回之后恢复原样');
    assert.equal(s.p.ctx.saveDepth, 0);
  });

  it('只有被点的那个按钮缩：画面上一次只缩一个', () => {
    const s = setupSession();
    s.p.queueRewardedResults(false);
    press(s, 'hint');
    assert.equal(scales(frame(s.p)).length, 1);
  });

  it('提示和跳关也一样（点下去就有反馈，不用等广告）', async () => {
    const s = setupSession();
    s.p.queueRewardedResults(false, false);
    for (const kind of ['hint', 'skip'] as const) {
      press(s, kind);
      assert.equal(scales(frame(s.p)).length, 1, kind);
      await flush(); // 广告放完（没看完）之后才能再点
      s.p.advance(300);
    }
  });

  it('点在按钮外面：没有反馈', () => {
    const s = setupSession();
    const { restart } = s.session.current.layout.buttons;
    s.p.touch.tap(restart.x + restart.w / 2, restart.y + restart.h + 3);
    assert.deepEqual(scales(frame(s.p)), []);
  });
});

describe('提示高亮', () => {
  it('摆好的物品落稳之后闪光，闪完恢复原样', async () => {
    const s = setupSession();
    assert.equal(glows(frame(s.p)).length, 0);
    press(s, 'hint');
    await flush();
    assert.equal(glows(frame(s.p)).length, 0, '还在飞的时候不闪');
    s.p.advance(300); // 飞完了
    const lit = glows(frame(s.p));
    assert.equal(lit.length, 1);
    assert.ok(lit[0] && lit[0].style.globalAlpha > 0, '亮着');
    s.p.advance(2000);
    assert.equal(glows(frame(s.p)).length, 0, '闪完就没了');
    assert.equal(s.p.ctx.saveDepth, 0);
  });

  it('光只落在提示摆的那一件上，不影响它的位置', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    s.p.advance(300);
    assert.deepEqual(s.session.current.game.pieces[BOOKS]?.pos, { r: 0, c: 0 });
    assert.equal(glows(frame(s.p)).length, 1);
  });

  it('看广告提前关闭：没给提示，也不闪', async () => {
    const s = setupSession();
    s.p.queueRewardedResults(false);
    press(s, 'hint');
    await flush();
    s.p.advance(400);
    assert.equal(glows(frame(s.p)).length, 0);
  });

  it('闪的时候把这件拿起来：光立刻消失', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    s.p.advance(300);
    assert.equal(glows(frame(s.p)).length, 1);
    const { grid, cell } = s.session.current.layout.board;
    // 书占 (0,0) 开始的格子，按在它第一格的中心往外拖
    s.p.touch.drag([[grid.x + cell / 2, grid.y + cell / 2], [grid.x + cell / 2 + 15, grid.y + cell / 2], [grid.x + cell * 2, grid.y + cell * 4]]);
    s.p.advance(400);
    assert.equal(glows(frame(s.p)).length, 0);
  });

  it('闪的时候点重来：光不会留在空箱子里', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    s.p.advance(300);
    press(s, 'restart');
    s.p.advance(16);
    assert.equal(glows(frame(s.p)).length, 0);
  });
});

describe('换关：新的一关从右边滑进来', () => {
  const left = (calls: DrawCall[]) => translates(calls).filter((x) => x < 0);
  const right = (calls: DrawCall[]) => translates(calls).filter((x) => x > 0);

  it('跳关：旧的一关向左滑出去，新的一关从右边滑进来，错开正好一个屏幕宽', async () => {
    const s = setupSession();
    press(s, 'skip');
    await flush();
    assert.equal(s.session.sliding, true);
    assert.equal(s.session.current.game.level.n, 2, '状态上已经是下一关了');
    s.p.advance(60);
    const calls = frame(s.p);
    const out = left(calls);
    const into = right(calls);
    assert.equal(out.length, 1);
    assert.equal(into.length, 1);
    assert.ok(Math.abs((into[0] ?? 0) - (out[0] ?? 0) - s.p.screen.width) < 1e-6);
    assert.ok((into[0] ?? Infinity) < s.p.screen.width, '已经开始进来了');
  });

  it('滑完恢复原样：没有平移，只画新的一关', async () => {
    const s = setupSession();
    press(s, 'skip');
    await flush();
    s.p.advance(SLIDE_MS + 50);
    assert.equal(s.session.sliding, false);
    const calls = frame(s.p);
    assert.deepEqual(translates(calls), []);
    assert.ok(textPos(calls, '第 2 关'));
    assert.equal(s.p.ctx.saveDepth, 0);
  });

  it('通关点"下一站"：登机牌跟着旧的一关一起滑走', async () => {
    const s = setupSession();
    solveLevel(s.ctx());
    s.p.advance(3000);
    const next = textPos(frame(s.p), NEXT_LABEL);
    assert.ok(next);
    s.p.touch.tap(...next);
    await flush();
    s.p.advance(60);
    const calls = frame(s.p);
    assert.ok(textPos(calls, NEXT_LABEL), '滑动中还能看见登机牌');
    assert.equal(s.session.winOverlay, null, '新的一关没有过关画面');
    s.p.advance(SLIDE_MS);
    assert.equal(textPos(frame(s.p), NEXT_LABEL), null);
  });

  it('滑动期间不响应触摸：拖不动物品、点不了按钮；滑完恢复', async () => {
    const s = setupSession();
    press(s, 'skip');
    await flush();
    s.p.advance(60);
    dragIn(s.ctx(), CAP, 2, 0);
    press(s, 'restart');
    press(s, 'skip');
    await flush();
    assert.equal(s.session.current.game.remaining, s.session.current.game.pieces.length);
    assert.equal(s.p.adLog.length, 1, '没有再问广告');
    assert.equal(s.session.current.game.level.n, 2);

    s.p.advance(SLIDE_MS);
    press(s, 'hint');
    await flush();
    assert.equal(s.p.adLog.length, 2, '滑完又能点了');
  });

  it('滑动期间存档已经是新的一关：这时退出也不会丢', async () => {
    const s = setupSession();
    press(s, 'skip');
    await flush();
    assert.equal(s.session.saved.level, 2);
    assert.equal(s.p.storage.get<Progress | null>(SAVE_KEY, null)?.level, 2);
  });
});
