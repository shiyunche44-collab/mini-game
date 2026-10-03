import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENTS } from '../src/game/Session.ts';
import { FakePlatform } from './fake-platform.ts';
import { flush, frame, setupSession, solveLevel } from './play-helpers.ts';
import { winButtonRect, winShareRects } from '../src/game/WinOverlay.ts';

const names = (p: FakePlatform) => p.tracked.map((t) => t.event);
const center = (r: { x: number; y: number; w: number; h: number }): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** 画面上某个按钮的文字画在哪 */
function buttonPos(p: FakePlatform, label: string): [number, number] {
  const c = frame(p).filter((x) => x.op === 'fillText' && x.args[0] === label).at(-1);
  assert.ok(c, `画面上没有"${label}"`);
  return [c.args[1] as number, c.args[2] as number];
}

describe('埋点：一关的流程', () => {
  it('开局记 level_start，带关卡号', () => {
    const p = new FakePlatform();
    setupSession({ level: 7 }, p);
    assert.deepEqual(p.tracked, [{ event: EVENTS.levelStart, params: { level: 7 } }]);
  });

  it('通关记 level_complete：关卡号、用了几次提示、用了多少秒', () => {
    const p = new FakePlatform();
    const s = setupSession({ level: 1 }, p);
    p.advance(12_400);
    solveLevel(s.ctx());
    const done = p.tracked.find((t) => t.event === EVENTS.levelComplete);
    assert.ok(done);
    assert.equal(done.params?.level, 1);
    assert.equal(done.params?.hints, 0);
    // solveLevel 自己也会推进时间，这里只要求至少包含前面等的 12 秒
    assert.ok((done.params?.seconds as number) >= 12, `seconds = ${done.params?.seconds}`);
  });

  it('点"下一站"进下一关，记下一关的 level_start', async () => {
    const p = new FakePlatform();
    const s = setupSession({ level: 1, hints: 99 }, p);
    p.advance(3000);
    p.touch.tap(...center(winButtonRect(s.session.current.layout, p.screen.height)));
    await flush();
    assert.deepEqual(
      p.tracked.filter((t) => t.event === EVENTS.levelStart).map((t) => t.params?.level),
      [1, 2],
    );
  });

  it('重来记 level_restart', () => {
    const p = new FakePlatform();
    setupSession({ level: 4 }, p);
    p.touch.tap(...buttonPos(p, '重来'));
    assert.deepEqual(p.tracked.at(-1), { event: EVENTS.levelRestart, params: { level: 4 } });
  });
});

describe('埋点：广告', () => {
  it('提示：看完记 watched 为 true；中途关闭记 false', async () => {
    const p = new FakePlatform();
    setupSession({ level: 2 }, p);
    p.queueRewardedResults(true, false);
    p.touch.tap(...buttonPos(p, '提示'));
    await flush();
    p.touch.tap(...buttonPos(p, '提示'));
    await flush();
    const ads = p.tracked.filter((t) => t.event === EVENTS.adRewarded);
    assert.deepEqual(
      ads.map((t) => t.params),
      [
        { placement: 'hint', watched: true, level: 2 },
        { placement: 'hint', watched: false, level: 2 },
      ],
    );
  });

  it('跳关：看完记广告结果和 level_skip，中途关闭只记广告结果', async () => {
    const p = new FakePlatform();
    setupSession({ level: 2 }, p);
    p.queueRewardedResults(false, true);
    p.touch.tap(...buttonPos(p, '跳关'));
    await flush();
    assert.ok(!names(p).includes(EVENTS.levelSkip));
    p.touch.tap(...buttonPos(p, '跳关'));
    await flush();
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.levelSkip), [{ event: EVENTS.levelSkip, params: { level: 2 } }]);
    // 跳到了第 3 关，新的一关记了 level_start
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.levelStart).at(-1)?.params, { level: 3 });
  });

  it('弹了插屏记 ad_interstitial；没弹就不记', async () => {
    const p = new FakePlatform();
    // 通关第 5 关后弹插屏（离上次超过 90 秒，没弹过）
    const s = setupSession({ level: 5, hints: 99 }, p);
    p.advance(3000);
    p.touch.tap(...center(winButtonRect(s.session.current.layout, p.screen.height)));
    await flush();
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.adInterstitial), [
      { event: EVENTS.adInterstitial, params: { level: 5 } },
    ]);

    const q = new FakePlatform();
    const t = setupSession({ level: 1, hints: 99 }, q);
    q.advance(3000);
    q.touch.tap(...center(winButtonRect(t.session.current.layout, q.screen.height)));
    await flush();
    assert.ok(!names(q).includes(EVENTS.adInterstitial));
  });
});

describe('埋点：分享和侧边栏', () => {
  async function toBoardingPass(p: FakePlatform) {
    const s = setupSession({ level: 1 }, p);
    await flush();
    for (let i = 0; i < 20 && !s.session.winOverlay; i++) {
      s.session.current.applyHint();
      p.advance(300);
    }
    p.advance(3000);
    return s;
  }

  it('分享给朋友记 share_click，kind 是 friend', async () => {
    const p = new FakePlatform();
    const s = await toBoardingPass(p);
    const [r] = winShareRects(s.session.current.layout, p.screen.height, 1);
    p.touch.tap(...center(r as never));
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.shareClick), [
      { event: EVENTS.shareClick, params: { kind: 'friend', level: 1 } },
    ]);
  });

  it('分享录屏记 share_click（video），玩家分享完再记结果', async () => {
    const p = new FakePlatform({ recorder: true });
    const s = await toBoardingPass(p);
    const [, video] = winShareRects(s.session.current.layout, p.screen.height, 2);
    p.recorderShareResult = false;
    p.touch.tap(...center(video as never));
    await flush();
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.shareClick).at(-1)?.params, { kind: 'video', level: 1 });
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.shareVideoResult), [
      { event: EVENTS.shareVideoResult, params: { level: 1, ok: false } },
    ]);
  });

  it('启动时记一次 sidebar_check；点按钮记 sidebar_click', async () => {
    const p = new FakePlatform({ sidebar: true });
    const s = await toBoardingPass(p);
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.sidebarCheck), [
      { event: EVENTS.sidebarCheck, params: { available: true } },
    ]);
    const [, side] = winShareRects(s.session.current.layout, p.screen.height, 2);
    p.touch.tap(...center(side as never));
    assert.deepEqual(p.tracked.filter((t) => t.event === EVENTS.sidebarClick), [
      { event: EVENTS.sidebarClick, params: { level: 1 } },
    ]);
  });

  it('侧边栏查询出错：记 available 为 false，游戏照常', async () => {
    const p = new FakePlatform({ sidebar: true });
    p.sidebarAvailable = 'error';
    await toBoardingPass(p);
    assert.deepEqual(p.tracked.find((t) => t.event === EVENTS.sidebarCheck)?.params, { available: false });
  });

  it('没有侧边栏的平台（Web、微信）不记 sidebar_check', async () => {
    const p = new FakePlatform();
    await toBoardingPass(p);
    assert.ok(!names(p).includes(EVENTS.sidebarCheck));
  });
});
