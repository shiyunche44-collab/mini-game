// Web 平台实现：开发调试和手机试玩链接用。只把浏览器 API 翻译成 Platform 接口，不含游戏逻辑。
import type {
  Canvas2D,
  InterstitialPlacement,
  Platform,
  PointerHandlers,
  RewardedPlacement,
  SafeArea,
  ScreenInfo,
} from './types.ts';

/**
 * 把 canvas 铺满窗口，返回 Platform。窗口大小只在创建时读一次：
 * Platform 接口还没有"尺寸变了"的通知，转屏或改窗口宽度后由入口刷新页面（见 entry/web.ts）。
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
    safeArea: readSafeArea(),
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
      // 模拟广告：激励视频有弹层（倒计时之后才能领奖，可以提前关闭）；插屏只打日志，直接当作展示完
      rewarded: showMockRewarded,
      interstitial(placement: InterstitialPlacement): Promise<void> {
        console.info(`[模拟广告] 插屏：${placement}`);
        return Promise.resolve();
      },
    },

    audio: createAudio(),

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

// ---------------------------------------------------------------------------
// 模拟激励视频
// ---------------------------------------------------------------------------

/** 模拟广告要"播"多久（秒）。真广告通常 15～30 秒，这里只是让玩家体验一下"要等一会儿才给"的流程 */
const MOCK_AD_SECONDS = 3;

const REWARD_TEXT: Record<RewardedPlacement, string> = {
  hint: '获得一次提示',
  skip: '跳过这一关',
};

/** 同一时间只会有一个广告。已经有一个在播时再请求，当作没广告：返回 false，和接口约定一致 */
let adOpen = false;

/**
 * 音效：用 WebAudio 的振荡器合成（ADR 0005）。浏览器要求用户操作之后才能出声，所以第一次播放时才创建
 * （播放总是由点击或拖动触发的），被挂起就恢复。每个音符的增益先快速升上去再线性降到 0，避免"啪"的一声。
 */
function createAudio(): Platform['audio'] {
  let ctx: AudioContext | null | undefined;
  const get = (): AudioContext | null => {
    if (ctx === undefined) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        ctx = Ctor ? new Ctor() : null;
      } catch {
        ctx = null;
      }
    }
    return ctx;
  };
  return {
    play(tones): void {
      const audio = get();
      if (!audio) return;
      try {
        if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
        const t0 = audio.currentTime;
        for (const tone of tones) {
          const at = t0 + tone.start / 1000;
          const end = at + tone.duration / 1000;
          const osc = audio.createOscillator();
          const amp = audio.createGain();
          osc.type = tone.wave;
          osc.frequency.setValueAtTime(tone.freq, at);
          if (tone.endFreq !== undefined) osc.frequency.linearRampToValueAtTime(tone.endFreq, end);
          amp.gain.setValueAtTime(0, at);
          amp.gain.linearRampToValueAtTime(tone.gain, at + 0.008);
          amp.gain.linearRampToValueAtTime(0, end);
          osc.connect(amp);
          amp.connect(audio.destination);
          osc.start(at);
          osc.stop(end + 0.02);
        }
      } catch {
        // 播不出来只是没声音，不该影响游戏
      }
    },
  };
}

/**
 * 全屏弹层：暗幕里一张卡片，倒计时结束才出现"领取奖励"，右上角的 ✕ 随时可以关。
 * 领取返回 true，提前关闭返回 false。节点上的 data-* 是给浏览器测试找按钮用的。
 */
function showMockRewarded(placement: RewardedPlacement): Promise<boolean> {
  if (adOpen) return Promise.resolve(false);
  adOpen = true;

  return new Promise<boolean>((resolve) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ''): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.style.cssText = css;
      node.textContent = text;
      return node;
    };
    const font = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

    const root = el(
      'div',
      `position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
       background:rgba(40,28,20,.72);font-family:${font};touch-action:none;user-select:none;-webkit-user-select:none`,
    );
    root.dataset.mockAd = 'rewarded';
    const card = el(
      'div',
      `position:relative;width:min(300px,84vw);padding:28px 20px 22px;border-radius:20px;background:#fffdf8;
       text-align:center;color:#4a3728;box-shadow:0 12px 40px rgba(0,0,0,.4)`,
    );
    const close = el(
      'button',
      `position:absolute;top:8px;right:8px;width:36px;height:36px;border:0;border-radius:18px;background:#f0e4d2;
       color:#8a7461;font-size:18px;line-height:36px;cursor:pointer`,
      '✕',
    );
    close.dataset.action = 'close';
    close.setAttribute('aria-label', '关闭广告');
    const title = el('div', 'font-size:13px;color:#8a7461;letter-spacing:1px', '模拟广告（广告位还没开通）');
    const icon = el('div', 'font-size:48px;margin:14px 0 6px', '📺');
    const reward = el('div', 'font-size:18px;font-weight:700', REWARD_TEXT[placement]);
    const hint = el('div', 'font-size:13px;color:#8a7461;margin-top:6px;min-height:18px');
    const claim = el(
      'button',
      `margin-top:16px;width:100%;height:46px;border:0;border-radius:23px;font-size:17px;font-weight:700;
       background:#d9ccbc;color:#fff;cursor:default`,
    );
    claim.dataset.action = 'claim';
    claim.disabled = true;

    card.append(close, title, icon, reward, hint, claim);
    root.append(card);

    let left = MOCK_AD_SECONDS;
    let timer = 0;
    const finish = (watched: boolean): void => {
      window.clearInterval(timer);
      root.remove();
      adOpen = false;
      resolve(watched);
    };
    const render = (): void => {
      if (left > 0) {
        hint.textContent = `看完才能领取，提前关闭拿不到奖励`;
        claim.textContent = `${left} 秒后可领取`;
      } else {
        hint.textContent = '看完了，领取奖励吧';
        claim.textContent = '领取奖励';
        claim.disabled = false;
        claim.style.background = '#e8604c';
        claim.style.cursor = 'pointer';
      }
    };
    render();
    timer = window.setInterval(() => {
      left = Math.max(0, left - 1);
      render();
      if (left === 0) window.clearInterval(timer);
    }, 1000);

    close.addEventListener('click', () => finish(false));
    claim.addEventListener('click', () => {
      if (left === 0) finish(true);
    });
    document.body.append(root);
  });
}

/**
 * 读刘海和底部横条要避开的距离。页面用 viewport-fit=cover 铺到了刘海下面，不避开的话行李牌会被刘海盖住。
 * 浏览器只在 CSS 里给这个值（env(safe-area-inset-*)），所以放一个看不见的元素，把它们当 padding，再读算出来的像素。
 * 不支持 env() 的浏览器读到的是 0，也就是没有安全区。
 */
function readSafeArea(): SafeArea {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const style = window.getComputedStyle(probe);
  const px = (v: string): number => Number.parseFloat(v) || 0;
  const area = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
  probe.remove();
  return area;
}
