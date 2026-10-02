// 一局游戏的画面：背景、行李牌、箱子、托盘、按钮。现在只读 Game 的状态来画，不处理输入（3.1 起加）。
import type { Game } from '../core/game.ts';
import { fillRoundRect, roundRectPath, strokeRoundRect } from '../engine/draw.ts';
import type { Platform } from '../platform/types.ts';
import { computeLayout, type Layout, type Rect } from './layout.ts';
import { drawPiece } from './pieceView.ts';
import { EMOJI_FONT, FONT, theme } from './theme.ts';

export class PlayScene {
  private readonly platform: Pick<Platform, 'ctx' | 'screen'>;
  readonly game: Game;
  readonly layout: Layout;

  constructor(platform: Pick<Platform, 'ctx' | 'screen'>, game: Game) {
    this.platform = platform;
    this.game = game;
    this.layout = computeLayout(platform.screen, game.level);
  }

  render(): void {
    const { ctx } = this.platform;
    this.drawBackground();
    this.drawHeader(ctx);
    this.drawTip(ctx);
    this.drawBoard(ctx);
    this.drawTray(ctx);
    this.drawButtons(ctx);
  }

  private drawBackground(): void {
    const { ctx, screen } = this.platform;
    const g = ctx.createLinearGradient(0, 0, 0, screen.height);
    g.addColorStop(0, theme.backgroundTop);
    g.addColorStop(1, theme.backgroundBottom);
    ctx.fillStyle = g;
    // 每帧整屏重画，不需要 clearRect
    ctx.fillRect(0, 0, screen.width, screen.height);
  }

  /** 行李牌：左边一个挂绳孔，目的地三字码和城市，右边是第几关 */
  private drawHeader(ctx: Platform['ctx']): void {
    const { header: h } = this.layout;
    const { level } = this.game;

    ctx.save();
    ctx.shadowColor = 'rgba(74, 55, 40, 0.18)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    fillRoundRect(ctx, h.x, h.y, h.w, h.h, 14, theme.tagFill);
    ctx.restore();

    // 左边一条强调色带
    ctx.save();
    roundRectPath(ctx, h.x, h.y, h.w, h.h, 14);
    ctx.clip();
    ctx.fillStyle = theme.tagAccent;
    ctx.fillRect(h.x, h.y, 8, h.h);
    ctx.restore();

    // 挂绳孔
    ctx.beginPath();
    ctx.arc(h.x + 26, h.y + h.h / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = theme.tagHole;
    ctx.fill();
    ctx.strokeStyle = theme.tagHoleRing;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.ink;
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(level.dest.code, h.x + 46, h.y + h.h / 2 - 1);
    const codeW = ctx.measureText(level.dest.code).width;
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = theme.inkSoft;
    ctx.fillText(level.dest.city, h.x + 46 + codeW + 10, h.y + h.h / 2 + 3);

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.tagAccent;
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(`第 ${level.n} 关`, h.x + h.w - 16, h.y + h.h / 2);
  }

  private drawTip(ctx: Platform['ctx']): void {
    const { tip } = this.layout;
    if (!tip || !this.game.level.tip) return;
    ctx.fillStyle = theme.inkSoft;
    ctx.font = `14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.game.level.tip, tip.x + tip.w / 2, tip.y + tip.h / 2, tip.w);
  }

  private drawBoard(ctx: Platform['ctx']): void {
    const { frame, handle, grid, cell } = this.layout.board;
    const { level } = this.game;

    // 提手在外壳后面，只露出上半截
    fillRoundRect(ctx, handle.x, handle.y, handle.w, handle.h + 6, 5, theme.suitcaseHandle);

    ctx.save();
    ctx.shadowColor = 'rgba(47, 85, 122, 0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    fillRoundRect(ctx, frame.x, frame.y, frame.w, frame.h, cell * 0.35, theme.suitcase);
    ctx.restore();
    strokeRoundRect(ctx, frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2, cell * 0.35, theme.suitcaseDark, 2);

    const gap = Math.max(1, cell * 0.04);
    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const x = grid.x + c * cell + gap;
        const y = grid.y + r * cell + gap;
        const size = cell - 2 * gap;
        if (this.game.isBlocked(r, c)) {
          fillRoundRect(ctx, x, y, size, size, cell * 0.16, theme.blocked);
          // 拉杆槽：中间一条深色的槽
          fillRoundRect(ctx, x + size * 0.3, y + size * 0.12, size * 0.4, size * 0.76, size * 0.2, theme.blockedDark);
        } else {
          fillRoundRect(ctx, x, y, size, size, cell * 0.16, theme.slot);
        }
      }
    }

    for (const p of this.game.pieces) {
      if (p.pos) drawPiece(ctx, p, grid.x + p.pos.c * cell, grid.y + p.pos.r * cell, cell);
    }
  }

  private drawTray(ctx: Platform['ctx']): void {
    const { panel, slots, cell } = this.layout.tray;
    fillRoundRect(ctx, panel.x, panel.y, panel.w, panel.h, 16, theme.trayFill);
    strokeRoundRect(ctx, panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1, 16, theme.trayLine, 1.5);

    for (const p of this.game.pieces) {
      const slot = slots[p.id] as Rect;
      if (p.pos) {
        // 已经在箱子里：留一个浅浅的虚线框，托盘里别的物品不会因此换位置
        ctx.save();
        ctx.setLineDash([4, 4]);
        strokeRoundRect(ctx, slot.x, slot.y, slot.w, slot.h, cell * 0.25, theme.trayLine, 1.5);
        ctx.restore();
        continue;
      }
      const o = p.item.orients[p.oi];
      if (!o) continue;
      // 在自己的正方形位置里居中
      drawPiece(ctx, p, slot.x + (slot.w - o.w * cell) / 2, slot.y + (slot.h - o.h * cell) / 2, cell);
    }
  }

  private drawButtons(ctx: Platform['ctx']): void {
    const { restart, hint, skip } = this.layout.buttons;
    this.drawButton(ctx, restart, '🔄', '重来', theme.buttonFree, false);
    this.drawButton(ctx, hint, '💡', '提示', theme.buttonHint, true);
    this.drawButton(ctx, skip, '⏭', '跳关', theme.buttonSkip, true);
  }

  private drawButton(ctx: Platform['ctx'], r: Rect, icon: string, label: string, fill: string, ad: boolean): void {
    ctx.save();
    ctx.shadowColor = 'rgba(74, 55, 40, 0.22)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2, fill);
    ctx.restore();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.ink;
    ctx.font = `bold 16px ${FONT}`;
    const labelW = ctx.measureText(label).width;
    const iconSize = 18;
    const total = iconSize + 6 + labelW;
    const left = r.x + (r.w - total) / 2;
    ctx.font = `${iconSize}px ${EMOJI_FONT}`;
    ctx.fillText(icon, left + iconSize / 2, r.y + r.h / 2);
    ctx.font = `bold 16px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, left + iconSize + 6, r.y + r.h / 2);

    if (ad) {
      // 角标：要看广告才能用
      const bx = r.x + r.w - 10;
      const by = r.y + 4;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fillStyle = theme.adBadge;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('广告', bx, by + 0.5, 16);
    }
  }
}
