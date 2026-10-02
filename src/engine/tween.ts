// 补间：在一段时间内把进度从 0 推到 1，由主循环每帧用 dt 驱动。
//
// 缓动函数只用加减乘除：和 core 一样不碰 Math.sin、Math.pow 这类各设备结果可能略有差异的函数，
// 这样同一段动画在所有平台上逐帧一致，测试也能精确比较。

/** 输入输出都在 0～1：t=0 返回 0，t=1 返回 1 */
export type Easing = (t: number) => number;

export const easing = {
  linear: ((t) => t) as Easing,
  easeInQuad: ((t) => t * t) as Easing,
  easeOutQuad: ((t) => t * (2 - t)) as Easing,
  easeInOutQuad: ((t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t))) as Easing,
  easeOutCubic: ((t) => {
    const u = 1 - t;
    return 1 - u * u * u;
  }) as Easing,
  /** 冲过头再回来，用于放进箱子时的"落位"手感 */
  easeOutBack: ((t) => {
    const c1 = 1.70158;
    const u = t - 1;
    return 1 + (c1 + 1) * u * u * u + c1 * u * u;
  }) as Easing,
};

export interface TweenOptions {
  /** 毫秒，≤ 0 表示下一次 update 就结束 */
  duration: number;
  /** 开始前的等待，毫秒，默认 0 */
  delay?: number;
  /** 默认 easing.linear */
  ease?: Easing;
  /** 参数是缓动之后的进度（easeOutBack 这类会短暂超出 0～1）。结束那次一定是 ease(1)。 */
  onUpdate: (progress: number) => void;
  /** 自然结束时调用一次；被 cancel 的不会调用 */
  onComplete?: () => void;
}

export interface TweenHandle {
  cancel(): void;
  readonly active: boolean;
}

interface Entry {
  readonly opts: TweenOptions;
  readonly ease: Easing;
  elapsed: number;
  active: boolean;
}

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

export class Tweens {
  private entries: Entry[] = [];

  /** 还没结束的补间个数 */
  get count(): number {
    return this.entries.length;
  }

  add(opts: TweenOptions): TweenHandle {
    const entry: Entry = { opts, ease: opts.ease ?? easing.linear, elapsed: -(opts.delay ?? 0), active: true };
    this.entries.push(entry);
    return {
      cancel: () => {
        entry.active = false;
      },
      get active() {
        return entry.active;
      },
    };
  }

  /** 把 target 上的数值属性从当前值渐变到 to 里给的值。起点在补间真正开始（delay 之后）时取，所以可以排队接力。 */
  animate<T extends object>(
    target: T,
    to: Partial<Record<NumericKeys<T>, number>>,
    opts: Omit<TweenOptions, 'onUpdate'> & { onUpdate?: (progress: number) => void },
  ): TweenHandle {
    const bag = target as Record<string, number>;
    const goals = Object.entries(to) as [string, number][];
    let starts: number[] | null = null;
    return this.add({
      ...opts,
      onUpdate: (p) => {
        if (!starts) starts = goals.map(([key]) => bag[key] ?? 0);
        const origin = starts;
        goals.forEach(([key, goal], i) => {
          const from = origin[i] ?? 0;
          bag[key] = from + (goal - from) * p;
        });
        opts.onUpdate?.(p);
      },
    });
  }

  /** 推进 dtMs 毫秒。回调里新加的补间从下一次 update 才开始计时。 */
  update(dtMs: number): void {
    // 遍历副本：回调里 add 的补间不在副本里，下一次 update 才会计时
    for (const e of this.entries.slice()) {
      if (!e.active) continue;
      e.elapsed += dtMs;
      if (e.elapsed < 0) continue; // 还在 delay 里
      const { duration } = e.opts;
      const done = e.elapsed >= duration;
      e.opts.onUpdate(e.ease(done ? 1 : e.elapsed / duration));
      if (done && e.active) {
        e.active = false;
        e.opts.onComplete?.();
      }
    }
    // 剔除跑完和被取消的（回调里新加的补间还活着，会留下）
    this.entries = this.entries.filter((e) => e.active);
  }

  cancelAll(): void {
    for (const e of this.entries) e.active = false;
    this.entries = [];
  }
}
