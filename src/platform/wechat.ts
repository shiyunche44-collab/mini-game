// 微信小游戏平台实现：把 wx 的接口翻译成 Platform 接口，不含游戏逻辑。
// wx 和下一帧函数都由入口传进来，这样没有微信环境也能用假对象测试；本文件里不直接碰全局对象。
// 广告、分享、埋点现在是占位实现：广告在 4.2，分享在 4.3，埋点在 4.4。
import type { Canvas2D, Platform, PointerHandlers, PointerPoint, SafeArea, ScreenInfo } from './types.ts';

interface WxTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}
interface WxTouchEvent {
  changedTouches: WxTouch[];
}
interface WxWindowInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  /** 部分机型没有安全区的概念，不会返回这个字段 */
  safeArea?: { left: number; right: number; top: number; bottom: number };
}
interface WxCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** 游戏用到的那部分 wx。入口传真正的 wx 进来，类型检查会对照微信的类型库确认这些签名没写错。 */
export interface WechatApi {
  createCanvas(): WxCanvas;
  getSystemInfoSync(): WxWindowInfo;
  /** 新基础库才有，有就优先用：getSystemInfoSync 已经被微信标为不推荐 */
  getWindowInfo?(): WxWindowInfo;
  onTouchStart(cb: (e: WxTouchEvent) => void): void;
  onTouchMove(cb: (e: WxTouchEvent) => void): void;
  onTouchEnd(cb: (e: WxTouchEvent) => void): void;
  onTouchCancel(cb: (e: WxTouchEvent) => void): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: string): void;
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  vibrateShort(option: { type: 'light' | 'heavy' }): void;
}

/** 注册下一帧回调。小游戏里 requestAnimationFrame 是全局函数，不在 wx 上，所以由入口传进来。 */
export type FrameRequester = (cb: (t: number) => void) => void;

export function createWechatPlatform(api: WechatApi, requestFrame: FrameRequester): Platform {
  const info = typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : api.getSystemInfoSync();
  const width = info.windowWidth;
  const height = info.windowHeight;

  // 第一次 createCanvas 拿到的就是上屏的画布，大小默认不一定是物理像素。
  // 这里设成物理像素让画面清晰，再按它最后实际的大小算缩放：平台没听我们的也不会画歪。
  const canvas = api.createCanvas();
  const wanted = info.pixelRatio || 1;
  canvas.width = Math.round(width * wanted);
  canvas.height = Math.round(height * wanted);
  const dpr = canvas.width / width;

  const real = canvas.getContext('2d');
  if (!real) throw new Error('这个环境不支持 Canvas 2D');
  const ctx = real as unknown as Canvas2D;
  // 游戏层只用 CSS 像素，缩放在这里一次做完
  ctx.setTransform(dpr, 0, 0, canvas.height / height, 0, 0);

  const screen: ScreenInfo = { width, height, dpr, safeArea: safeAreaOf(info) };

  return {
    name: 'wechat',
    ctx,
    screen,

    onPointer(handlers: PointerHandlers): void {
      // 画布铺满屏幕，触点的 clientX/Y 就是画布上的 CSS 像素坐标
      const each = (e: WxTouchEvent, fn: (p: PointerPoint) => void): void => {
        for (const t of e.changedTouches) fn({ id: t.identifier, x: t.clientX, y: t.clientY });
      };
      api.onTouchStart((e) => each(e, handlers.down));
      api.onTouchMove((e) => each(e, handlers.move));
      api.onTouchEnd((e) => each(e, handlers.up));
      api.onTouchCancel((e) => each(e, handlers.cancel));
    },

    requestFrame(cb: (frameTimeMs: number) => void): void {
      // 帧时间只用来算 dt。基础库没传时间戳的话用墙上时钟顶上
      requestFrame((t) => cb(typeof t === 'number' ? t : Date.now()));
    },
    now(): number {
      return Date.now();
    },

    storage: {
      get<T>(key: string, fallback: T): T {
        try {
          const raw = api.getStorageSync(key);
          // 没有这个 key 时返回空字符串
          return typeof raw === 'string' && raw !== '' ? (JSON.parse(raw) as T) : fallback;
        } catch {
          // 数据坏了 JSON.parse 会抛
          return fallback;
        }
      },
      set(key: string, value: unknown): void {
        const raw = JSON.stringify(value);
        if (raw === undefined) throw new Error(`storage.set("${key}")：值不能被 JSON 序列化`);
        try {
          api.setStorageSync(key, raw);
        } catch {
          // 存储满了：只是这次进度不保留，不该让游戏崩掉
        }
      },
    },

    // 占位：4.2 换成真的激励视频和插屏。现在激励视频直接当作看完，开发者工具里可以先试玩提示和跳关。
    ads: {
      rewarded: () => Promise.resolve(true),
      interstitial: () => Promise.resolve(),
    },

    share(): void {
      // 4.3
    },
    vibrate(kind): void {
      try {
        api.vibrateShort({ type: kind });
      } catch {
        // 震动失败不影响游戏
      }
    },
    onShow(cb: () => void): void {
      api.onShow(cb);
    },
    onHide(cb: () => void): void {
      api.onHide(cb);
    },
    track(): void {
      // 4.4
    },
  };
}

/** 平台给的是安全区的坐标范围，Platform 要的是四边各让开多远 */
function safeAreaOf(info: WxWindowInfo): SafeArea {
  const a = info.safeArea;
  if (!a) return { top: 0, right: 0, bottom: 0, left: 0 };
  const inset = (v: number): number => (v > 0 ? v : 0);
  return {
    top: inset(a.top),
    left: inset(a.left),
    right: inset(info.windowWidth - a.right),
    bottom: inset(info.windowHeight - a.bottom),
  };
}
