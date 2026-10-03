import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newProgress, SAVE_KEY } from '../src/core/progress.ts';
import type { ButtonKind } from '../src/game/PlayScene.ts';
import { SETTINGS_KEY } from '../src/game/Sfx.ts';
import { SLIDE_MS } from '../src/game/Session.ts';
import { SOUNDS, type SoundName } from '../src/game/sounds.ts';
import { NEXT_LABEL } from '../src/game/WinOverlay.ts';
import type { Tone } from '../src/platform/types.ts';
import { FakePlatform } from './fake-platform.ts';
import { dragIn, emojiCalls, flush, frame, setupSession, solveLevel, textPos, traySlotCenter, type SessionCtx } from './play-helpers.ts';

// 第 1 关：4×3，不能旋转。托盘 0 登山靴  1 帽子  2 登山靴  3 书；答案：靴 0 (1,2)，帽子 (2,0)，书 (0,0)。
const BOOT = 0;
const CAP = 1;
const BOOKS = 3;

/** 播过的音效名（音符表和 SOUNDS 里的是同一个数组，按引用对回名字） */
const names = (p: FakePlatform): (SoundName | '?')[] =>
  p.played.map((t) => ((Object.keys(SOUNDS) as SoundName[]).find((k) => SOUNDS[k] === t) ?? '?'));

const press = (s: SessionCtx, kind: ButtonKind): void => {
  const r = s.session.current.layout.buttons[kind];
  s.p.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
};
const tapSound = (s: SessionCtx): void => {
  const r = s.session.current.layout.sound;
  s.p.touch.tap(r.x + r.w / 2, r.y + r.h / 2);
};
const startAt = (level: number, p = new FakePlatform()): SessionCtx => {
  p.storage.set(SAVE_KEY, { ...newProgress(), level });
  return setupSession({}, p);
};

describe('音效表', () => {
  it('每个音效至少一个音符，音符的数值都合理（音量不大、时长不长、音高在人耳范围里）', () => {
    for (const [name, tones] of Object.entries(SOUNDS)) {
      assert.ok(tones.length > 0, name);
      for (const t of tones as readonly Tone[]) {
        assert.ok(t.gain > 0 && t.gain <= 0.25, `${name} 音量 ${t.gain}`);
        assert.ok(t.start >= 0 && t.duration > 0 && t.start + t.duration <= 800, `${name} 时间`);
        for (const f of [t.freq, t.endFreq ?? t.freq]) assert.ok(f >= 40 && f <= 4000, `${name} 音高 ${f}`);
      }
    }
  });
});

describe('操作播音效', () => {
  it('拖一件物品放进箱子：拿起一声，落下一声', () => {
    const s = setupSession();
    dragIn(s.ctx(), BOOKS, 0, 0);
    assert.deepEqual(names(s.p), ['pickup', 'drop']);
  });

  it('拖到放不下的地方松手：拿起，退回', () => {
    const s = setupSession();
    const [x, y] = traySlotCenter(s.ctx(), CAP);
    s.p.touch.drag([[x, y], [x + 15, y], [x + 20, y + 5]]); // 还在托盘上
    assert.deepEqual(names(s.p), ['pickup', 'back']);
  });

  it('从箱子里拿起放回托盘：拿起，退回', () => {
    const s = setupSession();
    dragIn(s.ctx(), BOOKS, 0, 0);
    s.p.advance(400);
    s.p.played.length = 0;
    const { grid, cell } = s.session.current.layout.board;
    const tray = s.session.current.layout.tray.panel;
    s.p.touch.drag([[grid.x + cell / 2, grid.y + cell / 2], [grid.x + cell / 2 + 15, grid.y + cell / 2], [tray.x + tray.w / 2, tray.y + tray.h / 2]]);
    assert.deepEqual(names(s.p), ['pickup', 'back']);
  });

  it('点按旋转：转得动响"转"，转不动响"不行"', () => {
    const s = startAt(2);
    s.p.touch.tap(...traySlotCenter(s.ctx(), 0));
    assert.deepEqual(names(s.p), ['rotate']);
    s.p.advance(400);
    s.p.played.length = 0;
    const game = s.session.current.game;
    while (game.hint()) { /* 摆满，箱子里没有空格，哪个都转不开 */ }
    s.p.advance(16);
    const spot = game.pieces[1]?.pos;
    assert.ok(spot);
    const { grid, cell } = s.session.current.layout.board;
    s.p.touch.tap(grid.x + (spot.c + 0.5) * cell, grid.y + (spot.r + 0.5) * cell);
    assert.deepEqual(names(s.p), ['nope']);
  });

  it('第 1 关不能转：点物品没有任何反应，也没有声音（和画面一致）', () => {
    const s = setupSession();
    s.p.touch.tap(...traySlotCenter(s.ctx(), BOOT));
    assert.deepEqual(names(s.p), []);
  });

  it('点按钮：滴一声；提示摆好的物品落稳时再响提示音', async () => {
    const s = setupSession();
    press(s, 'hint');
    await flush();
    assert.deepEqual(names(s.p), ['tap']);
    s.p.advance(400);
    assert.deepEqual(names(s.p), ['tap', 'hint']);
  });

  it('提前关闭广告（没给提示）：只有点按钮那一声', async () => {
    const s = setupSession();
    s.p.queueRewardedResults(false);
    press(s, 'hint');
    await flush();
    s.p.advance(500);
    assert.deepEqual(names(s.p), ['tap']);
  });

  it('跳关：点按钮，然后换关滑动的声音', async () => {
    const s = setupSession();
    press(s, 'skip');
    await flush();
    assert.deepEqual(names(s.p), ['tap', 'slide']);
  });
});

describe('过关的音效', () => {
  const win = (s: SessionCtx) => {
    solveLevel(s.ctx());
    s.p.played.length = 0;
  };

  it('按时间线：先盖章的闷响，登机牌升起时一小段旋律，各一次', () => {
    const s = setupSession();
    win(s); // 最后一件落下之后已经过了 300ms；盖章在 560ms，登机牌在 1200ms
    s.p.advance(100);
    assert.deepEqual(names(s.p), []);
    s.p.advance(300); // 盖章
    assert.deepEqual(names(s.p), ['stamp']);
    s.p.advance(1000);
    assert.deepEqual(names(s.p), ['stamp', 'win']);
    s.p.advance(3000);
    assert.deepEqual(names(s.p), ['stamp', 'win'], '不重复');
  });

  it('玩家点屏幕跳过动画：旋律补上，只响一次，之后也不再响', () => {
    const s = setupSession();
    win(s);
    s.p.advance(200);
    s.p.touch.tap(10, 10);
    assert.deepEqual(names(s.p).filter((n) => n === 'win'), ['win']);
    s.p.advance(4000);
    assert.equal(names(s.p).filter((n) => n === 'win').length, 1);
    assert.equal(names(s.p).filter((n) => n === 'stamp').length, 0, '跳过之后不再补盖章声');
  });

  it('点"下一站"：滴一声，然后换关', async () => {
    const s = setupSession();
    win(s);
    s.p.advance(3000);
    s.p.played.length = 0;
    const pos = textPos(frame(s.p), NEXT_LABEL);
    assert.ok(pos);
    s.p.touch.tap(...pos);
    await flush();
    assert.deepEqual(names(s.p), ['tap', 'slide']);
    s.p.advance(SLIDE_MS);
  });
});

describe('静音', () => {
  it('标题栏里有个喇叭：有声时是 🔊，点一下变 🔇 并存下来', () => {
    const s = setupSession();
    assert.equal(emojiCalls(frame(s.p), '🔊').length, 1);
    assert.equal(emojiCalls(frame(s.p), '🔇').length, 0);
    tapSound(s);
    assert.equal(emojiCalls(frame(s.p), '🔇').length, 1);
    assert.equal(emojiCalls(frame(s.p), '🔊').length, 0);
    assert.deepEqual(s.p.storage.get(SETTINGS_KEY, null), { muted: true });
  });

  it('静音之后所有操作都不出声；再点一下恢复，并且响一声告诉玩家声音开了', () => {
    const s = setupSession();
    tapSound(s); // 静音（切成静音时不响）
    assert.deepEqual(names(s.p), []);
    dragIn(s.ctx(), BOOKS, 0, 0);
    press(s, 'restart');
    s.p.advance(500);
    assert.deepEqual(names(s.p), []);
    tapSound(s);
    assert.deepEqual(names(s.p), ['tap']);
    dragIn(s.ctx(), CAP, 2, 0);
    assert.ok(names(s.p).includes('drop'));
  });

  it('静音时过关也安静', () => {
    const s = setupSession();
    tapSound(s);
    solveLevel(s.ctx());
    s.p.advance(4000);
    assert.deepEqual(names(s.p), []);
  });

  it('点喇叭不会触发别的东西：不转物品、不算按钮', () => {
    const s = setupSession();
    tapSound(s);
    assert.deepEqual(s.p.adLog, []);
    assert.equal(s.session.current.game.remaining, 4);
  });

  it('重新打开游戏：静音状态还在', () => {
    const first = setupSession();
    tapSound(first);
    const p = new FakePlatform(); // 换一个新的平台：模拟关掉游戏再打开，只有存储是上次留下的
    p.storage.set(SETTINGS_KEY, first.p.storage.get(SETTINGS_KEY, null));
    const second = setupSession({}, p);
    assert.equal(emojiCalls(frame(second.p), '🔇').length, 1);
    dragIn(second.ctx(), BOOKS, 0, 0);
    assert.deepEqual(names(second.p), []);
  });

  it('存的设置什么样都不崩：坏数据当作有声', () => {
    for (const bad of [null, 5, 'x', [], { muted: 'yes' }, { muted: 1 }, { other: true }]) {
      const p = new FakePlatform();
      p.storage.set(SETTINGS_KEY, bad);
      const s = setupSession({}, p);
      assert.equal(emojiCalls(frame(s.p), '🔊').length, 1, JSON.stringify(bad));
    }
  });

  it('静音设置和进度互不影响：切静音不改存档，调试关卡也能静音', () => {
    const s = setupSession({ level: 3 });
    tapSound(s);
    assert.equal(s.p.storage.get(SAVE_KEY, null), null);
    assert.deepEqual(s.p.storage.get(SETTINGS_KEY, null), { muted: true });
  });

  it('换关之后静音状态不变', async () => {
    const s = setupSession();
    tapSound(s);
    press(s, 'skip');
    await flush();
    s.p.advance(SLIDE_MS + 50);
    assert.equal(emojiCalls(frame(s.p), '🔇').length, 1);
  });
});
