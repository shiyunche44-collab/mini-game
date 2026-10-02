import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDouyinPlatform } from '../src/platform/douyin.ts';
import type { Platform, PointerHandlers, PointerPoint } from '../src/platform/types.ts';
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
  };
  return { api, ctx, canvas, touch, store, shown, hidden, calls };
}

type Fake = ReturnType<typeof fakeApi>;

const frames = () => {
  const pending: ((t: number) => void)[] = [];
  return { request: (cb: (t: number) => void) => void pending.push(cb), pending };
};

const variants: { name: string; make: (f: Fake, request: (cb: (t: number) => void) => void) => Platform }[] = [
  { name: 'wechat', make: (f, request) => createWechatPlatform(f.api, request) },
  { name: 'douyin', make: (f, request) => createDouyinPlatform(f.api, request) },
];

for (const { name, make } of variants) {
  describe(`${name} 平台实现`, () => {
    const build = (o: FakeApiOptions = {}) => {
      const f = fakeApi(o);
      const fr = frames();
      return { f, fr, p: make(f, fr.request) };
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

    it('广告占位：激励视频当作看完，插屏直接结束（4.2 换成真的）', async () => {
      const { p } = build();
      assert.equal(await p.ads.rewarded('hint'), true);
      await p.ads.interstitial('between_levels');
    });

    it('没有抖音才有的可选能力', () => {
      const { p } = build();
      assert.equal(p.recorder, undefined);
      assert.equal(p.sidebar, undefined);
    });
  });
}
