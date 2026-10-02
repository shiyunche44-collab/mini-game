// 一局游戏的画面和拖动交互：背景、行李牌、箱子、托盘、按钮；把物品从托盘拖进箱子。
//
// 拖动的规则：
// - 手指按在物品上拖动，物品放大到箱子里的大小、抬高（影子加上移），跟着手指走
// - 拖到箱子上方、有放得下的位置时，在那个位置画一个半透明的预览（吸附）
// - 松手：有吸附位置就落进去；没有就飞回去。从托盘拿起的回托盘，从箱子里拿起的回原来的位置；
//   从箱子里拿起、松手在托盘上的，退回托盘
// - 拖动期间 Game 的状态不动，松手那一刻才改，所以拖到一半被打断（来电、系统手势）什么都不会丢
//
// 点按旋转：点中物品（托盘里和箱子里都行）顺时针转 90°。转得动就播一段转过去的动画；
// 箱子里周围没空位转不开，物品左右抖一下，让玩家知道点到了、只是转不了。
import type { Game } from '../core/game.ts';
import { fillRoundRect, roundRectPath, strokeRoundRect } from '../engine/draw.ts';
import type { DragEvent, GestureHandlers } from '../engine/input.ts';
import { easing, Tweens, wave, type TweenHandle } from '../engine/tween.ts';
import type { Platform } from '../platform/types.ts';
import { boardCellAt, computeLayout, contains, type Layout, type Rect } from './layout.ts';
import { drawPiece, drawPieceGhost } from './pieceView.ts';
import { findSnap, type Snap } from './snap.ts';
import { EMOJI_FONT, FONT, theme } from './theme.ts';

/** 手指拿着物品时，物品比手指高出多少（单位：箱子里的格）：不然手指把物品遮住了，看不见要放哪 */
export const LIFT_CELLS = 0.7;
/** 拿起来的影子有多深（单位：箱子里的格） */
const SHADOW_CELLS = 0.3;
const PICKUP_MS = 110;
const DROP_MS = 130;
const RETURN_MS = 240;
const GHOST_ALPHA = 0.5;
const SPIN_MS = 190;
const SHAKE_MS = 300;
/** 抖动的来回次数，幅度（单位：格）。抖得太大会盖到旁边的物品 */
const SHAKE_CYCLES = 3;
export const SHAKE_CELLS = 0.12;

/** 正被手指拿着的物品 */
interface Dragged {
  readonly id: number;
  /** 从箱子里拿起的：原来的位置；从托盘拿起的是 null */
  readonly from: Snap | null;
  /** 抓住物品的哪一点，占物品外框宽、高的比例。物品放大时这一点始终在手指下面 */
  readonly fx: number;
  readonly fy: number;
  /** 拿起来之前，物品一格有多大 */
  readonly fromCell: number;
  /** 手指现在的位置 */
  x: number;
  y: number;
  /** 拿起的进度 0～1：大小、抬高、影子都跟着它变 */
  t: number;
  snap: Snap | null;
}

/** 正在飞向落点的物品（落进箱子，或者飞回去）。x、y 是它外框的左上角，k 是一格多大 */
interface Flight {
  x: number;
  y: number;
  k: number;
  lift: number;
}

/** 正在转的物品：angle 是它离最终朝向还差多少弧度，从 -90° 走到 0 */
interface Spin {
  angle: number;
  handle: TweenHandle | null;
}

/** 正在抖的物品：dx 是它现在偏离原位多少像素 */
interface Shake {
  dx: number;
  handle: TweenHandle | null;
}

export class PlayScene implements GestureHandlers {
  private readonly platform: Pick<Platform, 'ctx' | 'screen'>;
  readonly game: Game;
  readonly layout: Layout;
  private readonly tweens = new Tweens();
  private dragged: Dragged | null = null;
  private pickup: { cancel(): void } | null = null;
  private readonly flights = new Map<number, Flight>();
  private readonly spins = new Map<number, Spin>();
  private readonly shakes = new Map<number, Shake>();

  constructor(platform: Pick<Platform, 'ctx' | 'screen'>, game: Game) {
    this.platform = platform;
    this.game = game;
    this.layout = computeLayout(platform.screen, game.level);
  }

  /** 推进动画。dtMs 是主循环给的帧间隔 */
  update(dtMs: number): void {
    this.tweens.update(dtMs);
  }

  render(): void {
    const { ctx } = this.platform;
    // 被拿着的、正在飞的物品不在原位置画：它们由下面单独画
    const away = new Set<number>(this.flights.keys());
    if (this.dragged) away.add(this.dragged.id);

    this.drawBackground();
    this.drawHeader(ctx);
    this.drawTip(ctx);
    this.drawBoard(ctx, away);
    this.drawTray(ctx, away);
    this.drawButtons(ctx);
    this.drawGhost(ctx);
    for (const [id, f] of this.flights) this.drawPieceAt(ctx, id, f.x, f.y, f.k, f.lift);
    if (this.dragged) this.drawDragged(ctx, this.dragged);
  }

  // -------------------------------------------------------------------------
  // 手势
  // -------------------------------------------------------------------------

  tap(x: number, y: number): void {
    if (this.dragged) return;
    const id = this.pieceAtPoint(x, y);
    const piece = id === null ? undefined : this.game.pieces[id];
    if (id === null || !piece) return;
    // 这一关不让转，或者怎么转都是同一个形状（2×2 的书）：没什么可转的，不给反馈
    if (!this.game.level.rotate || piece.item.orients.length < 2) return;
    if (this.game.rotate(id)) this.startSpin(id);
    else this.startShake(id);
  }

  dragStart(e: DragEvent): void {
    this.dropDragged(null); // 上一次拖动没收尾（不该发生）就先收掉
    const id = this.pieceAtPoint(e.startX, e.startY);
    if (id === null) return;
    const piece = this.game.pieces[id];
    const o = piece?.item.orients[piece.oi];
    if (!piece || !o) return;

    const { board, tray } = this.layout;
    const from = piece.pos ? { r: piece.pos.r, c: piece.pos.c } : null;
    // 拿起之前还在转或抖的，不再播了：拿起之后由拖动的画法接管
    this.spins.get(id)?.handle?.cancel();
    this.spins.delete(id);
    this.shakes.get(id)?.handle?.cancel();
    this.shakes.delete(id);
    const fromCell = from ? board.cell : tray.cell;
    const origin = from
      ? { x: board.grid.x + from.c * board.cell, y: board.grid.y + from.r * board.cell }
      : this.trayOrigin(id);
    // 托盘里按的可能是物品位置里的空白处，所以把抓的点限制在物品的外框里
    const fx = clamp01((e.startX - origin.x) / (o.w * fromCell));
    const fy = clamp01((e.startY - origin.y) / (o.h * fromCell));

    const d: Dragged = { id, from, fx, fy, fromCell, x: e.x, y: e.y, t: from ? 1 : 0, snap: null };
    d.snap = this.snapFor(d);
    this.dragged = d;
    this.pickup = from ? null : this.tweens.animate(d, { t: 1 }, { duration: PICKUP_MS, ease: easing.easeOutQuad });
  }

  dragMove(e: DragEvent): void {
    const d = this.dragged;
    if (!d) return;
    d.x = e.x;
    d.y = e.y;
    d.snap = this.snapFor(d);
  }

  dragEnd(e: DragEvent): void {
    const d = this.dragged;
    if (!d) return;
    d.x = e.x;
    d.y = e.y;
    d.snap = this.snapFor(d);
    this.dropDragged(contains(this.layout.tray.panel, e.x, e.y) ? 'tray' : 'board');
  }

  dragCancel(): void {
    this.dropDragged(null);
  }

  /**
   * 手指松开，决定物品去哪。where 是松手的地方；null 表示被打断，直接飞回去。
   * 状态在这里才改。
   */
  private dropDragged(where: 'board' | 'tray' | null): void {
    const d = this.dragged;
    if (!d) return;
    this.dragged = null;
    this.pickup?.cancel();
    this.pickup = null;

    const { board, tray } = this.layout;
    const k = this.dragCell(d);
    const start = this.dragOrigin(d, k);
    const flight: Flight = { x: start.x, y: start.y, k, lift: this.dragLift(d) };

    let target: { x: number; y: number; k: number };
    let ms = RETURN_MS;
    if (where !== null && d.snap && this.game.place(d.id, d.snap.r, d.snap.c)) {
      target = { x: board.grid.x + d.snap.c * board.cell, y: board.grid.y + d.snap.r * board.cell, k: board.cell };
      ms = DROP_MS;
    } else if (where === 'tray' && d.from) {
      this.game.remove(d.id);
      target = { ...this.trayOrigin(d.id), k: tray.cell };
    } else if (d.from) {
      target = { x: board.grid.x + d.from.c * board.cell, y: board.grid.y + d.from.r * board.cell, k: board.cell };
    } else {
      target = { ...this.trayOrigin(d.id), k: tray.cell };
    }

    this.flights.set(d.id, flight);
    this.tweens.animate(flight, { ...target, lift: 0 }, {
      duration: ms,
      ease: easing.easeOutCubic,
      onComplete: () => void this.flights.delete(d.id),
    });
  }

  // -------------------------------------------------------------------------
  // 旋转和抖动
  // -------------------------------------------------------------------------

  /**
   * 状态已经转好了，画面补一段转过去的动画：把转好之后的物品倒着转 90° 画出来，再转回 0。
   * 连点时接着当前的角度继续转，不会跳回开头。
   */
  private startSpin(id: number): void {
    const prev = this.spins.get(id);
    prev?.handle?.cancel();
    const spin: Spin = { angle: (prev?.angle ?? 0) - Math.PI / 2, handle: null };
    this.spins.set(id, spin);
    spin.handle = this.tweens.animate(spin, { angle: 0 }, {
      duration: SPIN_MS,
      ease: easing.easeOutBack, // 转过头一点再回正，有"咔哒"落位的感觉
      onComplete: () => {
        if (this.spins.get(id) === spin) this.spins.delete(id);
      },
    });
  }

  private startShake(id: number): void {
    this.shakes.get(id)?.handle?.cancel();
    const shake: Shake = { dx: 0, handle: null };
    this.shakes.set(id, shake);
    const amp = this.layout.board.cell * SHAKE_CELLS;
    shake.handle = this.tweens.add({
      duration: SHAKE_MS,
      onUpdate: (p) => {
        shake.dx = amp * (1 - p) * wave(p, SHAKE_CYCLES);
      },
      onComplete: () => {
        if (this.shakes.get(id) === shake) this.shakes.delete(id);
      },
    });
  }

  /** 画一件停在托盘或箱子里的物品，带上它正在播的转动和抖动 */
  private drawResting(ctx: Platform['ctx'], id: number, x: number, y: number, cell: number): void {
    const piece = this.game.pieces[id];
    if (!piece) return;
    const spin = this.spins.get(id);
    const shake = this.shakes.get(id);
    if (!spin && !shake) {
      drawPiece(ctx, piece, x, y, cell);
      return;
    }
    const o = piece.item.orients[piece.oi];
    ctx.save();
    if (shake) ctx.translate(shake.dx, 0);
    if (spin && o) {
      // 绕外框的中心转
      const cx = x + (o.w * cell) / 2;
      const cy = y + (o.h * cell) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(spin.angle);
      ctx.translate(-cx, -cy);
    }
    drawPiece(ctx, piece, x, y, cell);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 拖动的几何
  // -------------------------------------------------------------------------

  /** 屏幕上这个点按住的是哪件物品：箱子里的按格子找，托盘里的按它的位置找。正在飞的碰不到 */
  private pieceAtPoint(x: number, y: number): number | null {
    const cell = boardCellAt(this.layout, x, y);
    if (cell) {
      const id = this.game.pieceAt(cell.r, cell.c);
      return id !== null && !this.flights.has(id) ? id : null;
    }
    for (const p of this.game.pieces) {
      const slot = this.layout.tray.slots[p.id];
      if (!p.pos && slot && !this.flights.has(p.id) && contains(slot, x, y)) return p.id;
    }
    return null;
  }

  /** 物品在托盘里时外框左上角在哪（在自己的正方形位置里居中） */
  private trayOrigin(id: number): { x: number; y: number } {
    const piece = this.game.pieces[id];
    const o = piece?.item.orients[piece.oi];
    const slot = this.layout.tray.slots[id];
    if (!o || !slot) return { x: 0, y: 0 };
    const t = this.layout.tray.cell;
    return { x: slot.x + (slot.w - o.w * t) / 2, y: slot.y + (slot.h - o.h * t) / 2 };
  }

  /** 拿起时一格有多大：从原来的大小渐渐放大到箱子里的大小 */
  private dragCell(d: Dragged): number {
    return d.fromCell + (this.layout.board.cell - d.fromCell) * d.t;
  }

  private dragLift(d: Dragged): number {
    return SHADOW_CELLS * this.layout.board.cell * d.t;
  }

  /** 物品外框的左上角：抓的那一点在手指上方一点 */
  private dragOrigin(d: Dragged, k: number): { x: number; y: number } {
    const o = this.game.pieces[d.id]?.item.orients[this.game.pieces[d.id]?.oi ?? 0];
    if (!o) return { x: d.x, y: d.y };
    return {
      x: d.x - d.fx * o.w * k,
      y: d.y - d.fy * o.h * k - LIFT_CELLS * this.layout.board.cell * d.t,
    };
  }

  /**
   * 现在松手会落在哪。按拿起完成之后的大小和高度算，不按动画中间的值算，
   * 这样手很快时（还没放大完就松手）结果也一样。
   */
  private snapFor(d: Dragged): Snap | null {
    const { board } = this.layout;
    const full = { ...d, t: 1 };
    const origin = this.dragOrigin(full, board.cell);
    return findSnap(this.game, d.id, (origin.y - board.grid.y) / board.cell, (origin.x - board.grid.x) / board.cell);
  }

  // -------------------------------------------------------------------------
  // 画被拿着的物品
  // -------------------------------------------------------------------------

  private drawPieceAt(ctx: Platform['ctx'], id: number, x: number, y: number, k: number, lift: number): void {
    const piece = this.game.pieces[id];
    if (piece) drawPiece(ctx, piece, x, y, k, lift);
  }

  private drawDragged(ctx: Platform['ctx'], d: Dragged): void {
    const k = this.dragCell(d);
    const o = this.dragOrigin(d, k);
    this.drawPieceAt(ctx, d.id, o.x, o.y, k, this.dragLift(d));
  }

  /** 吸附预览：在会落下的位置画一个半透明的物品 */
  private drawGhost(ctx: Platform['ctx']): void {
    const d = this.dragged;
    const piece = d && this.game.pieces[d.id];
    if (!d?.snap || !piece) return;
    const { board } = this.layout;
    drawPieceGhost(ctx, piece, board.grid.x + d.snap.c * board.cell, board.grid.y + d.snap.r * board.cell, board.cell, GHOST_ALPHA);
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

  private drawBoard(ctx: Platform['ctx'], away: ReadonlySet<number>): void {
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
      if (p.pos && !away.has(p.id)) this.drawResting(ctx, p.id, grid.x + p.pos.c * cell, grid.y + p.pos.r * cell, cell);
    }
  }

  private drawTray(ctx: Platform['ctx'], away: ReadonlySet<number>): void {
    const { panel, slots, cell } = this.layout.tray;
    fillRoundRect(ctx, panel.x, panel.y, panel.w, panel.h, 16, theme.trayFill);
    strokeRoundRect(ctx, panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1, 16, theme.trayLine, 1.5);

    for (const p of this.game.pieces) {
      const slot = slots[p.id] as Rect;
      if (p.pos || away.has(p.id)) {
        // 已经在箱子里、或者被拿走了：留一个浅浅的虚线框，托盘里别的物品不会因此换位置
        ctx.save();
        ctx.setLineDash([4, 4]);
        strokeRoundRect(ctx, slot.x, slot.y, slot.w, slot.h, cell * 0.25, theme.trayLine, 1.5);
        ctx.restore();
        continue;
      }
      const o = p.item.orients[p.oi];
      if (!o) continue;
      // 在自己的正方形位置里居中
      this.drawResting(ctx, p.id, slot.x + (slot.w - o.w * cell) / 2, slot.y + (slot.h - o.h * cell) / 2, cell);
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

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
