// 新手引导：玩家愣着不动的时候，画一只手演示下一步该做什么，不用文字。
//
// - drag：手从托盘里的一件物品出发，拖到它在箱子里的位置，那里先画一个半透明的预览
// - rotate：手点在一件需要转的物品上，点两下，每下荡开一圈涟漪
//
// 什么时候出现：玩家一直没碰屏幕超过 GUIDE_IDLE_MS，演示循环播放；玩家一碰屏幕（点、拖）就立刻消失，
// 再愣一会儿才会重新出现。玩家做了这个动作（拖过、转过）之后由场景撤掉，这一关不再出现。
// 演示的东西全按当前局面挑：每一帧重新挑，所以玩家摆了几件之后，演示的是还没摆的那一件。
import type { Game } from '../core/game.ts';
import { easing } from '../engine/tween.ts';
import type { Platform } from '../platform/types.ts';
import type { Layout } from './layout.ts';
import { drawPieceGhost } from './pieceView.ts';
import { EMOJI_FONT, theme } from './theme.ts';

export type GuideKind = 'drag' | 'rotate';

/** 玩家这么久（毫秒）没碰屏幕，才开始演示 */
export const GUIDE_IDLE_MS = 1500;

// 一轮演示的时间线（毫秒）。最后留一段空白，不要一直在屏幕上晃
const DRAG = { fadeIn: 250, press: 400, arrive: 1300, hold: 1900, fadeOut: 2200, loop: 3200 } as const;
const ROTATE = { fadeIn: 250, tap1: 500, tap2: 1200, ripple: 500, fadeOut: 1900, loop: 2900 } as const;

const FINGER_EMOJI = '👆';
const GHOST_ALPHA = 0.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** drag 演示在 t 毫秒（一轮里的时刻）时：手的透明度、手走了全程的几分之几、预览亮不亮 */
export function dragPose(t: number): { alpha: number; move: number; ghost: number } {
  const alpha = t < DRAG.fadeIn ? t / DRAG.fadeIn : t < DRAG.hold ? 1 : clamp01(1 - (t - DRAG.hold) / (DRAG.fadeOut - DRAG.hold));
  const move = easing.easeInOutQuad(clamp01((t - DRAG.press) / (DRAG.arrive - DRAG.press)));
  // 手快到的时候预览亮起来，手离开时一起暗下去
  const ghost = t < DRAG.arrive - 300 ? 0 : t < DRAG.hold ? 1 : clamp01(1 - (t - DRAG.hold) / (DRAG.fadeOut - DRAG.hold));
  return { alpha: clamp01(alpha), move, ghost };
}

/** rotate 演示在 t 毫秒时：手的透明度、手按下去的程度、两圈涟漪各自的进度（还没开始或已经散了是 -1） */
export function rotatePose(t: number): { alpha: number; press: number; ripples: [number, number] } {
  const alpha = t < ROTATE.fadeIn ? t / ROTATE.fadeIn : t < ROTATE.tap2 + ROTATE.ripple ? 1 : clamp01(1 - (t - (ROTATE.tap2 + ROTATE.ripple)) / (ROTATE.fadeOut - ROTATE.tap2 - ROTATE.ripple));
  const ripple = (start: number): number => (t >= start && t < start + ROTATE.ripple ? (t - start) / ROTATE.ripple : -1);
  // 每次点的前 120ms 手按下去，之后抬起
  const press = (start: number): number => (t >= start - 120 && t < start + 120 ? 1 - Math.abs(t - start) / 120 : 0);
  return {
    alpha: clamp01(alpha),
    press: Math.max(press(ROTATE.tap1), press(ROTATE.tap2)),
    ripples: [ripple(ROTATE.tap1), ripple(ROTATE.tap2)],
  };
}

export class Guide {
  readonly kind: GuideKind;
  private readonly platform: Pick<Platform, 'ctx'>;
  private readonly layout: Layout;
  private readonly game: Game;
  private idle = 0;

  constructor(platform: Pick<Platform, 'ctx'>, layout: Layout, game: Game, kind: GuideKind) {
    this.platform = platform;
    this.layout = layout;
    this.game = game;
    this.kind = kind;
  }

  /** 玩家碰了屏幕：演示立刻消失，重新等 */
  touch(): void {
    this.idle = 0;
  }

  update(dtMs: number): void {
    this.idle += dtMs;
  }

  /** 现在正在演示（画面上有手） */
  get playing(): boolean {
    return this.idle >= GUIDE_IDLE_MS;
  }

  render(): void {
    if (!this.playing) return;
    const loop = this.kind === 'drag' ? DRAG.loop : ROTATE.loop;
    const t = (this.idle - GUIDE_IDLE_MS) % loop;
    if (this.kind === 'drag') this.renderDrag(t);
    else this.renderRotate(t);
  }

  // -------------------------------------------------------------------------

  private slotCenter(id: number): { x: number; y: number } | null {
    const slot = this.layout.tray.slots[id];
    return slot ? { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 } : null;
  }

  private renderDrag(t: number): void {
    // 托盘里第一件"朝向已经对、答案的位置也空着"的物品
    const { board } = this.layout;
    for (const p of this.game.pieces) {
      if (p.pos) continue;
      const sol = this.game.level.pieces[p.id]?.solution;
      const o = p.item.orients[sol?.oi ?? 0];
      const from = this.slotCenter(p.id);
      if (!sol || !o || !from || p.oi !== sol.oi || !this.game.canPlace(p.id, sol.oi, sol.r, sol.c)) continue;

      const pose = dragPose(t);
      const to = { x: board.grid.x + (sol.c + o.w / 2) * board.cell, y: board.grid.y + (sol.r + o.h / 2) * board.cell };
      const { ctx } = this.platform;
      if (pose.ghost > 0) {
        drawPieceGhost(ctx, p, board.grid.x + sol.c * board.cell, board.grid.y + sol.r * board.cell, board.cell, GHOST_ALPHA * pose.ghost);
      }
      this.drawFinger(from.x + (to.x - from.x) * pose.move, from.y + (to.y - from.y) * pose.move, pose.alpha, t >= DRAG.press && t < DRAG.hold ? 1 : 0);
      return;
    }
  }

  private renderRotate(t: number): void {
    // 托盘里第一件"现在的朝向和答案不同"、并且转得出别的形状的物品
    if (!this.game.level.rotate) return;
    for (const p of this.game.pieces) {
      if (p.pos || p.item.orients.length < 2) continue;
      const sol = this.game.level.pieces[p.id]?.solution;
      const at = this.slotCenter(p.id);
      if (!sol || !at || p.oi === sol.oi) continue;

      const pose = rotatePose(t);
      const { ctx } = this.platform;
      pose.ripples.forEach((r) => {
        if (r < 0) return;
        ctx.save();
        ctx.globalAlpha = (1 - r) * 0.9;
        ctx.strokeStyle = theme.guideRipple;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 12 + 26 * r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      this.drawFinger(at.x, at.y, pose.alpha, pose.press);
      return;
    }
  }

  /** 一只手：指尖在 (x, y)。press 是按下的程度 0～1，按下时触点的圈收小 */
  private drawFinger(x: number, y: number, alpha: number, press: number): void {
    const { ctx } = this.platform;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, 18 - 5 * press, 0, Math.PI * 2);
    ctx.fillStyle = theme.guideDot;
    ctx.fill();
    ctx.font = `34px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    // 👆 的指尖在字形的上方：往下挪，让指尖正好点在 (x, y)
    ctx.fillText(FINGER_EMOJI, x + 3, y + 18 + 3 * press);
    ctx.restore();
  }
}
