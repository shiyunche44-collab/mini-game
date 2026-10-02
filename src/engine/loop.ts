// 主循环：每帧先 update 再 render，切到后台就停，回来接着跑。
import type { Platform } from '../platform/types.ts';

/** 单帧 dt 的上限。切后台回来、时钟异常时不让动画一步跳很远。 */
export const MAX_DT_MS = 100;

export interface LoopHandlers {
  /** dtMs：距上一帧的毫秒数，已夹在 0～MAX_DT_MS 之间 */
  update(dtMs: number): void;
  render(): void;
}

export class Loop {
  private readonly platform: Pick<Platform, 'requestFrame' | 'onShow' | 'onHide'>;
  private readonly handlers: LoopHandlers;
  /** 调用方想不想让它跑（start / stop） */
  private wanted = false;
  /** 现在在不在前台 */
  private visible = true;
  /**
   * 每次启动或停下都换一个编号。平台没有取消帧回调的接口，
   * 已经挂出去的旧回调靠编号对不上来自己退出，避免 stop 再 start 后同时跑两条链。
   */
  private generation = 0;
  private chainAlive = false;
  private lastFrameTime: number | null = null;

  constructor(platform: Pick<Platform, 'requestFrame' | 'onShow' | 'onHide'>, handlers: LoopHandlers) {
    this.platform = platform;
    this.handlers = handlers;
    // 平台的前后台回调没有注销接口，所以只在构造时注册一次，之后靠 visible 标志控制
    platform.onHide(() => {
      this.visible = false;
      this.sync();
    });
    platform.onShow(() => {
      this.visible = true;
      this.sync();
    });
  }

  start(): void {
    this.wanted = true;
    this.sync();
  }

  stop(): void {
    this.wanted = false;
    this.sync();
  }

  get running(): boolean {
    return this.chainAlive;
  }

  private sync(): void {
    const shouldRun = this.wanted && this.visible;
    if (shouldRun === this.chainAlive) return;
    this.generation++;
    this.chainAlive = shouldRun;
    // 暂停期间的时间不算：恢复后的第一帧 dt 为 0
    this.lastFrameTime = null;
    if (shouldRun) this.schedule(this.generation);
  }

  private schedule(generation: number): void {
    this.platform.requestFrame((frameTime) => {
      if (generation !== this.generation) return;
      // 先挂下一帧再跑逻辑：某一帧的逻辑抛了异常，循环也不会就此死掉
      this.schedule(generation);
      const last = this.lastFrameTime;
      this.lastFrameTime = frameTime;
      const dt = last === null ? 0 : Math.min(Math.max(frameTime - last, 0), MAX_DT_MS);
      this.handlers.update(dt);
      // update 里可能调了 stop，这一帧就不画了
      if (generation === this.generation) this.handlers.render();
    });
  }
}
