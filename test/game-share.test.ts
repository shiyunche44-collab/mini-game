import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateLevel } from '../src/core/levels.ts';
import { computeLayout, type Rect } from '../src/game/layout.ts';
import { NEXT_LABEL, SHARE_LABEL, VIDEO_LABEL, winButtonRect, winCardRect, winShareRects } from '../src/game/WinOverlay.ts';
import { FakePlatform } from './fake-platform.ts';
import { flush, frame, hasText, setupSession } from './play-helpers.ts';

const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** 直接停在登机牌上的一局（第 1 关，箱子由提示摆满），登机牌已经完全出来 */
function onBoardingPass(p = new FakePlatform()) {
  const s = setupSession({ level: 1, hints: 99 }, p);
  s.p.advance(3000);
  const rects = () => winShareRects(s.session.current.layout, s.p.screen.height, p.recorder !== undefined);
  return { ...s, rects };
}

describe('登机牌上的分享：按钮', () => {
  it('画出"分享给朋友"和"下一站"；没有录屏的平台（Web、微信）没有"分享录屏"', () => {
    const s = onBoardingPass();
    const calls = frame(s.p);
    assert.ok(hasText(calls, SHARE_LABEL));
    assert.ok(hasText(calls, NEXT_LABEL));
    assert.ok(!hasText(calls, VIDEO_LABEL));
  });

  it('支持录屏的平台（抖音）多一个"分享录屏"', () => {
    const s = onBoardingPass(new FakePlatform({ recorder: true }));
    const calls = frame(s.p);
    assert.ok(hasText(calls, SHARE_LABEL) && hasText(calls, VIDEO_LABEL));
  });

  it('按钮都在登机牌里面，不盖住条形码和"下一站"，各种屏幕上都一样', () => {
    for (const size of [[375, 667], [390, 844], [1280, 800], [320, 568], [360, 640]] as [number, number][]) {
      for (const hasVideo of [false, true]) {
        const p = new FakePlatform({ width: size[0], height: size[1] });
        const layout = computeLayout(p.screen, generateLevel(5));
        const card = winCardRect(layout, size[1]);
        const next = winButtonRect(layout, size[1]);
        const { share, video } = winShareRects(layout, size[1], hasVideo);
        const where = `${size.join('×')}${hasVideo ? ' 有录屏' : ''}`;
        assert.equal(video !== null, hasVideo, where);
        for (const r of [share, video]) {
          if (!r) continue;
          assert.ok(r.x >= card.x && r.x + r.w <= card.x + card.w, `${where}：横向超出登机牌`);
          assert.ok(r.y >= card.y + 270 && r.y + r.h <= next.y, `${where}：挤到条形码或"下一站"了`);
          assert.ok(r.y + r.h <= size[1], `${where}：超出屏幕`);
        }
        if (video) assert.ok(share.x + share.w <= video.x, `${where}：两个按钮重叠`);
      }
    }
  });
});

describe('登机牌上的分享：点击', () => {
  it('点"分享给朋友"：把通关的关卡号放进标题和链接参数，不会进下一关，可以重复分享', () => {
    const s = onBoardingPass();
    s.p.touch.tap(...center(s.rects().share));
    assert.equal(s.p.shared.length, 1);
    assert.match(s.p.shared[0]?.title ?? '', /第 1 关/);
    assert.equal(s.p.shared[0]?.query, 'from=share&level=1');
    assert.ok(s.session.winOverlay, '登机牌还在');
    assert.equal(s.session.saved.level, 2);

    s.p.touch.tap(...center(s.rects().share));
    assert.equal(s.p.shared.length, 2);
  });

  it('登机牌还没出来时点分享的位置，只是跳过动画，不会分享', () => {
    const s = setupSession({ level: 1, hints: 99 });
    s.p.advance(300);
    const r = winShareRects(s.session.current.layout, s.p.screen.height, false);
    s.p.touch.tap(...center(r.share));
    assert.equal(s.p.shared.length, 0);
  });

  it('没有录屏的平台，"分享给朋友"占满一排：点哪边都是分享', () => {
    const s = onBoardingPass();
    const r = s.rects().share;
    s.p.touch.tap(r.x + 6, r.y + r.h / 2);
    s.p.touch.tap(r.x + r.w - 6, r.y + r.h / 2);
    assert.equal(s.p.shared.length, 2);
    assert.deepEqual(s.p.recorder, undefined);
  });

  it('有录屏的平台：左边是分享，右边是分享录屏，互不串', async () => {
    const s = onBoardingPass(new FakePlatform({ recorder: true }));
    const { share, video } = s.rects();
    assert.ok(video);
    s.p.touch.tap(...center(share));
    assert.equal(s.p.shared.length, 1);
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), []);

    s.p.touch.tap(...center(video));
    await flush();
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), ['share']);
    assert.equal(s.p.shared.length, 1, '分享录屏不走普通分享');
  });

  it('分享录屏失败（没录到、玩家取消）：什么都不发生，登机牌还在，还能点下一站', async () => {
    const s = onBoardingPass(new FakePlatform({ recorder: true }));
    s.p.recorderShareResult = false;
    const { video } = s.rects();
    assert.ok(video);
    s.p.touch.tap(...center(video));
    await flush();
    assert.ok(s.session.winOverlay);
    const next = winButtonRect(s.session.current.layout, s.p.screen.height);
    s.p.touch.tap(...center(next));
    await flush();
    assert.equal(s.session.winOverlay, null);
  });
});

describe('录屏的节奏：每一关开始录，通关时停', () => {
  it('开局就开始录；通关的那一刻停下', () => {
    const s = setupSession({ level: 1, hints: 99 }, new FakePlatform({ recorder: true }));
    assert.deepEqual(s.p.recorderLog, ['start', 'stop']);
  });

  it('玩的过程中一直在录；点"下一站"进下一关时再开始录', async () => {
    const p = new FakePlatform({ recorder: true });
    const s = setupSession({ level: 1, hints: 99 }, p);
    s.p.advance(3000);
    const next = winButtonRect(s.session.current.layout, s.p.screen.height);
    s.p.touch.tap(...center(next));
    await flush();
    assert.deepEqual(p.recorderLog, ['start', 'stop', 'start']);
  });

  it('跳关之后新的一关接着录（平台会处理"已经在录"）', async () => {
    const p = new FakePlatform({ recorder: true });
    const s = setupSession({ level: 3 }, p);
    assert.deepEqual(p.recorderLog, ['start']);
    // 点"跳关"按钮：看完广告就换下一关
    const label = frame(p).filter((c) => c.op === 'fillText' && c.args[0] === '跳关').at(-1);
    assert.ok(label);
    p.touch.tap(label.args[1] as number, label.args[2] as number);
    await flush();
    assert.equal(p.recorderLog.filter((x) => x === 'start').length, 2);
    assert.ok(!p.recorderLog.includes('stop'));
    void s;
  });

  it('没有录屏的平台一切照常，不会因为缺 recorder 出错', () => {
    const s = setupSession({ level: 1, hints: 99 });
    assert.ok(s.session.winOverlay);
  });
});
