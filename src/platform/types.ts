// 游戏层和引擎层能用到的全部平台能力都在这个文件里。
// 这里不允许引用 DOM 或 wx / tt 的类型，所有类型都自己声明。

// ---------------------------------------------------------------------------
// 画布：Canvas2D 子集
// ---------------------------------------------------------------------------
// 只包含微信、抖音和浏览器都支持的方法。故意没有的：
//   roundRect、ellipse、filter、letterSpacing、fontKerning、direction、createPattern、
//   getTransform、isPointInPath、OffscreenCanvas。
// 圆角矩形用 arcTo 自己画（engine/draw.ts）。
// src/platform/canvas-compat.check.ts 在编译期保证这个子集是浏览器 Canvas 的子集。

/** 图片。具体是什么对象由各平台决定，游戏层只会把它交给 drawImage。 */
export interface ImageSource {
  readonly width: number;
  readonly height: number;
}

export interface Gradient {
  addColorStop(offset: number, color: string): void;
}

export interface TextMetrics2D {
  readonly width: number;
}

export interface Canvas2D {
  // 状态
  save(): void;
  restore(): void;

  // 变换
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  // 路径
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;

  // 矩形
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;

  // 文字
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): TextMetrics2D;

  // 图片
  drawImage(image: ImageSource, dx: number, dy: number): void;
  drawImage(image: ImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: ImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;

  // 渐变
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient;

  // 虚线
  setLineDash(segments: number[]): void;

  // 样式
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'round' | 'miter';
  globalAlpha: number;
  font: string;
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

/** 坐标已经换算成 CSS 像素，原点在画布左上角。id 用来区分多根手指，鼠标恒为 0。 */
export interface PointerPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface PointerHandlers {
  down(p: PointerPoint): void;
  move(p: PointerPoint): void;
  up(p: PointerPoint): void;
  cancel(p: PointerPoint): void;
}

// ---------------------------------------------------------------------------
// 屏幕
// ---------------------------------------------------------------------------

export interface SafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ScreenInfo {
  /** CSS 像素 */
  readonly width: number;
  readonly height: number;
  /** 设备像素比。画布的实际像素是 width * dpr，ctx 已按 dpr 缩放好，游戏层只用 CSS 像素。 */
  readonly dpr: number;
  /** 四边需要避开的距离（刘海、底部横条），CSS 像素 */
  readonly safeArea: SafeArea;
}

// ---------------------------------------------------------------------------
// 广告、分享、埋点
// ---------------------------------------------------------------------------

export type RewardedPlacement = 'hint' | 'skip';
export type InterstitialPlacement = 'between_levels';

export interface SharePayload {
  readonly title: string;
  /** 分享出去的链接带的参数，例如 'from=share&level=12' */
  readonly query?: string;
}

export type TrackParams = Readonly<Record<string, string | number | boolean>>;

// ---------------------------------------------------------------------------
// 音效（ADR 0005）：游戏层给出音符，平台负责发声
// ---------------------------------------------------------------------------

/** 一个音符：从 start 毫秒开始，持续 duration 毫秒，音高从 freq（赫兹）滑到 endFreq（不写就不滑） */
export interface Tone {
  readonly freq: number;
  readonly endFreq?: number;
  readonly start: number;
  readonly duration: number;
  /** 音量 0～1 */
  readonly gain: number;
  readonly wave: 'sine' | 'triangle' | 'square';
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export interface Platform {
  readonly name: 'web' | 'wechat' | 'douyin';
  readonly ctx: Canvas2D;
  readonly screen: ScreenInfo;

  onPointer(handlers: PointerHandlers): void;

  /**
   * 下一帧回调，只触发一次。参数是单调递增的毫秒数，只用来算帧间隔，不能存档。
   * 没有取消接口：想停下的一方自己设标志，回调到点后直接返回（ADR 0004）。
   */
  requestFrame(cb: (frameTimeMs: number) => void): void;
  /** 墙上时钟（epoch 毫秒）。要存档、要跨次启动比较的时间用它；算动画别用，它可能被用户改动。 */
  now(): number;

  readonly storage: {
    /** 没有这个 key，或者读出来的数据坏了，都返回 fallback。value 必须能被 JSON 序列化。 */
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
  };

  readonly ads: {
    /** 玩家完整看完才返回 true；中途关闭、加载失败、没有广告都返回 false，不会抛异常。 */
    rewarded(placement: RewardedPlacement): Promise<boolean>;
    /** 展示结束（或没展示成功）后返回，不会抛异常。 */
    interstitial(placement: InterstitialPlacement): Promise<void>;
  };

  readonly audio: {
    /** 同时播放一组音符。没有声音能力、被系统静音、出任何错都不抛异常，当作没播。 */
    play(tones: readonly Tone[]): void;
  };

  share(payload: SharePayload): void;
  vibrate(kind: 'light' | 'heavy'): void;
  /** 回到前台、进入后台。回调可以注册多次。 */
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  track(event: string, params?: TrackParams): void;

  /** 只有抖音有 */
  readonly recorder?: {
    start(): void;
    stop(): Promise<void>;
    share(): Promise<boolean>;
  };
  /** 只有抖音有 */
  readonly sidebar?: {
    available(): Promise<boolean>;
    open(): void;
  };
}
