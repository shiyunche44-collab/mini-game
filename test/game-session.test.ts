import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GENERATOR_VERSION } from '../src/core/levels.ts';
import { INTERSTITIAL_MIN_GAP_MS, newProgress, SAVE_KEY, type Progress } from '../src/core/progress.ts';
import { SLIDE_MS } from '../src/game/Session.ts';
import { NEXT_LABEL } from '../src/game/WinOverlay.ts';
import { FakePlatform } from './fake-platform.ts';
import {
  dragIn,
  flush,
  frame,
  hasText,
  setupSession,
  solveLevel,
  textPos,
  traySlotCenter,
} from './play-helpers.ts';

const progressAt = (level: number, extra: Partial<Progress> = {}): Progress => ({ ...newProgress(), level, ...extra });
const stored = (p: FakePlatform) => p.storage.get<Progress | null>(SAVE_KEY, null);

/** 过关画面。单独取一次，免得 TypeScript 按前面的 assert 把它当成一直是 null */
const winOf = (s: ReturnType<typeof setupSession>) => s.session.winOverlay;

/** 点"下一站"：按钮文字画在哪，就点哪 */
function tapNext(s: ReturnType<typeof setupSession>): void {
  const pos = textPos(frame(s.p), NEXT_LABEL);
  assert.ok(pos, '登机牌上没有"下一站"按钮');
  s.p.touch.tap(...pos);
}

describe('过关：自动通关第 1 关', () => {
  it('照答案拖完，出现过关画面；存档已经是第 2 关；点"下一站"进入第 2 关', async () => {
    const s = setupSession();
    assert.ok(hasText(frame(s.p), '第 1 关'));
    assert.equal(s.session.winOverlay, null);

    solveLevel(s.ctx());
    assert.ok(s.session.winOverlay, '装满之后应该进入过关画面');
    assert.equal(s.session.current.game.isComplete(), true);
    // 存档在装满的那一刻就变成"第 2 关、没有进行中的局面"
    assert.deepEqual(stored(s.p), progressAt(2));

    s.p.advance(3000); // 合盖、盖章、登机牌
    assert.equal(winOf(s)?.isReady, true);
    const calls = frame(s.p);
    for (const t of ['登机牌  BOARDING PASS', 'HGH', 'CTU', '杭州', '成都', '已装箱', '4 件', '没用提示']) {
      assert.ok(hasText(calls, t), `过关画面上没有 ${t}`);
    }

    tapNext(s);
    await flush();
    assert.equal(s.session.winOverlay, null);
    assert.equal(s.session.current.game.level.n, 2);
    s.p.advance(FRAME_MS);
    assert.ok(hasText(frame(s.p), '第 2 关'));
    assert.deepEqual(stored(s.p), progressAt(2));
  });

  it('过关画面出现之后，登机牌上退出再打开：直接是第 2 关，从头开始，不再弹过关画面', () => {
    const a = setupSession();
    solveLevel(a.ctx());
    assert.ok(a.session.winOverlay);

    const p2 = new FakePlatform();
    p2.storage.set(SAVE_KEY, stored(a.p));
    const b = setupSession({}, p2);
    assert.equal(b.session.winOverlay, null);
    assert.equal(b.session.current.game.level.n, 2);
    assert.equal(b.session.current.game.remaining, b.session.current.game.pieces.length);
  });

  it('第 1 关不弹插屏广告', async () => {
    const s = setupSession();
    solveLevel(s.ctx());
    s.p.advance(3000);
    tapNext(s);
    await flush();
    assert.deepEqual(s.p.adLog, []);
  });
});

const FRAME_MS = FakePlatform.FRAME_MS;

describe('存档：进行中的局面', () => {
  it('每次摆放、取出、旋转之后都存档', () => {
    const s = setupSession();
    assert.equal(stored(s.p), null); // 什么都没动，不存

    dragIn(s.ctx(), 3, 0, 0); // 书放进箱子
    assert.deepEqual(stored(s.p)?.game?.snapshot.pieces[3], [0, 0, 0]);

    // 把书拿出来放回托盘：箱子里拿起，松手在托盘上
    const { grid, cell } = s.session.current.layout.board;
    const { panel } = s.session.current.layout.tray;
    s.p.advance(500);
    s.p.touch.drag([[grid.x + 0.5 * cell, grid.y + 0.5 * cell], [grid.x + 0.5 * cell + 15, grid.y + 0.5 * cell], [panel.x + panel.w / 2, panel.y + panel.h / 2]]);
    assert.deepEqual(stored(s.p)?.game?.snapshot.pieces[3], [0, -1, -1]);
  });

  it('旋转也存档（第 2 关）', () => {
    const s = setupSession({}, new FakePlatform());
    s.p.storage.set(SAVE_KEY, progressAt(2));
    const b = setupSession({}, s.p);
    const before = b.session.current.game.pieces[1]?.oi ?? 0;
    b.p.touch.tap(...traySlotCenter(b.ctx(), 1));
    const saved = stored(b.p)?.game?.snapshot.pieces[1];
    assert.equal(saved?.[0], (before + 1) % 2);
  });

  it('退出再打开：接着上次的局面玩，摆好的物品还在原位', () => {
    const a = setupSession();
    dragIn(a.ctx(), 3, 0, 0);
    dragIn(a.ctx(), 1, 2, 0);
    a.p.advance(500);

    const p2 = new FakePlatform();
    p2.storage.set(SAVE_KEY, stored(a.p));
    const b = setupSession({}, p2);
    const g = b.session.current.game;
    assert.deepEqual(g.pieces[3]?.pos, { r: 0, c: 0 });
    assert.deepEqual(g.pieces[1]?.pos, { r: 2, c: 0 });
    assert.equal(g.remaining, 2);
    // 画面上也是摆好的样子：托盘里留着两个虚线框
    assert.equal(frame(b.p).filter((c) => c.op === 'setLineDash').length, 2);
  });

  it('存档里的局面是别的版本的生成器生成的：这一关重新开始', () => {
    const a = setupSession();
    dragIn(a.ctx(), 3, 0, 0);
    const old = stored(a.p);
    assert.ok(old?.game);
    const p2 = new FakePlatform();
    p2.storage.set(SAVE_KEY, { ...old, game: { ...old.game, generator: GENERATOR_VERSION + 1 } });
    const b = setupSession({}, p2);
    assert.equal(b.session.current.game.remaining, 4);
    assert.equal(b.session.current.game.level.n, 1);
  });

  it('存档损坏、不是对象、版本太新：不崩，能留的进度留下', () => {
    for (const raw of ['{坏掉的', '"一段文字"', '[1,2]', 'null']) {
      const p = new FakePlatform();
      p.setRawStorage(SAVE_KEY, raw);
      const s = setupSession({}, p);
      assert.equal(s.session.current.game.level.n, 1, raw);
    }
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, { ...progressAt(7), version: 999, extra: '新版本才有的东西' });
    assert.equal(setupSession({}, p).session.current.game.level.n, 7);
  });

  it('局面和关卡对不上（存档被改过）：丢掉这一局，关卡号保留', () => {
    const a = setupSession();
    dragIn(a.ctx(), 3, 0, 0);
    const old = stored(a.p);
    assert.ok(old?.game);
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, { ...old, level: 3 }); // 局面是第 1 关的，关卡号改成了 3
    const s = setupSession({}, p);
    assert.equal(s.session.current.game.level.n, 3);
    assert.equal(s.session.current.game.remaining, s.session.current.game.pieces.length);
  });

  it('存的是已经装满的局面（不该出现）：这一关重新开始，不会直接过关', () => {
    const a = setupSession();
    solveLevel(a.ctx());
    const full = a.session.current.game.snapshot();
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, { ...progressAt(1), game: { generator: GENERATOR_VERSION, snapshot: full } });
    const s = setupSession({}, p);
    assert.equal(s.session.winOverlay, null);
    assert.equal(s.session.current.game.remaining, 4);
  });

  it('拖动没松手就退出：存档是拖动之前的局面', () => {
    const a = setupSession();
    dragIn(a.ctx(), 3, 0, 0);
    a.p.advance(500);
    const saved = JSON.stringify(stored(a.p));
    // 第二件拿起来拖着，没松手
    const [x, y] = traySlotCenter(a.ctx(), 1);
    a.p.touch.down(x, y);
    a.p.touch.move(x + 20, y - 40);
    a.p.touch.move(x + 40, y - 120);
    assert.equal(JSON.stringify(stored(a.p)), saved);
  });
});

describe('调试参数', () => {
  it('指定关卡：不读也不写存档', () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(9));
    const s = setupSession({ level: 2 }, p);
    assert.equal(s.session.current.game.level.n, 2);
    s.p.touch.tap(...traySlotCenter(s.ctx(), 1)); // 旋转，本来会存档
    dragIn(s.ctx(), 3, 0, 0);
    assert.deepEqual(stored(p), progressAt(9)); // 存档原封不动
  });

  it('hints 把箱子摆满：直接进入过关画面', () => {
    const s = setupSession({ level: 1, hints: 99 });
    assert.ok(s.session.winOverlay);
    s.p.advance(3000);
    assert.ok(hasText(frame(s.p), '4 次')); // 提示用了 4 次
  });
});

describe('下一站：插屏广告', () => {
  const clear = async (s: ReturnType<typeof setupSession>) => {
    solveLevel(s.ctx());
    s.p.advance(3000);
    tapNext(s);
    await flush();
    s.p.advance(SLIDE_MS); // 换关滑动期间不响应触摸
  };

  it('通关第 5 关后弹插屏，弹完才进下一关，并记下弹的时间', async () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(5));
    const s = setupSession({}, p);
    let release = (): void => {};
    const real = p.ads.interstitial;
    p.ads.interstitial = (placement) => {
      void real(placement);
      return new Promise<void>((resolve) => (release = resolve));
    };

    solveLevel(s.ctx());
    p.advance(3000);
    tapNext(s);
    await flush();
    assert.deepEqual(p.adLog, [{ kind: 'interstitial', placement: 'between_levels' }]);
    // 广告还没放完：还在过关画面，点什么都没用
    assert.ok(s.session.winOverlay);
    p.touch.tap(200, 300);
    assert.equal(s.session.current.game.level.n, 5);

    p.advance(5000); // 广告放了 5 秒
    release();
    await flush();
    assert.equal(s.session.winOverlay, null);
    assert.equal(s.session.current.game.level.n, 6);
    // 记的是广告放完的时间，不是弹出的时间
    assert.equal(stored(p)?.lastInterstitialAt, p.now());
  });

  it('下一站连点：只进一关，也只弹一次广告', async () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(5));
    const s = setupSession({}, p);
    solveLevel(s.ctx());
    p.advance(3000);
    const pos = textPos(frame(p), NEXT_LABEL);
    assert.ok(pos);
    p.touch.tap(...pos);
    p.touch.tap(...pos);
    p.touch.tap(...pos);
    await flush();
    assert.equal(s.session.current.game.level.n, 6);
    assert.equal(p.adLog.length, 1);
  });

  it('离上次弹不到 90 秒，这一关不弹，也不往后顺延', async () => {
    const p = new FakePlatform();
    p.advance(1_000_000);
    p.storage.set(SAVE_KEY, progressAt(8, { lastInterstitialAt: p.now() - (INTERSTITIAL_MIN_GAP_MS - 20_000) }));
    const s = setupSession({}, p);
    await clear(s);
    assert.deepEqual(p.adLog, []);
    assert.equal(s.session.current.game.level.n, 9);
  });

  it('离上次弹超过 90 秒，通关第 8 关弹', async () => {
    const p = new FakePlatform();
    p.advance(1_000_000);
    p.storage.set(SAVE_KEY, progressAt(8, { lastInterstitialAt: p.now() - INTERSTITIAL_MIN_GAP_MS - 10_000 }));
    const s = setupSession({}, p);
    await clear(s);
    assert.equal(p.adLog.length, 1);
    assert.equal(s.session.current.game.level.n, 9);
  });

  it('第 6、7 关通关不弹', async () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, progressAt(6));
    const s = setupSession({}, p);
    await clear(s);
    await clear(s);
    assert.equal(s.session.current.game.level.n, 8);
    assert.deepEqual(p.adLog, []);
  });
});
