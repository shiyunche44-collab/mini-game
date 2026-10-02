import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INTERSTITIAL_FIRST_LEVEL, newProgress, SAVE_KEY, type Progress } from '../src/core/progress.ts';
import type { ButtonKind } from '../src/game/PlayScene.ts';
import { FakePlatform } from './fake-platform.ts';
import {
  dragIn,
  emojiPos,
  flush,
  frame,
  hasText,
  setupSession,
  traySlotCenter,
  type SessionCtx,
} from './play-helpers.ts';

// 第 1 关：4×3，不能旋转。托盘顺序 0 登山靴  1 帽子  2 登山靴  3 书。
// 答案：书 (0,0)，帽子 (2,0)，靴 0 在 (1,2)，靴 2 在 (0,2)。提示总是先摆最大的：书。
const BOOT_A = 0;
const CAP = 1;
const BOOKS = 3;

const stored = (p: FakePlatform) => p.storage.get<Progress | null>(SAVE_KEY, null);
const progressAt = (level: number): Progress => ({ ...newProgress(), level });
const posOf = (s: SessionCtx, id: number) => s.session.current.game.pieces[id]?.pos ?? null;

/** 点一个按钮的中心 */
function press(s: SessionCtx, kind: ButtonKind): void {
  const r = s.session.current.layout.buttons[kind];
  s.p.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
}

/** 让下一次激励视频停在"正在播"，返回结束它的办法 */
function holdRewarded(p: FakePlatform): { finish: (watched: boolean) => void; asked: () => number } {
  let resolve: (v: boolean) => void = () => {};
  let n = 0;
  const real = p.ads.rewarded;
  p.ads.rewarded = (placement) => {
    n++;
    void real(placement);
    return new Promise<boolean>((r) => (resolve = r));
  };
  return { finish: (watched) => resolve(watched), asked: () => n };
}

describe('提示：看完广告才给', () => {
  it('看完：按答案摆好一件（先摆最大的），记一次提示，存档里也有', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    assert.deepEqual(s.p.adLog, [{ kind: 'rewarded', placement: 'hint' }]);
    assert.deepEqual(posOf(s, BOOKS), { r: 0, c: 0 });
    assert.equal(s.session.current.game.remaining, 3);
    assert.equal(s.session.current.game.hintsUsed, 1);
    assert.equal(stored(s.p)?.game?.snapshot.hints, 1);
    assert.deepEqual(stored(s.p)?.game?.snapshot.pieces[BOOKS], [0, 0, 0]);
  });

  it('提前关闭（没看完）：什么都不给，局面不变，不记提示，不存档', async () => {
    const s = setupSession();
    s.p.queueRewardedResults(false);
    press(s, 'hint');
    await flush();
    assert.equal(s.p.adLog.length, 1); // 问过广告了
    assert.equal(s.session.current.game.remaining, 4);
    assert.equal(s.session.current.game.hintsUsed, 0);
    assert.equal(stored(s.p), null);
  });

  it('没看完之后再点，下一次看完了照样给', async () => {
    const s = setupSession();
    s.p.queueRewardedResults(false, true);
    press(s, 'hint');
    await flush();
    press(s, 'hint');
    await flush();
    assert.equal(s.p.adLog.length, 2);
    assert.equal(s.session.current.game.hintsUsed, 1);
    assert.deepEqual(posOf(s, BOOKS), { r: 0, c: 0 });
  });

  it('摆好的物品从托盘飞到答案的位置，飞完落在箱子里；托盘里留下虚线框', async () => {
    const s = setupSession();
    const home = emojiPos(frame(s.p), '📚');
    press(s, 'hint');
    await flush();
    const mid = emojiPos(frame(s.p), '📚');
    assert.ok(home && mid);
    assert.ok(mid[1] < home[1], '应该已经往上飞了');
    s.p.advance(600);
    const calls = frame(s.p);
    const { grid, cell } = s.session.current.layout.board;
    const end = emojiPos(calls, '📚');
    assert.deepEqual(end, [grid.x + cell, grid.y + cell]);
    assert.equal(calls.filter((c) => c.op === 'setLineDash').length, 1);
  });

  it('答案位置被别的物品占着：占着的被挤回托盘，摆好的这件飞过去', async () => {
    const s = setupSession();
    assert.ok(s.session.current.game.place(CAP, 0, 0)); // 帽子占了书的答案位置
    s.p.advance(16);
    press(s, 'hint');
    await flush();
    assert.deepEqual(posOf(s, BOOKS), { r: 0, c: 0 });
    assert.equal(posOf(s, CAP), null, '帽子被挤回了托盘');
    s.p.advance(600);
    assert.equal(frame(s.p).filter((c) => c.op === 'setLineDash').length, 1); // 只有书的位置是空的
  });

  it('关卡可以旋转时，提示把物品转到答案的朝向再摆', async () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(2));
    const s = setupSession({}, p);
    const level = s.session.current.game.level;
    // 第 2 关：0 号登山靴和 1 号雨伞的形状是唯一的，托盘里的朝向都和答案不同
    for (const id of [0, 1]) assert.notEqual(s.session.current.game.pieces[id]?.oi, level.pieces[id]?.solution.oi);
    for (let i = 0; i < 6 && !(posOf(s, 0) && posOf(s, 1)); i++) {
      press(s, 'hint');
      await flush();
      s.p.advance(400);
    }
    for (const id of [0, 1]) {
      const sol = level.pieces[id]?.solution;
      assert.ok(sol);
      assert.equal(s.session.current.game.pieces[id]?.oi, sol.oi, `第 ${id} 件的朝向`);
      assert.deepEqual(posOf(s, id), { r: sol.r, c: sol.c }, `第 ${id} 件的位置`);
    }
    assert.equal(s.p.ctx.saveDepth, 0);
  });

  it('连点提示直到摆完：最后一次触发过关；提示次数写在登机牌上', async () => {
    const s = setupSession();
    for (let i = 0; i < 4; i++) {
      press(s, 'hint');
      await flush();
      s.p.advance(400);
    }
    assert.ok(s.session.winOverlay);
    assert.equal(s.p.adLog.filter((a) => a.kind === 'rewarded').length, 4);
    assert.deepEqual(stored(s.p), progressAt(2));
    s.p.advance(3000);
    assert.ok(hasText(frame(s.p), '4 次'));
  });
});

describe('广告播放期间', () => {
  it('不响应触摸：拖物品、点旋转、点别的按钮都没用，放完才恢复', async () => {
    const s = setupSession();
    const ad = holdRewarded(s.p);
    press(s, 'hint');
    await flush();
    assert.equal(ad.asked(), 1);

    dragIn(s.ctx(), CAP, 2, 0);
    press(s, 'restart');
    press(s, 'skip');
    assert.equal(s.session.current.game.remaining, 4, '广告期间摆不了东西');
    assert.equal(ad.asked(), 1, '也不会再请求第二个广告');

    ad.finish(true);
    await flush();
    assert.deepEqual(posOf(s, BOOKS), { r: 0, c: 0 });
    // 恢复之后又能操作了
    dragIn(s.ctx(), CAP, 2, 0);
    assert.deepEqual(posOf(s, CAP), { r: 2, c: 0 });
  });

  it('连点提示按钮只问一次广告，给一次提示', async () => {
    const s = setupSession();
    const ad = holdRewarded(s.p);
    press(s, 'hint');
    press(s, 'hint');
    press(s, 'hint');
    await flush();
    ad.finish(true);
    await flush();
    assert.equal(ad.asked(), 1);
    assert.equal(s.session.current.game.hintsUsed, 1);
  });

  it('广告没放完就关了（返回 false）：恢复操作，什么都没给', async () => {
    const s = setupSession();
    const ad = holdRewarded(s.p);
    press(s, 'skip');
    await flush();
    ad.finish(false);
    await flush();
    assert.equal(s.session.current.game.level.n, 1);
    dragIn(s.ctx(), CAP, 2, 0);
    assert.deepEqual(posOf(s, CAP), { r: 2, c: 0 });
  });
});

describe('跳关：看完广告才跳', () => {
  it('看完：进入下一关，存档是下一关，不出现过关画面', async () => {
    const s = setupSession();
    dragIn(s.ctx(), CAP, 2, 0); // 先摆一件，跳关要把进行中的局面清掉
    s.p.advance(400);
    press(s, 'skip');
    await flush();
    assert.deepEqual(s.p.adLog, [{ kind: 'rewarded', placement: 'skip' }]);
    assert.equal(s.session.winOverlay, null);
    assert.equal(s.session.current.game.level.n, 2);
    assert.equal(s.session.current.game.remaining, s.session.current.game.pieces.length);
    assert.deepEqual(stored(s.p), progressAt(2));
    s.p.advance(16);
    assert.ok(hasText(frame(s.p), '第 2 关'));
  });

  it('提前关闭：不跳，还在这一关，已经摆的东西还在', async () => {
    const s = setupSession();
    dragIn(s.ctx(), CAP, 2, 0);
    s.p.advance(400);
    const before = JSON.stringify(stored(s.p));
    s.p.queueRewardedResults(false);
    press(s, 'skip');
    await flush();
    assert.equal(s.session.current.game.level.n, 1);
    assert.deepEqual(posOf(s, CAP), { r: 2, c: 0 });
    assert.equal(JSON.stringify(stored(s.p)), before);
  });

  it('跳过的关卡不弹插屏：就算正好是该弹的关（第 5 关）', async () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(INTERSTITIAL_FIRST_LEVEL));
    const s = setupSession({}, p);
    press(s, 'skip');
    await flush();
    assert.equal(s.session.current.game.level.n, INTERSTITIAL_FIRST_LEVEL + 1);
    assert.deepEqual(p.adLog, [{ kind: 'rewarded', placement: 'skip' }]);
    assert.equal(stored(p)?.lastInterstitialAt, null);
  });

  it('连续跳几关：每关各看一次广告', async () => {
    const s = setupSession();
    for (let i = 0; i < 3; i++) {
      press(s, 'skip');
      await flush();
    }
    assert.equal(s.session.current.game.level.n, 4);
    assert.equal(s.p.adLog.length, 3);
    assert.deepEqual(stored(s.p), progressAt(4));
  });
});

describe('重来：免费', () => {
  it('箱子里的物品全部回到托盘，不看广告，存档里也是空箱子', async () => {
    const s = setupSession();
    dragIn(s.ctx(), BOOKS, 0, 0);
    dragIn(s.ctx(), CAP, 2, 0);
    s.p.advance(400);
    assert.equal(s.session.current.game.remaining, 2);

    press(s, 'restart');
    await flush();
    assert.equal(s.session.current.game.remaining, 4);
    assert.deepEqual(s.p.adLog, []);
    assert.deepEqual(stored(s.p)?.game?.snapshot.pieces.map((x) => x[1]), [-1, -1, -1, -1]);
  });

  it('飞回托盘：画面上物品从箱子里飞回原来在托盘里的位置', () => {
    const s = setupSession();
    const home = emojiPos(frame(s.p), '📚');
    dragIn(s.ctx(), BOOKS, 0, 0);
    s.p.advance(400);
    const inBox = emojiPos(frame(s.p), '📚');
    press(s, 'restart');
    const mid = emojiPos(frame(s.p), '📚');
    assert.ok(home && inBox && mid);
    assert.ok(mid[1] > inBox[1] && mid[1] < home[1], '应该在箱子和托盘之间');
    s.p.advance(600);
    const calls = frame(s.p);
    assert.deepEqual(emojiPos(calls, '📚'), home);
    assert.equal(calls.filter((c) => c.op === 'setLineDash').length, 0);
  });

  it('提示次数保留：提示是看广告换来的，重来不会白白丢掉', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    s.p.advance(400);
    press(s, 'restart');
    await flush();
    assert.equal(s.session.current.game.hintsUsed, 1);
    assert.equal(stored(s.p)?.game?.snapshot.hints, 1);
  });

  it('物品的朝向保留（第 2 关转过的不会被转回去）', () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(2));
    const s = setupSession({}, p);
    s.p.touch.tap(...traySlotCenter(s.ctx(), 0)); // 转登山靴
    s.p.advance(300);
    const turned = s.session.current.game.pieces[0]?.oi;
    press(s, 'restart');
    assert.equal(s.session.current.game.pieces[0]?.oi, turned);
  });

  it('箱子里本来就是空的：什么都没变，不存档', () => {
    const s = setupSession();
    press(s, 'restart');
    assert.equal(stored(s.p), null);
  });

  it('正在飞的物品也一起回去，不会落在重来之后的箱子里', () => {
    const s = setupSession();
    dragIn(s.ctx(), BOOKS, 0, 0); // 刚松手，还在飞
    press(s, 'restart');
    s.p.advance(1000);
    const calls = frame(s.p);
    assert.equal(s.session.current.game.remaining, 4);
    assert.equal(calls.filter((c) => c.op === 'setLineDash').length, 0);
  });
});

describe('按钮的点击范围', () => {
  it('点在按钮之间的空隙、按钮下面，不触发任何按钮', async () => {
    const s = setupSession();
    const { restart, hint } = s.session.current.layout.buttons;
    s.p.touch.tap(restart.x + restart.w + (hint.x - restart.x - restart.w) / 2, restart.y + restart.h / 2);
    s.p.touch.tap(hint.x + hint.w / 2, hint.y + hint.h + 3);
    await flush();
    assert.deepEqual(s.p.adLog, []);
  });

  it('调试模式（?level）也能用提示和跳关，只是不写存档', async () => {
    const s = setupSession({ level: 3 });
    press(s, 'hint');
    await flush();
    assert.equal(s.session.current.game.hintsUsed, 1);
    press(s, 'skip');
    await flush();
    assert.equal(s.session.current.game.level.n, 4);
    assert.equal(stored(s.p), null);
  });
});
