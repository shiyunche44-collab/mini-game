// Web 平台实现：开发调试和手机试玩链接用。只把浏览器 API 翻译成 Platform 接口，不含游戏逻辑。
import type { Canvas2D, Platform, PointerHandlers, RewardedPlacement, InterstitialPlacement, ScreenInfo } from './types.ts';

/**
 * 把 canvas 铺满窗口，返回 Platform。窗口大小只在创建时读一次：
 * Platform 接口还没有"尺寸变了"的通知（记在 backlog），改窗口大小后要刷新页面。
 */
export function createWebPlatform(canvas: HTMLCanvasElement): Platform {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const real = canvas.getContext('2d');
  if (!real) throw new Error('这个浏览器不支持 Canvas 2D');
  // 游戏层只用 CSS 像素，缩放在这里一次做完
  real.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 浏览器的 drawImage 参数类型比 Canvas2D 里的 ImageSource 宽，两者对不上编译器的检查，
  // 这里断言一次；其余成员由 canvas-compat.check.ts 在编译期保证兼容。
  const ctx = real as unknown as Canvas2D;

  const screen: ScreenInfo = {
    width,
    height,
    dpr,
    // 浏览器读不到刘海和底部横条的尺寸，试玩时按没有处理
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  return {
    name: 'web',
    ctx,
    screen,

    onPointer(handlers: PointerHandlers): void {
      // 鼠标恒为 0（接口约定）；触摸和笔用浏览器给的 pointerId
      const idOf = (e: PointerEvent): number => (e.pointerType === 'mouse' ? 0 : e.pointerId);
      const point = (e: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        return { id: idOf(e), x: e.clientX - box.left, y: e.clientY - box.top };
      };
      // 鼠标没按下时也会有 move，这种不转给游戏
      const down = new Set<number>();

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // 捕获之后，手指拖出画布外也还能收到 move 和 up
        canvas.setPointerCapture(e.pointerId);
        down.add(idOf(e));
        handlers.down(point(e));
      });
      canvas.addEventListener('pointermove', (e) => {
        if (down.has(idOf(e))) handlers.move(point(e));
      });
      canvas.addEventListener('pointerup', (e) => {
        if (!down.delete(idOf(e))) return;
        handlers.up(point(e));
      });
      canvas.addEventListener('pointercancel', (e) => {
        if (!down.delete(idOf(e))) return;
        handlers.cancel(point(e));
      });
    },

    requestFrame(cb: (frameTimeMs: number) => void): void {
      window.requestAnimationFrame(cb);
    },
    now(): number {
      return Date.now();
    },

    storage: {
      get<T>(key: string, fallback: T): T {
        try {
          const raw = window.localStorage.getItem(key);
          return raw === null ? fallback : (JSON.parse(raw) as T);
        } catch {
          // 隐私模式下访问 localStorage 会抛异常，数据坏了 JSON.parse 也会抛
          return fallback;
        }
      },
      set(key: string, value: unknown): void {
        const raw = JSON.stringify(value);
        if (raw === undefined) throw new Error(`storage.set("${key}")：值不能被 JSON 序列化`);
        try {
          window.localStorage.setItem(key, raw);
        } catch {
          // 存储满了或被禁用：存不进去只是这次进度不保留，不该让游戏崩掉
        }
      },
    },

    ads: {
      // 模拟广告：直接当作看完 / 展示完。弹层版本在 3.4 做。
      rewarded(placement: RewardedPlacement): Promise<boolean> {
        console.info(`[模拟广告] 激励视频：${placement}，视为看完`);
        return Promise.resolve(true);
      },
      interstitial(placement: InterstitialPlacement): Promise<void> {
        console.info(`[模拟广告] 插屏：${placement}`);
        return Promise.resolve();
      },
    },

    share(payload): void {
      console.info('[分享]', payload.title, payload.query ?? '');
    },
    vibrate(kind): void {
      // 很多桌面浏览器和 iOS 没有 vibrate，没有就算了
      window.navigator.vibrate?.(kind === 'light' ? 10 : 30);
    },
    onShow(cb: () => void): void {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) cb();
      });
    },
    onHide(cb: () => void): void {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) cb();
      });
    },
    track(event, params): void {
      console.debug('[埋点]', event, params ?? {});
    },
  };
}
