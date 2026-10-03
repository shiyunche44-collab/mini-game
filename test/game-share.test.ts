import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateLevel } from '../src/core/levels.ts';
import { computeLayout, type Rect } from '../src/game/layout.ts';
import {
  NEXT_LABEL,
  SHARE_LABEL,
  SHORT_LABELS,
  SIDEBAR_LABEL,
  VIDEO_LABEL,
  winButtonRect,
  winCardRect,
  winShareRects,
} from '../src/game/WinOverlay.ts';
import { FakePlatform, type FakePlatformOptions } from './fake-platform.ts';
import { flush, frame, hasText, setupSession } from './play-helpers.ts';

const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/**
 * 玩到登机牌完全出来为止（第 1 关，用提示摆满）。
 * 侧边栏能不能用要问平台、答案是异步的，所以先等答案回来再通关；
 * 登机牌上有几个按钮：分享给朋友一定有，录屏、侧边栏看平台。
 */
async function onBoardingPass(options: FakePlatformOptions = {}) {
  const p = new FakePlatform(options);
  const s = setupSession({ level: 1 }, p);
  await flush();
  for (let i = 0; i < 20 && !s.session.winOverlay; i++) {
    s.session.current.applyHint();
    p.advance(300);
  }
  assert.ok(s.session.winOverlay, '应该通关了');
  p.advance(3000);
  const count = 1 + (p.recorder ? 1 : 0) + (p.sidebar && p.sidebarAvailable === true ? 1 : 0);
  const rects = () => winShareRects(s.session.current.layout, p.screen.height, count);
  return { ...s, p, rects };
}

describe('登机牌上的分享：按钮', () => {
  it('画出"分享给朋友"和"下一站"；没有录屏的平台（Web、微信）没有"分享录屏"', async () => {
    const s = await onBoardingPass();
    const calls = frame(s.p);
    assert.ok(hasText(calls, SHARE_LABEL));
    assert.ok(hasText(calls, NEXT_LABEL));
    assert.ok(!hasText(calls, VIDEO_LABEL));
    assert.ok(!hasText(calls, SIDEBAR_LABEL));
  });

  it('支持录屏的平台多一个"分享录屏"', async () => {
    const s = await onBoardingPass({ recorder: true });
    const calls = frame(s.p);
    assert.ok(hasText(calls, SHARE_LABEL) && hasText(calls, VIDEO_LABEL));
  });

  it('抖音（录屏加侧边栏）一排三个按钮，换成短的字', async () => {
    const s = await onBoardingPass({ recorder: true, sidebar: true });
    const calls = frame(s.p);
    for (const t of [SHORT_LABELS.share, SHORT_LABELS.video, SHORT_LABELS.sidebar]) assert.ok(hasText(calls, t), t);
    assert.ok(!hasText(calls, SHARE_LABEL));
  });

  it('只有侧边栏没有录屏时，两个按钮用完整的字', async () => {
    const s = await onBoardingPass({ sidebar: true });
    const calls = frame(s.p);
    assert.ok(hasText(calls, SHARE_LABEL) && hasText(calls, SIDEBAR_LABEL));
  });

  it('平台说侧边栏用不了（或者问的时候出错），就没有这个按钮', async () => {
    for (const answer of [false, 'error'] as const) {
      const p = new FakePlatform({ sidebar: true });
      p.sidebarAvailable = answer;
      const s = setupSession({ level: 1 }, p);
      await flush();
      for (let i = 0; i < 20 && !s.session.winOverlay; i++) {
        s.session.current.applyHint();
        p.advance(300);
      }
      p.advance(3000);
      assert.ok(s.session.winOverlay, `答案是 ${answer}：应该通关了`);
      assert.ok(!hasText(frame(p), SIDEBAR_LABEL), `答案是 ${answer}`);
    }
  });

  it('按钮都在登机牌里面，不盖住条形码和"下一站"，各种屏幕、1～3 个按钮都一样', () => {
    for (const size of [[375, 667], [390, 844], [1280, 800], [320, 568], [360, 640]] as [number, number][]) {
      for (const count of [1, 2, 3]) {
        const p = new FakePlatform({ width: size[0], height: size[1] });
        const layout = computeLayout(p.screen, generateLevel(5));
        const card = winCardRect(layout, size[1]);
        const next = winButtonRect(layout, size[1]);
        const rects = winShareRects(layout, size[1], count);
        const where = `${size.join('×')} ${count} 个按钮`;
        assert.equal(rects.length, count, where);
        rects.forEach((r, i) => {
          assert.ok(r.x >= card.x && r.x + r.w <= card.x + card.w, `${where}：横向超出登机牌`);
          assert.ok(r.y >= card.y + 270 && r.y + r.h <= next.y, `${where}：挤到条形码或"下一站"了`);
          assert.ok(r.y + r.h <= size[1], `${where}：超出屏幕`);
          const prev = rects[i - 1];
          if (prev) assert.ok(prev.x + prev.w <= r.x, `${where}：按钮重叠`);
          assert.ok(r.w >= 70, `${where}：按钮只有 ${r.w}px 宽，太窄`);
        });
      }
    }
  });
});

describe('登机牌上的分享：点击', () => {
  it('点"分享给朋友"：把通关的关卡号放进标题和链接参数，不会进下一关，可以重复分享', async () => {
    const s = await onBoardingPass();
    s.p.touch.tap(...center(s.rects()[0] as Rect));
    assert.equal(s.p.shared.length, 1);
    assert.match(s.p.shared[0]?.title ?? '', /第 1 关/);
    assert.equal(s.p.shared[0]?.query, 'from=share&level=1');
    assert.ok(s.session.winOverlay, '登机牌还在');
    assert.equal(s.session.saved.level, 2);

    s.p.touch.tap(...center(s.rects()[0] as Rect));
    assert.equal(s.p.shared.length, 2);
  });

  it('登机牌还没出来时点分享的位置，只是跳过动画，不会分享', async () => {
    const p = new FakePlatform();
    const s = setupSession({ level: 1, hints: 99 }, p);
    s.p.advance(300);
    const [r] = winShareRects(s.session.current.layout, s.p.screen.height, 1);
    s.p.touch.tap(...center(r as Rect));
    assert.equal(s.p.shared.length, 0);
  });

  it('只有一个按钮时它占满一排：点哪边都是分享', async () => {
    const s = await onBoardingPass();
    const r = s.rects()[0] as Rect;
    s.p.touch.tap(r.x + 6, r.y + r.h / 2);
    s.p.touch.tap(r.x + r.w - 6, r.y + r.h / 2);
    assert.equal(s.p.shared.length, 2);
  });

  it('有录屏的平台：左边是分享，右边是分享录屏，互不串', async () => {
    const s = await onBoardingPass({ recorder: true });
    const [share, video] = s.rects();
    s.p.touch.tap(...center(share as Rect));
    assert.equal(s.p.shared.length, 1);
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), []);

    s.p.touch.tap(...center(video as Rect));
    await flush();
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), ['share']);
    assert.equal(s.p.shared.length, 1, '分享录屏不走普通分享');
  });

  it('三个按钮各管各的：点侧边栏只打开侧边栏', async () => {
    const s = await onBoardingPass({ recorder: true, sidebar: true });
    const [share, video, sidebar] = s.rects();
    s.p.touch.tap(...center(sidebar as Rect));
    assert.deepEqual(s.p.sidebarLog.filter((x) => x === 'open'), ['open']);
    assert.equal(s.p.shared.length, 0);
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), []);
    assert.ok(s.session.winOverlay, '登机牌还在');

    s.p.touch.tap(...center(share as Rect));
    s.p.touch.tap(...center(video as Rect));
    await flush();
    assert.equal(s.p.shared.length, 1);
    assert.deepEqual(s.p.recorderLog.filter((x) => x === 'share'), ['share']);
    assert.deepEqual(s.p.sidebarLog.filter((x) => x === 'open'), ['open'], '没有多开');
  });

  it('分享录屏失败（没录到、玩家取消）：什么都不发生，登机牌还在，还能点下一站', async () => {
    const s = await onBoardingPass({ recorder: true });
    s.p.recorderShareResult = false;
    s.p.touch.tap(...center(s.rects()[1] as Rect));
    await flush();
    assert.ok(s.session.winOverlay);
    s.p.touch.tap(...center(winButtonRect(s.session.current.layout, s.p.screen.height)));
    await flush();
    assert.equal(s.session.winOverlay, null);
  });
});

describe('录屏的节奏：每一关开始录，通关时停', () => {
  it('开局就开始录；通关的那一刻停下', () => {
    const s = setupSession({ level: 1, hints: 99 }, new FakePlatform({ recorder: true }));
    assert.deepEqual(s.p.recorderLog, ['start', 'stop']);
  });

  it('点"下一站"进下一关时再开始录', async () => {
    const p = new FakePlatform({ recorder: true });
    const s = setupSession({ level: 1, hints: 99 }, p);
    s.p.advance(3000);
    s.p.touch.tap(...center(winButtonRect(s.session.current.layout, s.p.screen.height)));
    await flush();
    assert.deepEqual(p.recorderLog, ['start', 'stop', 'start']);
  });

  it('跳关之后新的一关接着录（平台会处理"已经在录"）', async () => {
    const p = new FakePlatform({ recorder: true });
    setupSession({ level: 3 }, p);
    assert.deepEqual(p.recorderLog, ['start']);
    const label = frame(p).filter((c) => c.op === 'fillText' && c.args[0] === '跳关').at(-1);
    assert.ok(label);
    p.touch.tap(label.args[1] as number, label.args[2] as number);
    await flush();
    assert.equal(p.recorderLog.filter((x) => x === 'start').length, 2);
    assert.ok(!p.recorderLog.includes('stop'));
  });

  it('没有录屏的平台一切照常，不会因为缺 recorder 出错', () => {
    const s = setupSession({ level: 1, hints: 99 });
    assert.ok(s.session.winOverlay);
  });
});
