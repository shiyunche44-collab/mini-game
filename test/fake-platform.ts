// 跑在 node 里的假平台。game 层的测试都建立在它上面：
// 能在这里跑通，就说明游戏层没有偷偷依赖浏览器、微信或抖音。
//
// - ctx 会记录每一次绘制调用（和调用时的样式），测试可以检查"画了什么"
// - touch 可以模拟按下、移动、抬起，以及点击、拖动
// - 时间由测试手动推进（advance），帧回调和 now() 都跟着走
// - 广告结果、前后台切换都由测试控制
import type {
  Canvas2D,
  Gradient,
  ImageSource,
  InterstitialPlacement,
  Platform,
  PointerHandlers,
  RewardedPlacement,
  SafeArea,
  ScreenInfo,
  SharePayload,
  TextMetrics2D,
  TrackParams,
} from '../src/platform/types.ts';

// ---------------------------------------------------------------------------
// 记录绘制调用的 ctx
// ---------------------------------------------------------------------------

export interface StyleSnapshot {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  shadowBlur: number;
}

export interface DrawCall {
  op: string;
  args: unknown[];
  /** 调用发生时的样式 */
  style: StyleSnapshot;
}

class FakeGradient implements Gradient {
  readonly stops: [number, string][] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

export class FakeCanvas2D implements Canvas2D {
  readonly calls: DrawCall[] = [];
  /** 当前 save 的层数，测试可以检查 save / restore 是否配对 */
  saveDepth = 0;

  fillStyle: string | Gradient = '#000000';
  strokeStyle: string | Gradient = '#000000';
  lineWidth = 1;
  lineCap: 'butt' | 'round' | 'square' = 'butt';
  lineJoin: 'bevel' | 'round' | 'miter' = 'miter';
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end' = 'start';
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom' = 'alphabetic';
  shadowColor = 'rgba(0, 0, 0, 0)';
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;

  private stack: StyleSnapshot[] = [];

  private rec(op: string, args: unknown[]): void {
    this.calls.push({ op, args, style: this.snapshot() });
  }

  private snapshot(): StyleSnapshot {
    return {
      fillStyle: styleName(this.fillStyle),
      strokeStyle: styleName(this.strokeStyle),
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      font: this.font,
      shadowBlur: this.shadowBlur,
    };
  }

  /** 某个操作被调用了几次 */
  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  /** 取出某个操作的所有调用 */
  of(op: string): DrawCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  save(): void {
    this.rec('save', []);
    this.stack.push(this.snapshot());
    this.saveDepth++;
  }
  restore(): void {
    this.rec('restore', []);
    const s = this.stack.pop();
    if (!s) return;
    this.saveDepth--;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha;
    this.font = s.font;
    this.shadowBlur = s.shadowBlur;
  }

  scale(x: number, y: number): void {
    this.rec('scale', [x, y]);
  }
  rotate(angle: number): void {
    this.rec('rotate', [angle]);
  }
  translate(x: number, y: number): void {
    this.rec('translate', [x, y]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.rec('transform', [a, b, c, d, e, f]);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.rec('setTransform', [a, b, c, d, e, f]);
  }

  beginPath(): void {
    this.rec('beginPath', []);
  }
  closePath(): void {
    this.rec('closePath', []);
  }
  moveTo(x: number, y: number): void {
    this.rec('moveTo', [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.rec('lineTo', [x, y]);
  }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void {
    this.rec('arc', [x, y, radius, startAngle, endAngle, counterclockwise]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.rec('arcTo', [x1, y1, x2, y2, radius]);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.rec('quadraticCurveTo', [cpx, cpy, x, y]);
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.rec('bezierCurveTo', [cp1x, cp1y, cp2x, cp2y, x, y]);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.rec('rect', [x, y, w, h]);
  }
  fill(): void {
    this.rec('fill', []);
  }
  stroke(): void {
    this.rec('stroke', []);
  }
  clip(): void {
    this.rec('clip', []);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.rec('clearRect', [x, y, w, h]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec('fillRect', [x, y, w, h]);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.rec('strokeRect', [x, y, w, h]);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.rec('fillText', [text, x, y, maxWidth]);
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.rec('strokeText', [text, x, y, maxWidth]);
  }
  measureText(text: string): TextMetrics2D {
    // 粗略估算：全角字符按字号宽，其余按字号的一半
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    let width = 0;
    for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 0xff ? size : size / 2;
    return { width };
  }

  drawImage(image: ImageSource, ...rest: number[]): void {
    this.rec('drawImage', [image, ...rest]);
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
    this.rec('createLinearGradient', [x0, y0, x1, y1]);
    return new FakeGradient();
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient {
    this.rec('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
    return new FakeGradient();
  }

  setLineDash(segments: number[]): void {
    this.rec('setLineDash', [segments]);
  }
}

function styleName(s: string | Gradient): string {
  return typeof s === 'string' ? s : '[gradient]';
}

// ---------------------------------------------------------------------------
// 假平台
// ---------------------------------------------------------------------------

export interface FakePlatformOptions {
  /** 默认 'web'。测试平台相关的分支时可以改成 'wechat' 或 'douyin' */
  name?: Platform['name'];
  width?: number;
  height?: number;
  dpr?: number;
  safeArea?: Partial<SafeArea>;
  /** 假装是支持录屏的平台（抖音）。默认没有，和微信、Web 一样 */
  recorder?: boolean;
  /** 假装是支持侧边栏的平台（抖音）。默认没有 */
  sidebar?: boolean;
}

export class FakePlatform implements Platform {
  readonly name: Platform['name'];
  readonly ctx = new FakeCanvas2D();
  readonly screen: ScreenInfo;

  // ---- 输入 ----
  private pointer: PointerHandlers | null = null;

  onPointer(handlers: PointerHandlers): void {
    this.pointer = handlers;
  }

  /** 模拟手指 */
  readonly touch = {
    down: (x: number, y: number, id = 0): void => this.need().down({ id, x, y }),
    move: (x: number, y: number, id = 0): void => this.need().move({ id, x, y }),
    up: (x: number, y: number, id = 0): void => this.need().up({ id, x, y }),
    cancel: (x: number, y: number, id = 0): void => this.need().cancel({ id, x, y }),
    /** 按下后立刻抬起 */
    tap: (x: number, y: number, id = 0): void => {
      this.touch.down(x, y, id);
      this.touch.up(x, y, id);
    },
    /** 按下，沿着 path 逐点移动，在最后一点抬起。path 至少要有两个点。 */
    drag: (path: readonly (readonly [number, number])[], id = 0): void => {
      const first = path[0];
      const last = path[path.length - 1];
      if (!first || !last || path.length < 2) throw new Error('drag 的 path 至少要有两个点');
      this.touch.down(first[0], first[1], id);
      for (const [x, y] of path.slice(1)) this.touch.move(x, y, id);
      this.touch.up(last[0], last[1], id);
    },
  };

  private need(): PointerHandlers {
    if (!this.pointer) throw new Error('游戏还没有调用 onPointer，没有人在听触摸事件');
    return this.pointer;
  }

  // ---- 时间：完全由测试推进，不会自己走 ----
  /** 假平台启动时的墙上时钟，固定值，让测试结果可重复 */
  static readonly START_EPOCH_MS = 1_700_000_000_000;
  /** 一帧的时长，和 60fps 的显示器一致 */
  static readonly FRAME_MS = 1000 / 60;

  private elapsed = 0;
  private frameIndex = 0;
  private frameCbs: ((frameTimeMs: number) => void)[] = [];

  requestFrame(cb: (frameTimeMs: number) => void): void {
    this.frameCbs.push(cb);
  }

  now(): number {
    return FakePlatform.START_EPOCH_MS + this.elapsed;
  }

  /** 登记了、还没被推进到的帧回调个数，用来检查主循环停下后没有留下新的回调 */
  get pendingFrames(): number {
    return this.frameCbs.length;
  }

  /**
   * 测试用：把时间推进 ms 毫秒。每经过一个帧点（FRAME_MS 的整数倍）就运行一次已登记的帧回调，
   * 回调里再登记的回调留到下一个帧点。没有人登记时帧点照样流逝，和真实显示器一样。
   * now() 总是精确地走过 ms。
   */
  advance(ms: number): void {
    if (!(ms >= 0)) throw new Error('advance 的毫秒数不能是负数');
    const end = this.elapsed + ms;
    for (;;) {
      const nextFrameAt = (this.frameIndex + 1) * FakePlatform.FRAME_MS;
      // 容差：时间不对齐帧点时，advance(FRAME_MS) 的终点和下一个帧点只差浮点误差，不能因此漏掉这一帧
      if (nextFrameAt > end + 1e-9) break;
      this.frameIndex++;
      this.elapsed = nextFrameAt;
      const cbs = this.frameCbs;
      this.frameCbs = [];
      for (const cb of cbs) cb(nextFrameAt);
    }
    this.elapsed = Math.max(this.elapsed, end);
  }

  // ---- 存储：存进去的东西会过一遍 JSON，和真实平台一样，取出来的是副本 ----
  private store = new Map<string, string>();

  readonly storage = {
    get: <T>(key: string, fallback: T): T => {
      const raw = this.store.get(key);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set: (key: string, value: unknown): void => {
      const raw = JSON.stringify(value);
      if (raw === undefined) throw new Error(`storage.set("${key}")：值不能被 JSON 序列化`);
      this.store.set(key, raw);
    },
  };

  /** 测试用：直接写入一段原始文本，用来模拟存档损坏 */
  setRawStorage(key: string, raw: string): void {
    this.store.set(key, raw);
  }

  // ---- 广告 ----
  readonly adLog: { kind: 'rewarded' | 'interstitial'; placement: string }[] = [];
  private rewardedQueue: boolean[] = [];

  /** 默认每次都看完。调用后，接下来的激励视频按这个顺序返回结果，用完恢复默认。 */
  queueRewardedResults(...results: boolean[]): void {
    this.rewardedQueue.push(...results);
  }

  readonly ads = {
    rewarded: (placement: RewardedPlacement): Promise<boolean> => {
      this.adLog.push({ kind: 'rewarded', placement });
      return Promise.resolve(this.rewardedQueue.shift() ?? true);
    },
    interstitial: (placement: InterstitialPlacement): Promise<void> => {
      this.adLog.push({ kind: 'interstitial', placement });
      return Promise.resolve();
    },
  };

  // ---- 分享、震动、埋点 ----
  readonly shared: SharePayload[] = [];
  readonly vibrations: ('light' | 'heavy')[] = [];
  readonly tracked: { event: string; params?: TrackParams }[] = [];

  share(payload: SharePayload): void {
    this.shared.push(payload);
  }
  vibrate(kind: 'light' | 'heavy'): void {
    this.vibrations.push(kind);
  }
  track(event: string, params?: TrackParams): void {
    this.tracked.push(params ? { event, params } : { event });
  }

  // ---- 录屏（只有 recorder 选项打开时才有） ----
  readonly recorderLog: ('start' | 'stop' | 'share')[] = [];
  /** 测试用：下一次分享录屏的结果，默认成功 */
  recorderShareResult = true;

  recorder?: NonNullable<Platform['recorder']>;

  // ---- 侧边栏（只有 sidebar 选项打开时才有） ----
  readonly sidebarLog: ('available' | 'open')[] = [];
  /** 测试用：available() 的结果，默认可用；设成 'error' 模拟平台出错 */
  sidebarAvailable: boolean | 'error' = true;

  sidebar?: NonNullable<Platform['sidebar']>;

  // ---- 前后台 ----
  private showCbs: (() => void)[] = [];
  private hideCbs: (() => void)[] = [];

  onShow(cb: () => void): void {
    this.showCbs.push(cb);
  }
  onHide(cb: () => void): void {
    this.hideCbs.push(cb);
  }
  /** 测试用：模拟回到前台 */
  show(): void {
    for (const cb of this.showCbs) cb();
  }
  /** 测试用：模拟进入后台 */
  hide(): void {
    for (const cb of this.hideCbs) cb();
  }

  constructor(opts: FakePlatformOptions = {}) {
    this.name = opts.name ?? 'web';
    if (opts.sidebar) {
      this.sidebar = {
        available: () => {
          this.sidebarLog.push('available');
          return this.sidebarAvailable === 'error' ? Promise.reject(new Error('x')) : Promise.resolve(this.sidebarAvailable);
        },
        open: () => void this.sidebarLog.push('open'),
      };
    }
    if (opts.recorder) {
      this.recorder = {
        start: () => void this.recorderLog.push('start'),
        stop: () => {
          this.recorderLog.push('stop');
          return Promise.resolve();
        },
        share: () => {
          this.recorderLog.push('share');
          return Promise.resolve(this.recorderShareResult);
        },
      };
    }
    this.screen = {
      width: opts.width ?? 375,
      height: opts.height ?? 667,
      dpr: opts.dpr ?? 2,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0, ...opts.safeArea },
    };
  }
}
