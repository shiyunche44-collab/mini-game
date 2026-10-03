import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDouyinPlatform } from '../src/platform/douyin.ts';
import type { Platform, PointerHandlers, PointerPoint } from '../src/platform/types.ts';
import type { AdUnits } from '../src/platform/wechat.ts';
import { createWechatPlatform } from '../src/platform/wechat.ts';
import { FakeCanvas2D } from './fake-platform.ts';

// 微信和抖音的平台实现几乎一样，同一组测试跑两遍：谁改坏了都会被发现。
// 假的 wx / tt 只实现平台用到的那部分，和真的接口对得上与否由入口的类型检查（微信）和开发者工具试玩（抖音）把关。

interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}
type TouchCb = (e: { changedTouches: FakeTouch[] }) => void;

interface FakeApiOptions {
  windowWidth?: number;
  windowHeight?: number;
  pixelRatio?: number;
  safeArea?: { left: number; right: number; top: number; bottom: number };
  /** 假装平台不理会我们设的画布大小，一直保持这个尺寸 */
  fixedCanvas?: { width: number; height: number };
  withWindowInfo?: boolean;
  /** 抖音才有的录屏管理器 */
  withRecorder?: boolean;
  /** 老版本：分享菜单的接口不存在，调用会抛异常 */
  noShareMenu?: boolean;
  /** 抖音才有的侧边栏：isExist 的答案；'fail' 是接口报错，'throw' 是接口直接抛异常 */
  sidebar?: boolean | 'fail' | 'throw';
}

function fakeApi(o: FakeApiOptions = {}) {
  const info = {
    windowWidth: o.windowWidth ?? 390,
    windowHeight: o.windowHeight ?? 844,
    pixelRatio: o.pixelRatio ?? 3,
    ...(o.safeArea ? { safeArea: o.safeArea } : {}),
  };
  const ctx = new FakeCanvas2D();
  const canvasState = { width: 0, height: 0 };
  const canvas = {
    get width() {
      return o.fixedCanvas?.width ?? canvasState.width;
    },
    set width(v: number) {
      canvasState.width = v;
    },
    get height() {
      return o.fixedCanvas?.height ?? canvasState.height;
    },
    set height(v: number) {
      canvasState.height = v;
    },
    getContext: (type: '2d') => (type === '2d' ? ctx : null),
  };
  const touch: Record<'start' | 'move' | 'end' | 'cancel', TouchCb[]> = { start: [], move: [], end: [], cancel: [] };
  const store = new Map<string, unknown>();
  const shown: (() => void)[] = [];
  const hidden: (() => void)[] = [];
  const calls = { createCanvas: 0, getSystemInfoSync: 0, getWindowInfo: 0, vibrate: [] as unknown[] };

  // ---- 分享 ----
  const share = {
    sent: [] as { title: string; query?: string; channel?: string; extra?: { videoPath: string } }[],
    menus: [] as unknown[],
    defaultContent: null as null | (() => { title: string }),
    throws: false,
    /** 视频分享的结果 */
    videoResult: 'success' as 'success' | 'fail',
  };

  // ---- 埋点 ----
  const reports = { sent: [] as { via: string; event: string; data: unknown }[], throws: false };

  // ---- 侧边栏（抖音） ----
  const sidebarCalls = { opened: 0, checks: 0 };

  // ---- 录屏（抖音） ----
  const recording = {
    started: [] as { duration: number }[],
    stops: 0,
    stopCbs: [] as ((res: { videoPath: string }) => void)[],
    errorCbs: [] as ((err: unknown) => void)[],
    startThrows: false,
  };
  const manager = {
    start: (o: { duration: number }) => {
      if (recording.startThrows) throw new Error('busy');
      recording.started.push(o);
    },
    stop: () => void recording.stops++,
    onStart: () => undefined,
    onStop: (cb: (res: { videoPath: string }) => void) => void recording.stopCbs.push(cb),
    onError: (cb: (err: unknown) => void) => void recording.errorCbs.push(cb),
  };

  // ---- 广告 ----
  /** 确认框怎么回应：点领取 / 点关闭 / 弹不出来 */
  const modal = { reply: 'confirm' as 'confirm' | 'cancel' | 'fail', shown: [] as { title: string; content: string }[] };
  /** 激励视频：全局只有一个实例；show 前 failShows 次会失败（模拟还没加载好） */
  const rewarded = {
    created: [] as string[],
    closeCbs: [] as ((res?: { isEnded?: boolean }) => void)[],
    errorCbs: [] as ((err: unknown) => void)[],
    failShows: 0,
    failLoad: false,
    shows: 0,
    loads: 0,
  };
  const interstitials: {
    unit: string;
    destroyed: number;
    closeCbs: (() => void)[];
    errorCbs: ((err: unknown) => void)[];
    showResult: 'pending' | 'reject';
  }[] = [];
  const interstitialMode = { showResult: 'pending' as 'pending' | 'reject', createThrows: false };
  const api = {
    createCanvas: () => {
      calls.createCanvas++;
      return canvas;
    },
    getSystemInfoSync: () => {
      calls.getSystemInfoSync++;
      return info;
    },
    ...(o.withWindowInfo
      ? {
          getWindowInfo: () => {
            calls.getWindowInfo++;
            return info;
          },
        }
      : {}),
    onTouchStart: (cb: TouchCb) => touch.start.push(cb),
    onTouchMove: (cb: TouchCb) => touch.move.push(cb),
    onTouchEnd: (cb: TouchCb) => touch.end.push(cb),
    onTouchCancel: (cb: TouchCb) => touch.cancel.push(cb),
    getStorageSync: (key: string): unknown => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key: string, data: string) => void store.set(key, data),
    onShow: (cb: () => void) => shown.push(cb),
    onHide: (cb: () => void) => hidden.push(cb),
    vibrateShort: (option: unknown) => void calls.vibrate.push(option),
    createRewardedVideoAd: (option: { adUnitId: string }) => {
      rewarded.created.push(option.adUnitId);
      return {
        load: () => {
          rewarded.loads++;
          return rewarded.failLoad ? Promise.reject(new Error('load')) : Promise.resolve();
        },
        show: () => {
          rewarded.shows++;
          if (rewarded.failShows > 0) {
            rewarded.failShows--;
            return Promise.reject(new Error('show'));
          }
          return Promise.resolve();
        },
        onClose: (cb: (res?: { isEnded?: boolean }) => void) => void rewarded.closeCbs.push(cb),
        onError: (cb: (err: unknown) => void) => void rewarded.errorCbs.push(cb),
      };
    },
    createInterstitialAd: (option: { adUnitId: string }) => {
      if (interstitialMode.createThrows) throw new Error('不支持');
      const ad = {
        unit: option.adUnitId,
        destroyed: 0,
        closeCbs: [] as (() => void)[],
        errorCbs: [] as ((err: unknown) => void)[],
        showResult: interstitialMode.showResult,
      };
      interstitials.push(ad);
      return {
        show: () => (ad.showResult === 'reject' ? Promise.reject(new Error('频率限制')) : Promise.resolve()),
        destroy: () => void ad.destroyed++,
        onClose: (cb: () => void) => void ad.closeCbs.push(cb),
        onError: (cb: (err: unknown) => void) => void ad.errorCbs.push(cb),
      };
    },
    shareAppMessage: (option: {
      title: string;
      query?: string;
      channel?: string;
      extra?: { videoPath: string };
      success?: () => void;
      fail?: () => void;
    }) => {
      if (share.throws) throw new Error('不支持');
      share.sent.push({ title: option.title, query: option.query, channel: option.channel, extra: option.extra });
      if (option.channel === 'video') (share.videoResult === 'success' ? option.success : option.fail)?.();
    },
    showShareMenu: (option: unknown) => {
      if (o.noShareMenu) throw new Error('老版本没有');
      share.menus.push(option);
    },
    onShareAppMessage: (cb: () => { title: string }) => void (share.defaultContent = cb),
    ...(o.withRecorder ? { getGameRecorderManager: () => manager } : {}),
    reportEvent: (event: string, data: unknown) => {
      if (reports.throws) throw new Error('x');
      reports.sent.push({ via: 'reportEvent', event, data });
    },
    reportAnalytics: (event: string, data: unknown) => {
      if (reports.throws) throw new Error('x');
      reports.sent.push({ via: 'reportAnalytics', event, data });
    },
    ...(o.sidebar !== undefined
      ? {
          checkScene: (option: { scene: string; success(res: { isExist: boolean }): void; fail(): void }) => {
            sidebarCalls.checks++;
            if (o.sidebar === 'throw') throw new Error('不支持');
            if (o.sidebar === 'fail') option.fail();
            else option.success({ isExist: o.sidebar === true });
          },
          navigateToScene: (option: { scene: string; success?(): void; fail?(): void }) => {
            if (o.sidebar === 'throw') throw new Error('不支持');
            sidebarCalls.opened++;
            option.success?.();
          },
        }
      : {}),
    showModal: (option: {
      title: string;
      content: string;
      success(res: { confirm: boolean }): void;
      fail(): void;
    }) => {
      modal.shown.push({ title: option.title, content: option.content });
      if (modal.reply === 'fail') option.fail();
      else option.success({ confirm: modal.reply === 'confirm' });
    },
  };
  return { api, ctx, canvas, touch, store, shown, hidden, calls, modal, rewarded, interstitials, interstitialMode, share, recording, reports, sidebarCalls };
}

type Fake = ReturnType<typeof fakeApi>;

const frames = () => {
  const pending: ((t: number) => void)[] = [];
  return { request: (cb: (t: number) => void) => void pending.push(cb), pending };
};

type Request = (cb: (t: number) => void) => void;
const variants: { name: string; reportVia: string; make: (f: Fake, request: Request, ads?: AdUnits) => Platform }[] = [
  { name: 'wechat', reportVia: 'reportEvent', make: (f, request, ads) => createWechatPlatform(f.api, request, ads) },
  { name: 'douyin', reportVia: 'reportAnalytics', make: (f, request, ads) => createDouyinPlatform(f.api, request, ads) },
];

/** 让已经挂出去的 promise 回调都跑一遍 */
const settled = () => new Promise<void>((r) => setImmediate(r));

for (const { name, reportVia, make } of variants) {
  describe(`${name} 平台实现`, () => {
    const build = (o: FakeApiOptions = {}, ads?: AdUnits) => {
      const f = fakeApi(o);
      const fr = frames();
      return { f, fr, p: make(f, fr.request, ads) };
    };

    it('名字对得上', () => {
      assert.equal(build().p.name, name);
    });

    it('画布设成物理像素，ctx 按实际大小缩放，screen 用 CSS 像素', () => {
      const { f, p } = build({ windowWidth: 390, windowHeight: 844, pixelRatio: 3 });
      assert.equal(f.canvas.width, 1170);
      assert.equal(f.canvas.height, 2532);
      assert.deepEqual(f.ctx.of('setTransform')[0]?.args, [3, 0, 0, 3, 0, 0]);
      assert.equal(p.screen.width, 390);
      assert.equal(p.screen.height, 844);
      assert.equal(p.screen.dpr, 3);
    });

    it('平台不听我们设的画布大小时，按它实际的大小缩放，不会画歪', () => {
      const { f, p } = build({ windowWidth: 400, windowHeight: 800, fixedCanvas: { width: 400, height: 800 } });
      assert.deepEqual(f.ctx.of('setTransform')[0]?.args, [1, 0, 0, 1, 0, 0]);
      assert.equal(p.screen.dpr, 1);
    });

    it('没有 pixelRatio 当 1', () => {
      const { p } = build({ pixelRatio: 0 });
      assert.equal(p.screen.dpr, 1);
    });

    it('有 getWindowInfo 就用它，没有才退回 getSystemInfoSync', () => {
      const withInfo = build({ withWindowInfo: true });
      assert.equal(withInfo.f.calls.getWindowInfo, 1);
      assert.equal(withInfo.f.calls.getSystemInfoSync, 0);
      const without = build();
      assert.equal(without.f.calls.getSystemInfoSync, 1);
    });

    it('安全区从坐标范围换算成四边各让开多远', () => {
      const { p } = build({
        windowWidth: 390,
        windowHeight: 844,
        safeArea: { left: 0, right: 390, top: 47, bottom: 810 },
      });
      assert.deepEqual(p.screen.safeArea, { top: 47, right: 0, bottom: 34, left: 0 });
    });

    it('没有安全区字段（部分机型）就是四边都不用让', () => {
      const { p } = build();
      assert.deepEqual(p.screen.safeArea, { top: 0, right: 0, bottom: 0, left: 0 });
    });

    it('触摸：四种事件都转成 CSS 像素坐标，多根手指各带自己的 id', () => {
      const { f, p } = build();
      const got: string[] = [];
      const tag = (kind: string) => (pt: PointerPoint) => void got.push(`${kind}:${pt.id}@${pt.x},${pt.y}`);
      const handlers: PointerHandlers = { down: tag('down'), move: tag('move'), up: tag('up'), cancel: tag('cancel') };
      p.onPointer(handlers);

      const t = (identifier: number, x: number, y: number): FakeTouch => ({ identifier, clientX: x, clientY: y });
      f.touch.start[0]?.({ changedTouches: [t(7, 10, 20), t(8, 30, 40)] });
      f.touch.move[0]?.({ changedTouches: [t(7, 11, 21)] });
      f.touch.end[0]?.({ changedTouches: [t(7, 12, 22)] });
      f.touch.cancel[0]?.({ changedTouches: [t(8, 31, 41)] });

      assert.deepEqual(got, ['down:7@10,20', 'down:8@30,40', 'move:7@11,21', 'up:7@12,22', 'cancel:8@31,41']);
    });

    it('存储：写进去再读出来，原样还原', () => {
      const { p } = build();
      p.storage.set('k', { level: 3, list: [1, 2], ok: true });
      assert.deepEqual(p.storage.get('k', null), { level: 3, list: [1, 2], ok: true });
    });

    it('存储：没存过、空字符串、undefined、不是字符串、JSON 坏了，都返回默认值', () => {
      const { f, p } = build();
      assert.equal(p.storage.get('none', 'dflt'), 'dflt');
      f.store.set('empty', '');
      assert.equal(p.storage.get('empty', 'dflt'), 'dflt');
      f.store.set('undef', undefined);
      assert.equal(p.storage.get('undef', 'dflt'), 'dflt');
      f.store.set('num', 42);
      assert.equal(p.storage.get('num', 'dflt'), 'dflt');
      f.store.set('bad', '{oops');
      assert.equal(p.storage.get('bad', 'dflt'), 'dflt');
    });

    it('存储：平台写入失败（比如存满了）不抛异常；值不能序列化才抛', () => {
      const { f, p } = build();
      f.api.setStorageSync = () => {
        throw new Error('quota');
      };
      assert.doesNotThrow(() => p.storage.set('k', 1));
      assert.throws(() => p.storage.set('k', undefined), /JSON/);
    });

    it('前后台：回调转交给平台，可以注册多次', () => {
      const { f, p } = build();
      let shown = 0;
      let hidden = 0;
      p.onShow(() => shown++);
      p.onShow(() => shown++);
      p.onHide(() => hidden++);
      for (const cb of f.shown) cb();
      for (const cb of f.hidden) cb();
      assert.equal(shown, 2);
      assert.equal(hidden, 1);
    });

    it('帧时间：用平台给的时间戳；平台没给就用墙上时钟顶上', () => {
      const { fr, p } = build();
      const seen: number[] = [];
      p.requestFrame((t) => seen.push(t));
      fr.pending.shift()?.(16.7);
      assert.deepEqual(seen, [16.7]);

      p.requestFrame((t) => seen.push(t));
      (fr.pending.shift() as (t?: number) => void)();
      assert.ok((seen[1] ?? 0) > 1_600_000_000_000, '没有时间戳时用 Date.now()');
    });

    it('震动：把轻重传给平台；平台抛异常也不影响游戏', () => {
      const { f, p } = build();
      p.vibrate('light');
      p.vibrate('heavy');
      assert.deepEqual(f.calls.vibrate, [{ type: 'light' }, { type: 'heavy' }]);
      f.api.vibrateShort = () => {
        throw new Error('不支持');
      };
      assert.doesNotThrow(() => p.vibrate('light'));
    });

    describe('埋点', () => {
      it('事件名和数据交给平台的上报接口（微信 reportEvent，抖音 reportAnalytics）', () => {
        const { f, p } = build();
        p.track('level_complete', { level: 3, hints: 0, kind: 'friend' });
        assert.deepEqual(f.reports.sent, [
          { via: reportVia, event: 'level_complete', data: { level: 3, hints: 0, kind: 'friend' } },
        ]);
      });

      it('平台只收字符串和数字：布尔值转成 1 / 0', () => {
        const { f, p } = build();
        p.track('ad_rewarded', { watched: true, other: false });
        assert.deepEqual(f.reports.sent[0]?.data, { watched: 1, other: 0 });
      });

      it('没有数据也行，传一个空对象', () => {
        const { f, p } = build();
        p.track('app_open');
        assert.deepEqual(f.reports.sent[0]?.data, {});
      });

      it('平台抛异常也不影响游戏', () => {
        const { f, p } = build();
        f.reports.throws = true;
        assert.doesNotThrow(() => p.track('x', { a: 1 }));
      });
    });

    describe('分享', () => {
      it('share 把标题和链接参数交给平台', () => {
        const { f, p } = build();
        p.share({ title: '来整理行李', query: 'from=share&level=3' });
        assert.deepEqual(f.share.sent, [
          { title: '来整理行李', query: 'from=share&level=3', channel: undefined, extra: undefined },
        ]);
      });

      it('没有链接参数也能分享；平台抛异常也不影响游戏', () => {
        const { f, p } = build();
        p.share({ title: '来整理行李' });
        assert.equal(f.share.sent[0]?.query, undefined);
        f.share.throws = true;
        assert.doesNotThrow(() => p.share({ title: 'x' }));
      });

      it('启动时就打开右上角菜单的转发，并给它一个默认标题', () => {
        const { f } = build();
        assert.equal(f.share.menus.length, 1);
        assert.match(f.share.defaultContent?.().title ?? '', /整理行李箱/);
      });

      it('老版本没有分享菜单的接口，平台照样能创建', () => {
        assert.doesNotThrow(() => build({ noShareMenu: true }));
      });
    });

    describe('广告：没填广告位 id，退回模拟（确认框）', () => {
      it('点"领取奖励"才给', async () => {
        const { f, p } = build();
        f.modal.reply = 'confirm';
        assert.equal(await p.ads.rewarded('hint'), true);
        assert.equal(f.modal.shown.length, 1);
        assert.match(f.modal.shown[0]?.title ?? '', /模拟广告/);
        assert.match(f.modal.shown[0]?.content ?? '', /提示/);
      });

      it('不同的广告位，确认框里写的奖励不一样', async () => {
        const { f, p } = build();
        await p.ads.rewarded('skip');
        assert.match(f.modal.shown[0]?.content ?? '', /跳过/);
      });

      it('点"关闭"、确认框弹不出来，都不给', async () => {
        const { f, p } = build();
        f.modal.reply = 'cancel';
        assert.equal(await p.ads.rewarded('hint'), false);
        f.modal.reply = 'fail';
        assert.equal(await p.ads.rewarded('hint'), false);
      });

      it('一次放完之后可以再放', async () => {
        const { p } = build();
        assert.equal(await p.ads.rewarded('hint'), true);
        assert.equal(await p.ads.rewarded('hint'), true);
      });

      it('插屏没有广告位 id 就直接跳过，不弹任何东西', async () => {
        const { f, p } = build();
        await p.ads.interstitial('between_levels');
        assert.equal(f.modal.shown.length, 0);
        assert.equal(f.interstitials.length, 0);
      });

      it('同一时间只放一个：已经有一个在放时再请求，直接返回 false', async () => {
        const { f, p } = build({}, { rewarded: 'ad-1' });
        const first = p.ads.rewarded('hint');
        assert.equal(await p.ads.rewarded('skip'), false);
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await first, true);
      });
    });

    describe('广告：填了广告位 id，用真的激励视频', () => {
      it('完整看完（isEnded 为 true）才给；创建时带着广告位 id，实例只创建一次', async () => {
        const { f, p } = build({}, { rewarded: 'ad-rewarded' });
        const first = p.ads.rewarded('hint');
        await settled();
        assert.deepEqual(f.rewarded.created, ['ad-rewarded']);
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await first, true);

        const second = p.ads.rewarded('skip');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await second, true);
        assert.equal(f.rewarded.created.length, 1, '全局只有一个激励视频实例');
        assert.equal(f.rewarded.closeCbs.length, 1, '关闭事件只监听一次');
      });

      it('中途关闭（isEnded 为 false）不给', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        const r = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: false });
        assert.equal(await r, false);
      });

      it('老版本关闭时不带参数，当作看完；带了参数但没有 isEnded，不给', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        const old = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb();
        assert.equal(await old, true);

        const odd = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({});
        assert.equal(await odd, false);
      });

      it('平台报错（没有广告可放等）不给，之后还能再请求', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        const r = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.errorCbs) cb(new Error('no ad'));
        assert.equal(await r, false);

        const again = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await again, true);
      });

      it('第一次 show 失败（还没加载好）就加载一次再放', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        f.rewarded.failShows = 1;
        const r = p.ads.rewarded('hint');
        await settled();
        assert.equal(f.rewarded.loads, 1);
        assert.equal(f.rewarded.shows, 2);
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await r, true);
      });

      it('加载也失败就当没有广告，返回 false，之后还能再请求', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        f.rewarded.failShows = 2;
        f.rewarded.failLoad = true;
        assert.equal(await p.ads.rewarded('hint'), false);

        f.rewarded.failLoad = false;
        const again = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        assert.equal(await again, true);
      });

      it('平台没有这个接口、创建时抛异常，返回 false 而不是抛出来', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        f.api.createRewardedVideoAd = () => {
          throw new Error('老版本没有');
        };
        assert.equal(await p.ads.rewarded('hint'), false);
      });

      it('没有正在放的广告时收到的事件（比如预加载出错）直接忽略，不影响下一次', async () => {
        const { f, p } = build({}, { rewarded: 'ad' });
        const first = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });
        await first;
        for (const cb of f.rewarded.errorCbs) cb(new Error('late'));
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: true });

        const next = p.ads.rewarded('hint');
        await settled();
        for (const cb of f.rewarded.closeCbs) cb({ isEnded: false });
        assert.equal(await next, false, '上一次留下的事件不能算到这一次头上');
      });
    });

    describe('广告：填了广告位 id，用真的插屏', () => {
      it('放完（关闭）才返回，并销毁实例；每次新建一个实例', async () => {
        const { f, p } = build({}, { interstitial: 'ad-inter' });
        let done = false;
        const r = p.ads.interstitial('between_levels').then(() => (done = true));
        await settled();
        assert.equal(done, false, '还没放完不能返回');
        assert.equal(f.interstitials[0]?.unit, 'ad-inter');
        for (const cb of f.interstitials[0]?.closeCbs ?? []) cb();
        await r;
        assert.equal(f.interstitials[0]?.destroyed, 1);

        const r2 = p.ads.interstitial('between_levels');
        await settled();
        for (const cb of f.interstitials[1]?.closeCbs ?? []) cb();
        await r2;
        assert.equal(f.interstitials.length, 2);
      });

      it('show 被拒绝（比如频率限制）、平台报错、创建时抛异常，都直接返回，不卡住游戏', async () => {
        const rejected = build({}, { interstitial: 'ad' });
        rejected.f.interstitialMode.showResult = 'reject';
        await rejected.p.ads.interstitial('between_levels');
        assert.equal(rejected.f.interstitials[0]?.destroyed, 1);

        const errored = build({}, { interstitial: 'ad' });
        const r = errored.p.ads.interstitial('between_levels');
        await settled();
        for (const cb of errored.f.interstitials[0]?.errorCbs ?? []) cb(new Error('x'));
        await r;

        const throwing = build({}, { interstitial: 'ad' });
        throwing.f.interstitialMode.createThrows = true;
        await throwing.p.ads.interstitial('between_levels');
      });

      it('关闭和报错都来了，只算一次（不会重复销毁）', async () => {
        const { f, p } = build({}, { interstitial: 'ad' });
        const r = p.ads.interstitial('between_levels');
        await settled();
        for (const cb of f.interstitials[0]?.closeCbs ?? []) cb();
        for (const cb of f.interstitials[0]?.errorCbs ?? []) cb(new Error('x'));
        await r;
        assert.equal(f.interstitials[0]?.destroyed, 1);
      });
    });

    it('没有抖音才有的可选能力', () => {
      const { p } = build();
      assert.equal(p.recorder, undefined);
      assert.equal(p.sidebar, undefined);
    });
  });
}

describe('douyin 录屏', () => {
  const setup = () => {
    const f = fakeApi({ withRecorder: true });
    const p = createDouyinPlatform(f.api, frames().request);
    const recorder = p.recorder;
    assert.ok(recorder, '抖音应该有 recorder');
    /** 平台录好了：触发 onStop */
    const finish = (videoPath: string) => {
      for (const cb of f.recording.stopCbs) cb({ videoPath });
    };
    return { f, p, recorder, finish };
  };

  it('开始：按 300 秒的上限录；已经在录就不重复开始', () => {
    const { f, recorder } = setup();
    recorder.start();
    recorder.start();
    assert.deepEqual(f.recording.started, [{ duration: 300 }]);
  });

  it('停止：要等平台说录好了（onStop）才算完', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    let done = false;
    const stopped = recorder.stop().then(() => (done = true));
    await settled();
    assert.equal(f.recording.stops, 1);
    assert.equal(done, false);
    finish('/tmp/a.mp4');
    await stopped;
    assert.equal(done, true);
  });

  it('没在录的时候 stop 立刻完成，不会去叫平台', async () => {
    const { f, recorder } = setup();
    await recorder.stop();
    assert.equal(f.recording.stops, 0);
  });

  it('分享录好的视频：用视频分享的渠道，带着视频路径；玩家分享成功返回 true，取消返回 false', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    const stopped = recorder.stop();
    finish('/tmp/a.mp4');
    await stopped;

    assert.equal(await recorder.share(), true);
    assert.equal(f.share.sent[0]?.channel, 'video');
    assert.equal(f.share.sent[0]?.extra?.videoPath, '/tmp/a.mp4');

    f.share.videoResult = 'fail';
    assert.equal(await recorder.share(), false);
  });

  it('还没录过就分享：返回 false，不弹分享面板', async () => {
    const { f, recorder } = setup();
    assert.equal(await recorder.share(), false);
    assert.equal(f.share.sent.length, 0);
  });

  it('刚通关视频还在收尾时点分享：等录好了再分享', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    void recorder.stop();
    const shared = recorder.share();
    await settled();
    assert.equal(f.share.sent.length, 0, '还没录好，不能分享');
    finish('/tmp/b.mp4');
    assert.equal(await shared, true);
    assert.equal(f.share.sent[0]?.extra?.videoPath, '/tmp/b.mp4');
  });

  it('正在停止的时候来了新一关的 start：等停完再开始，不丢掉新一关', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    const stopped = recorder.stop();
    recorder.start();
    assert.equal(f.recording.started.length, 1, '还没停完，不能开始');
    finish('/tmp/a.mp4');
    await stopped;
    assert.equal(f.recording.started.length, 2);
  });

  it('新一关开始之后分享的还是上一段录好的视频', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    const stopped = recorder.stop();
    finish('/tmp/a.mp4');
    await stopped;
    recorder.start();
    assert.equal(await recorder.share(), true);
    assert.equal(f.share.sent[0]?.extra?.videoPath, '/tmp/a.mp4');
  });

  it('平台自己停下（录满上限）或出错之后，下一次 start 能重新开始', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    finish('/tmp/full.mp4');
    recorder.start();
    assert.equal(f.recording.started.length, 2);

    for (const cb of f.recording.errorCbs) cb(new Error('没权限'));
    recorder.start();
    assert.equal(f.recording.started.length, 3);
  });

  it('同一时间只有一个分享：正在分享时再点，直接返回 false', async () => {
    const { f, recorder, finish } = setup();
    recorder.start();
    const stopped = recorder.stop();
    finish('/tmp/a.mp4');
    await stopped;
    f.api.shareAppMessage = () => undefined; // 分享面板一直不回结果
    const first = recorder.share();
    assert.equal(await recorder.share(), false);
    void first;
  });

  it('平台开始录屏时抛异常，不影响游戏，之后还能再试', () => {
    const { f, recorder } = setup();
    f.recording.startThrows = true;
    assert.doesNotThrow(() => recorder.start());
    f.recording.startThrows = false;
    recorder.start();
    assert.equal(f.recording.started.length, 1);
  });

  it('客户端没有录屏接口就没有 recorder', () => {
    const f = fakeApi();
    assert.equal(createDouyinPlatform(f.api, frames().request).recorder, undefined);
  });
});

describe('douyin 侧边栏', () => {
  const setup = (sidebar: boolean | 'fail' | 'throw') => {
    const f = fakeApi({ sidebar });
    const p = createDouyinPlatform(f.api, frames().request);
    return { f, p, sidebar: p.sidebar };
  };

  it('平台说入口存在（isExist 为 true）就是可用，说不存在就是不可用', async () => {
    assert.equal(await setup(true).sidebar?.available(), true);
    assert.equal(await setup(false).sidebar?.available(), false);
  });

  it('查询失败、接口直接抛异常，都当作不可用，不抛出来', async () => {
    assert.equal(await setup('fail').sidebar?.available(), false);
    assert.equal(await setup('throw').sidebar?.available(), false);
  });

  it('open 打开侧边栏的引导页；平台抛异常也不影响游戏', () => {
    const ok = setup(true);
    ok.sidebar?.open();
    assert.equal(ok.f.sidebarCalls.opened, 1);
    const bad = setup('throw');
    assert.doesNotThrow(() => bad.sidebar?.open());
  });

  it('客户端没有侧边栏接口就没有 sidebar；微信永远没有', () => {
    const f = fakeApi();
    assert.equal(createDouyinPlatform(f.api, frames().request).sidebar, undefined);
    assert.equal(createWechatPlatform(fakeApi({ sidebar: true }).api, frames().request).sidebar, undefined);
  });
});
