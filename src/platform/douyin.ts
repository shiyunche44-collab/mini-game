// 抖音小游戏平台实现：把 tt 的接口翻译成 Platform 接口，不含游戏逻辑。
// tt 和下一帧函数都由入口传进来，这样没有抖音环境也能用假对象测试；本文件里不直接碰全局对象。
import type {
  Canvas2D,
  ImageSource,
  Platform,
  PointerHandlers,
  PointerPoint,
  RewardedPlacement,
  SafeArea,
  ScreenInfo,
  TrackParams,
} from './types.ts';

interface TtTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}
interface TtTouchEvent {
  changedTouches: TtTouch[];
}
interface TtWindowInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  /** 部分机型没有安全区的概念，不会返回这个字段 */
  safeArea?: { left: number; right: number; top: number; bottom: number };
}
interface TtCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

/** 激励视频：抖音里它是全局唯一的实例，创建一次反复用 */
interface TtRewardedAd {
  load(): Promise<unknown>;
  show(): Promise<unknown>;
  /** 老版本关闭时不带参数 */
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
  onError(cb: (err: unknown) => void): void;
}
interface TtInterstitialAd {
  show(): Promise<unknown>;
  destroy(): void;
  onClose(cb: () => void): void;
  onError(cb: (err: unknown) => void): void;
}
interface TtModalOption {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
  success(res: { confirm: boolean }): void;
  fail(): void;
}

interface TtRecorderManager {
  /** duration 单位是秒 */
  start(option: { duration: number }): void;
  stop(): void;
  onStart(cb: () => void): void;
  onStop(cb: (res: { videoPath: string }) => void): void;
  onError(cb: (err: unknown) => void): void;
}
interface TtVideoShareOption {
  channel: 'video';
  title: string;
  extra: { videoPath: string };
  success(): void;
  fail(): void;
}

/** 广告位 id。没填（空字符串或没传）的那一种广告退回模拟：激励视频弹确认框，插屏直接跳过。 */
export interface AdUnits {
  rewarded?: string;
  interstitial?: string;
}

/** 游戏用到的那部分 tt。没有引入抖音的类型库（不加依赖），platform/tt.d.ts 里的 tt 是 any，这些签名没有编译期保证，只能靠开发者工具里试玩来验证。 */
export interface DouyinApi {
  createCanvas(): TtCanvas;
  getSystemInfoSync(): TtWindowInfo;
  /** 新版本才有就优先用，没有就退回 getSystemInfoSync */
  getWindowInfo?(): TtWindowInfo;
  onTouchStart(cb: (e: TtTouchEvent) => void): void;
  onTouchMove(cb: (e: TtTouchEvent) => void): void;
  onTouchEnd(cb: (e: TtTouchEvent) => void): void;
  onTouchCancel(cb: (e: TtTouchEvent) => void): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: string): void;
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  vibrateShort(option: { type: 'light' | 'heavy' }): void;
  /** 合成音效用。老版本没有就没有声音；抖音这端没有对照官方文档 */
  createWebAudioContext?(): unknown;
  /** 读图用（ADR 0006）。抖音这端没有对照官方文档 */
  createImage?(): MiniImage;
  createRewardedVideoAd(option: { adUnitId: string }): TtRewardedAd;
  createInterstitialAd(option: { adUnitId: string }): TtInterstitialAd;
  showModal(option: TtModalOption): void;
  shareAppMessage(option: { title: string; query?: string } | TtVideoShareOption): void;
  /** 比较老的客户端没有录屏，没有就不提供 recorder */
  getGameRecorderManager?(): TtRecorderManager;
  showShareMenu(option: {  }): void;
  onShareAppMessage(cb: () => { title: string }): void;
  reportAnalytics(eventName: string, data: Record<string, string | number>): void;
  /** 侧边栏复访：比较老的客户端没有，没有就不提供 sidebar */
  checkScene?(option: { scene: 'sidebar'; success(res: { isExist: boolean }): void; fail(): void }): void;
  navigateToScene?(option: { scene: 'sidebar'; success?(): void; fail?(): void }): void;
}

/** 注册下一帧回调。小游戏里 requestAnimationFrame 是全局函数，不在 tt 上，所以由入口传进来。 */
export type FrameRequester = (cb: (t: number) => void) => void;

export function createDouyinPlatform(api: DouyinApi, requestFrame: FrameRequester, adUnits: AdUnits = {}): Platform {
  const info = typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : api.getSystemInfoSync();
  const width = info.windowWidth;
  const height = info.windowHeight;

  // 第一次 tt.createCanvas 拿到的就是上屏的画布，大小默认不一定是物理像素。
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

  enableShareMenu(api);

  const screen: ScreenInfo = { width, height, dpr, safeArea: safeAreaOf(info) };

  return {
    name: 'douyin',
    ctx,
    screen,

    onPointer(handlers: PointerHandlers): void {
      // 画布铺满屏幕，触点的 clientX/Y 就是画布上的 CSS 像素坐标
      const each = (e: TtTouchEvent, fn: (p: PointerPoint) => void): void => {
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
          // 没有这个 key 时可能返回空字符串，也可能是 undefined，都当作没存过
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

    ads: createAds(api, adUnits),

    audio: createAudio(api.createWebAudioContext?.bind(api)),

    loadImage: (path) => loadImage(api, path),

    share(payload): void {
      try {
        api.shareAppMessage({ title: payload.title, query: payload.query });
      } catch {
        // 分享失败不影响游戏
      }
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
    ...(api.checkScene && api.navigateToScene ? { sidebar: createSidebar(api.checkScene.bind(api), api.navigateToScene.bind(api)) } : {}),
    ...(api.getGameRecorderManager ? { recorder: createRecorder(api, api.getGameRecorderManager()) } : {}),
    track(event, params): void {
      try {
        api.reportAnalytics(event, toReportData(params));
      } catch {
        // 埋点失败不影响游戏
      }
    },
  };
}

/** 平台给的是安全区的坐标范围，Platform 要的是四边各让开多远 */
function safeAreaOf(info: TtWindowInfo): SafeArea {
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

const REWARD_TEXT: Record<RewardedPlacement, string> = {
  hint: '获得一次提示',
  skip: '跳过这一关',
};

/**
 * 激励视频只有完整看完才返回 true；中途关闭、加载失败、没有广告都返回 false，不会抛异常。
 * 同一时间只放一个：已经有一个在放时再请求直接返回 false，和 Web 的模拟广告一样。
 */
/** 小游戏里的图片对象：设 src 开始读，读完回调 onload，读不了回调 onerror */
interface MiniImage extends ImageSource {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

/** 读图（ADR 0006）：任何失败（接口不存在、抛异常、读不到文件）都返回 null，游戏退回 emoji */
function loadImage(api: DouyinApi, path: string): Promise<ImageSource | null> {
  return new Promise((resolve) => {
    try {
      const img = api.createImage?.();
      if (!img) return resolve(null);
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = path;
    } catch {
      resolve(null);
    }
  });
}

/** 游戏用到的那一小部分 WebAudio。AudioParam 的自动化方法（淡入淡出、滑音）老版本可能没有，所以都是可选的 */
interface AudioParamLike {
  value: number;
  setValueAtTime?(value: number, time: number): unknown;
  linearRampToValueAtTime?(value: number, time: number): unknown;
}
interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): unknown;
  createOscillator(): {
    type: string;
    readonly frequency: AudioParamLike;
    connect(node: unknown): unknown;
    start(when?: number): void;
    stop(when?: number): void;
  };
  createGain(): { readonly gain: AudioParamLike; connect(node: unknown): unknown };
}

/**
 * 音效：用振荡器合成（ADR 0005）。音频上下文第一次播放时才创建，创建失败就永远当作没播。
 * 每个音符是一个振荡器加一个增益节点：增益先快速升上去再线性降到 0，避免开头结尾"啪"的一声。
 */
function createAudio(create: (() => unknown) | undefined): Platform['audio'] {
  let ctx: AudioContextLike | null | undefined;
  const get = (): AudioContextLike | null => {
    if (ctx === undefined) {
      try {
        ctx = create ? (create() as AudioContextLike) : null;
      } catch {
        ctx = null;
      }
    }
    return ctx ?? null;
  };
  return {
    play(tones): void {
      const audio = get();
      if (!audio) return;
      try {
        if (audio.state === 'suspended') audio.resume?.();
        const t0 = audio.currentTime;
        for (const tone of tones) {
          const at = t0 + tone.start / 1000;
          const end = at + tone.duration / 1000;
          const osc = audio.createOscillator();
          const amp = audio.createGain();
          osc.type = tone.wave;
          osc.frequency.value = tone.freq;
          if (tone.endFreq !== undefined) {
            osc.frequency.setValueAtTime?.(tone.freq, at);
            osc.frequency.linearRampToValueAtTime?.(tone.endFreq, end);
          }
          amp.gain.value = tone.gain;
          if (amp.gain.setValueAtTime && amp.gain.linearRampToValueAtTime) {
            amp.gain.setValueAtTime(0, at);
            amp.gain.linearRampToValueAtTime(tone.gain, at + 0.008);
            amp.gain.linearRampToValueAtTime(0, end);
          }
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

function createAds(api: DouyinApi, adUnits: AdUnits): Platform['ads'] {
  let busy = false;
  let rewardedAd: TtRewardedAd | null = null;
  /** 正在放的那一次激励视频，放完（看完、关闭、出错）时交结果 */
  let settle: ((watched: boolean) => void) | null = null;

  const showRewarded = (unit: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      settle = resolve;
      if (!rewardedAd) {
        const created = api.createRewardedVideoAd({ adUnitId: unit });
        // 事件监听只注册一次，靠 settle 区分是哪一次请求；没有正在放的广告时的事件（比如预加载失败）直接忽略
        created.onClose((res) => settle?.(res === undefined || res.isEnded === true));
        created.onError(() => settle?.(false));
        rewardedAd = created;
      }
      const ad = rewardedAd;
      // 还没加载好时 show 会失败：加载一次再放，再失败就当没有广告
      ad.show()
        .catch(() => ad.load().then(() => ad.show()))
        .catch(() => settle?.(false));
    });

  // 没填广告位 id 时用系统确认框模拟：点"领取奖励"才给，点"关闭"或者点框外都不给
  const showMock = (placement: RewardedPlacement): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      api.showModal({
        title: '模拟广告（广告位还没开通）',
        content: `${REWARD_TEXT[placement]}。点"领取奖励"才给，点"关闭"拿不到。`,
        confirmText: '领取奖励',
        cancelText: '关闭',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false),
      });
    });

  return {
    rewarded(placement: RewardedPlacement): Promise<boolean> {
      if (busy) return Promise.resolve(false);
      busy = true;
      const run = adUnits.rewarded ? showRewarded(adUnits.rewarded) : showMock(placement);
      const finish = (watched: boolean): boolean => {
        busy = false;
        settle = null;
        return watched;
      };
      // 创建广告对象这一步在老版本里可能直接抛异常，也当作没有广告
      return run.then(finish, () => finish(false));
    },

    interstitial(): Promise<void> {
      const unit = adUnits.interstitial;
      if (!unit) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let ended = false;
        // 插屏每次新建一个实例，放完就销毁
        let ad: TtInterstitialAd | null = null;
        const done = (): void => {
          if (ended) return;
          ended = true;
          try {
            ad?.destroy();
          } catch {
            // 销毁失败不影响游戏
          }
          resolve();
        };
        try {
          ad = api.createInterstitialAd({ adUnitId: unit });
          ad.onClose(done);
          ad.onError(done);
          // 平台会限制弹出频率，show 被拒绝就当没有广告
          ad.show().catch(done);
        } catch {
          done();
        }
      });
    },
  };
}

/** 右上角菜单里的"转发"用的默认标题。游戏里主动点的分享用的是自己的标题（见 game/Session.ts） */
const DEFAULT_SHARE_TITLE = '整理行李箱：把行李都装进箱子，就能出发';

/** 打开右上角菜单的转发，并给它一个默认标题；老版本没有这些接口就算了 */
function enableShareMenu(api: DouyinApi): void {
  try {
    api.showShareMenu({  });
    api.onShareAppMessage(() => ({ title: DEFAULT_SHARE_TITLE }));
  } catch {
    // 分享菜单打不开不影响游戏
  }
}

/** 抖音限制单段录屏最长 300 秒，超过会自己停下 */
const RECORD_SECONDS = 300;
const VIDEO_TITLE = '整理行李箱：看我怎么把行李塞进箱子';

/**
 * 录屏。录的过程是异步的（start 之后才开始录，stop 之后要等 onStop 才有视频），
 * 所以记三个状态：空闲、录制中、正在停止。
 * 游戏每一关开头调 start、通关时调 stop，两次调用可能挨得很近（玩家连点"下一站"），
 * 正在停止的时候来了 start，就等停完再开始，不能丢掉新一关的录制。
 */
function createRecorder(api: DouyinApi, manager: TtRecorderManager): NonNullable<Platform['recorder']> {
  let state: 'idle' | 'recording' | 'stopping' = 'idle';
  let startAfterStop = false;
  /** 最近一次录好的视频 */
  let videoPath: string | null = null;
  let stopped: (() => void)[] = [];
  let sharing = false;

  const begin = (): void => {
    try {
      manager.start({ duration: RECORD_SECONDS });
      state = 'recording';
    } catch {
      state = 'idle';
    }
  };
  const settleStop = (path: string | null): void => {
    state = 'idle';
    if (path) videoPath = path;
    const waiting = stopped;
    stopped = [];
    for (const done of waiting) done();
    if (startAfterStop) {
      startAfterStop = false;
      begin();
    }
  };
  // 录满时长上限时平台自己停下，也会走 onStop
  manager.onStop((res) => settleStop(res?.videoPath || null));
  // 出错（没权限、录屏被占用）就当这一段没录成，之后还可以再开始
  manager.onError(() => settleStop(null));

  const untilStopped = (): Promise<void> => new Promise<void>((resolve) => stopped.push(resolve));

  return {
    start(): void {
      if (state === 'idle') begin();
      else if (state === 'stopping') startAfterStop = true;
    },
    stop(): Promise<void> {
      if (state === 'idle') return Promise.resolve();
      startAfterStop = false;
      if (state === 'stopping') return untilStopped();
      state = 'stopping';
      const done = untilStopped();
      try {
        manager.stop();
      } catch {
        settleStop(null);
      }
      return done;
    },
    async share(): Promise<boolean> {
      if (sharing) return false;
      sharing = true;
      try {
        // 刚通关就点分享时，视频可能还在收尾
        if (state === 'stopping') await untilStopped();
        const path = videoPath;
        if (!path) return false;
        return await new Promise<boolean>((resolve) => {
          try {
            api.shareAppMessage({
              channel: 'video',
              title: VIDEO_TITLE,
              extra: { videoPath: path },
              success: () => resolve(true),
              fail: () => resolve(false),
            });
          } catch {
            resolve(false);
          }
        });
      } finally {
        sharing = false;
      }
    },
  };
}

/**
 * 平台的埋点只收字符串和数字。布尔值转成 1 / 0，方便在后台按数值筛。
 */
function toReportData(params: TrackParams | undefined): Record<string, string | number> {
  const data: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) data[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  return data;
}

/**
 * 侧边栏复访：available 问当前客户端能不能放"添加到侧边栏"的入口，open 打开引导页。
 * 任何失败（接口不存在、没权限、网络）都当作"不可用"，不抛异常。
 */
function createSidebar(
  checkScene: NonNullable<DouyinApi['checkScene']>,
  navigateToScene: NonNullable<DouyinApi['navigateToScene']>,
): NonNullable<Platform['sidebar']> {
  return {
    available(): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        try {
          checkScene({ scene: 'sidebar', success: (res) => resolve(res?.isExist === true), fail: () => resolve(false) });
        } catch {
          resolve(false);
        }
      });
    },
    open(): void {
      try {
        navigateToScene({ scene: 'sidebar', success: () => undefined, fail: () => undefined });
      } catch {
        // 打不开引导页不影响游戏
      }
    },
  };
}
