// 输入识别：把平台给的按下 / 移动 / 抬起，识别成"点击"和"拖动"。
import type { PointerHandlers } from '../platform/types.ts';

/** 手指移动不到这个距离（CSS 像素）还算"没动"。手指按下时总会有些抖动，太小会把点击误判成拖动。 */
export const TAP_MAX_MOVE_PX = 10;
/** 按下到抬起超过这个时间（毫秒）的不算点击，长按不触发任何东西。 */
export const TAP_MAX_MS = 500;

export interface DragEvent {
  /** 手指当前位置 */
  readonly x: number;
  readonly y: number;
  /** 手指最初按下的位置：要拖哪件物品，用它做命中判断 */
  readonly startX: number;
  readonly startY: number;
}

export interface GestureHandlers {
  /** 位置取手指按下的点，也就是玩家瞄准的那个点 */
  tap(x: number, y: number): void;
  /** 位移刚超过阈值时触发一次，x、y 是此刻手指的位置 */
  dragStart(e: DragEvent): void;
  dragMove(e: DragEvent): void;
  dragEnd(e: DragEvent): void;
  /** 系统打断了触摸（来电、手势冲突），或同一根手指又收到一次按下。调用方应当把东西退回原位。 */
  dragCancel(): void;
}

/**
 * 返回可以直接交给 platform.onPointer 的处理器。
 * 同一时间只跟踪一根手指，先按下的那根；别的手指的事件全部忽略，所以双指不会把拖动搅乱。
 * now 用来量按下到抬起的时间，传 platform.now。
 */
export function createGestureRecognizer(now: () => number, handlers: GestureHandlers): PointerHandlers {
  let id: number | null = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let dragging = false;

  const event = (x: number, y: number): DragEvent => ({ x, y, startX, startY });
  const reset = (): void => {
    id = null;
    dragging = false;
  };

  return {
    down(p) {
      if (id !== null) {
        if (id !== p.id) return;
        // 同一根手指又按下，说明漏了抬起事件：先把上一段拖动收掉
        if (dragging) handlers.dragCancel();
      }
      id = p.id;
      startX = p.x;
      startY = p.y;
      startTime = now();
      dragging = false;
    },
    move(p) {
      if (p.id !== id) return;
      if (!dragging) {
        const dx = p.x - startX;
        const dy = p.y - startY;
        if (dx * dx + dy * dy < TAP_MAX_MOVE_PX * TAP_MAX_MOVE_PX) return;
        dragging = true;
        handlers.dragStart(event(p.x, p.y));
        return;
      }
      handlers.dragMove(event(p.x, p.y));
    },
    up(p) {
      if (p.id !== id) return;
      const wasDragging = dragging;
      const heldMs = now() - startTime;
      reset();
      if (wasDragging) handlers.dragEnd(event(p.x, p.y));
      // 时钟被回拨时 heldMs 为负，当作很短，仍然算点击
      else if (heldMs <= TAP_MAX_MS) handlers.tap(startX, startY);
    },
    cancel(p) {
      if (p.id !== id) return;
      const wasDragging = dragging;
      reset();
      if (wasDragging) handlers.dragCancel();
    },
  };
}
