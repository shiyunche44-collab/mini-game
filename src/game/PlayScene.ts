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
import { Guide, type GuideKind } from './Guide.ts';
import { boardCellAt, computeLayout, contains, type Layout, type Rect } from './layout.ts';
import type { ItemIcons } from './icons.ts';
import { drawPiece, drawPieceGhost, drawPieceGlow } from './pieceView.ts';
import { findSnap, type Snap } from './snap.ts';
import type { SoundName } from './sounds.ts';
import { EMOJI_FONT, FONT, theme } from './theme.ts';

/** 手指拿着物品时，物品比手指高出多少（单位：箱子里的格）：不然手指把物品遮住了，看不见要放哪 */
export const LIFT_CELLS = 0.7;
/** 拿起来的影子有多深（单位：箱子里的格） */
const SHADOW_CELLS = 0.3;
const PICKUP_MS = 110;
const DROP_MS = 130;
const RETURN_MS = 240;
const GHOST_ALPHA = 0.5;
const HINT_MS = 220;
const SPIN_MS = 190;
const SHAKE_MS = 300;
/** 抖动的来回次数，幅度（单位：格）。抖得太大会盖到旁边的物品 */
const SHAKE_CYCLES = 3;
export const SHAKE_CELLS = 0.12;
/** 点按钮时按钮缩下去再弹回来：缩到原来的多少，一共多久 */
export const PRESS_SCALE = 0.92;
const PRESS_MS = 160;
/** 提示摆好的物品落稳后闪一下：让玩家知道"就是这件"。闪的时间要比提示飞过去的 220ms 长，不然一闪而过 */
const GLOW_MS = 900;
const GLOW_PULSES = 2;

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

/** 场景把"局面变了"告诉外面（存档、结算）。场景自己不碰存档和广告 */
export interface SceneEvents {
  /** 摆放、取出、旋转之后，局面和之前不一样了 */
  change(): void;
  /** 最后一件物品也装进去了。这时不再发 change，外面直接收尾 */
  complete(): void;
  /** 点了底部的按钮。重来的事场景自己做不了主（要不要问广告、存档），所以都交给外面决定 */
  button(kind: ButtonKind): void;
  /** 玩家做了引导在演示的动作（拖过、转过）：外面记下来，以后的关卡不用再演示 */
  taught?(kind: GuideKind): void;
  /** 要播一个音效。场景不管静音和平台，只说播哪个 */
  sound?(name: SoundName): void;
  /** 现在是不是静音（画标题栏里的开关用） */
  muted?(): boolean;
  /** 点了标题栏里的静音开关 */
  toggleSound?(): void;
}

export type ButtonKind = 'restart' | 'hint' | 'skip';

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

/** 被按下的按钮：s 是按下的程度 0～1，0 是原样，1 是缩得最小 */
interface Press {
  s: number;
}

/** 提示摆好的物品身上的光：a 是亮度 0～1，从亮到暗 */
interface Glow {
  a: number;
}

export class PlayScene implements GestureHandlers {
  private readonly platform: Pick<Platform, 'ctx' | 'screen'>;
  readonly game: Game;
  readonly layout: Layout;
  private readonly events: SceneEvents | undefined;
  private readonly tweens = new Tweens();
  private dragged: Dragged | null = null;
  private pickup: { cancel(): void } | null = null;
  private readonly flights = new Map<number, Flight>();
  private readonly spins = new Map<number, Spin>();
  private readonly shakes = new Map<number, Shake>();
  private readonly presses = new Map<ButtonKind, Press>();
  private readonly glows = new Map<number, Glow>();
  /** 新手引导：玩家愣着不动时演示下一步。玩家做过这个动作就撤掉，这一关不再出现 */
  private guide: Guide | null;
  /** 物品图标，没有就画 emoji */
  private readonly icons: ItemIcons | undefined;

  constructor(
    platform: Pick<Platform, 'ctx' | 'screen'>,
    game: Game,
    events?: SceneEvents,
    guide: GuideKind | null = null,
    icons?: ItemIcons,
  ) {
    this.icons = icons;
    this.platform = platform;
    this.game = game;
    this.events = events;
    this.layout = computeLayout(platform.screen, game.level);
    this.guide = guide ? new Guide(platform, this.layout, game, guide, icons) : null;
  }

  /** 推进动画。dtMs 是主循环给的帧间隔 */
  update(dtMs: number): void {
    this.tweens.update(dtMs);
    this.guide?.update(dtMs);
  }

  /** 引导现在是不是正在演示（测试用） */
  get guiding(): GuideKind | null {
    return this.guide?.playing ? this.guide.kind : null;
  }

  private learn(kind: GuideKind): void {
    this.events?.taught?.(kind);
    if (this.guide?.kind === kind) this.guide = null;
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
    // 东西在飞、在拖的时候不演示：手和真的物品一起动会乱
    else if (this.flights.size === 0 && !this.game.isComplete()) this.guide?.render();
  }

  // -------------------------------------------------------------------------
  // 手势
  // -------------------------------------------------------------------------

  tap(x: number, y: number): void {
    if (this.dragged) return;
    this.guide?.touch();
    if (contains(this.layout.sound, x, y)) {
      this.events?.toggleSound?.();
      return;
    }
    const kind = this.buttonAt(x, y);
    if (kind) {
      this.events?.sound?.('tap');
      this.events?.button(kind);
      // 放在通知之后：重来会清掉所有动画，先开始的话按钮的回弹也被一起清掉了
      this.startPress(kind);
      return;
    }
    const id = this.pieceAtPoint(x, y);
    const piece = id === null ? undefined : this.game.pieces[id];
    if (id === null || !piece) return;
    // 这一关不让转，或者怎么转都是同一个形状（2×2 的书）：没什么可转的，不给反馈
    if (!this.game.level.rotate || piece.item.orients.length < 2) return;
    if (this.game.rotate(id)) {
      this.learn('rotate');
      this.events?.sound?.('rotate');
      this.glows.delete(id); // 转过之后光的形状就不对了
      this.startSpin(id);
      this.events?.change();
    } else {
      this.events?.sound?.('nope');
      this.startShake(id);
    }
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
    this.glows.delete(id);
    const fromCell = from ? board.cell : tray.cell;
    const origin = from
      ? { x: board.grid.x + from.c * board.cell, y: board.grid.y + from.r * board.cell }
      : this.trayOrigin(id);
    // 托盘里按的可能是物品位置里的空白处，所以把抓的点限制在物品的外框里
    const fx = clamp01((e.startX - origin.x) / (o.w * fromCell));
    const fy = clamp01((e.startY - origin.y) / (o.h * fromCell));

    this.learn('drag');
    this.events?.sound?.('pickup');
    const d: Dragged = { id, from, fx, fy, fromCell, x: e.x, y: e.y, t: from ? 1 : 0, snap: null };
    d.snap = this.snapFor(d);
    this.dragged = d;
    this.pickup = from ? null : this.tweens.animate(d, { t: 1 }, { duration: PICKUP_MS, ease: easing.easeOutQuad });
  }

  dragMove(e: DragEvent): void {
    const d = this.dragged;
    if (!d) return;
    this.guide?.touch();
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
    const from = { x: start.x, y: start.y, k, lift: this.dragLift(d) };

    let target: { x: number; y: number; k: number };
    let ms = RETURN_MS;
    let changed = false;
    if (where !== null && d.snap && this.game.place(d.id, d.snap.r, d.snap.c)) {
      target = { x: board.grid.x + d.snap.c * board.cell, y: board.grid.y + d.snap.r * board.cell, k: board.cell };
      ms = DROP_MS;
      changed = true;
      this.events?.sound?.('drop');
    } else if (where === 'tray' && d.from) {
      this.game.remove(d.id);
      changed = true;
      target = { ...this.trayOrigin(d.id), k: tray.cell };
      this.events?.sound?.('back');
    } else if (d.from) {
      target = { x: board.grid.x + d.from.c * board.cell, y: board.grid.y + d.from.r * board.cell, k: board.cell };
      if (where !== null) this.events?.sound?.('back');
    } else {
      target = { ...this.trayOrigin(d.id), k: tray.cell };
      if (where !== null) this.events?.sound?.('back');
    }
    this.fly(d.id, from, target, ms);

    if (changed) {
      if (this.game.isComplete()) this.events?.complete();
      else this.events?.change();
    }
  }

  // -------------------------------------------------------------------------
  // 按钮：重来、提示
  // -------------------------------------------------------------------------

  private buttonAt(x: number, y: number): ButtonKind | null {
    const { buttons } = this.layout;
    if (contains(buttons.restart, x, y)) return 'restart';
    if (contains(buttons.hint, x, y)) return 'hint';
    if (contains(buttons.skip, x, y)) return 'skip';
    return null;
  }

  /**
   * 重来：箱子里的物品全部飞回托盘。朝向和提示次数保留（见 Game.reset）。
   * 箱子里本来就是空的，什么都没变，不通知外面（不然白白存一次档）。
   */
  restart(): void {
    this.guide?.touch();
    const moved = this.game.pieces.filter((p) => p.pos).map((p) => ({ id: p.id, from: this.geometry(p.id) }));
    this.clearAnimations();
    this.game.reset();
    for (const m of moved) this.fly(m.id, { ...m.from, lift: 0 }, this.trayGeometry(m.id), RETURN_MS);
    if (moved.length > 0) this.events?.change();
  }

  /**
   * 提示：按答案摆好一件物品。摆好的那件从原来的地方飞过去，被它挤开的飞回托盘。
   * 返回有没有摆（所有物品都摆对了就没有可摆的）。
   */
  applyHint(): boolean {
    this.guide?.touch();
    const before = new Map(this.game.pieces.map((p) => [p.id, this.geometry(p.id)]));
    const result = this.game.hint();
    if (!result) return false;
    this.clearAnimations();

    const { board } = this.layout;
    const placed = this.game.pieces[result.id];
    const o = placed?.item.orients[placed.oi];
    const origin = before.get(result.id);
    if (placed?.pos && o && origin) {
      // 提示可能把物品转到答案的朝向：起点按旧位置的中心、新朝向的大小算，这样不会在起跳时突然换形状
      const from = { x: origin.cx - (o.w * origin.k) / 2, y: origin.cy - (o.h * origin.k) / 2, k: origin.k, lift: 0 };
      const id = result.id;
      this.fly(id, from, { x: board.grid.x + placed.pos.c * board.cell, y: board.grid.y + placed.pos.r * board.cell, k: board.cell }, HINT_MS, () => this.startGlow(id));
    }
    for (const id of result.kicked) {
      const o2 = before.get(id);
      const kicked = this.game.pieces[id]?.item.orients[this.game.pieces[id]?.oi ?? 0];
      if (!o2 || !kicked) continue;
      this.fly(id, { x: o2.cx - (kicked.w * o2.k) / 2, y: o2.cy - (kicked.h * o2.k) / 2, k: o2.k, lift: 0 }, this.trayGeometry(id), RETURN_MS);
    }

    if (this.game.isComplete()) this.events?.complete();
    else this.events?.change();
    return true;
  }

  /** 物品现在的中心和一格多大：在箱子里按箱子算，在托盘里按托盘算 */
  private geometry(id: number): { cx: number; cy: number; k: number; x: number; y: number } {
    const piece = this.game.pieces[id];
    const o = piece?.item.orients[piece.oi];
    const { board, tray } = this.layout;
    if (!piece || !o) return { cx: 0, cy: 0, k: tray.cell, x: 0, y: 0 };
    const k = piece.pos ? board.cell : tray.cell;
    const o0 = piece.pos
      ? { x: board.grid.x + piece.pos.c * board.cell, y: board.grid.y + piece.pos.r * board.cell }
      : this.trayOrigin(id);
    return { cx: o0.x + (o.w * k) / 2, cy: o0.y + (o.h * k) / 2, k, x: o0.x, y: o0.y };
  }

  /** 物品回到托盘时的位置和大小（按现在的朝向） */
  private trayGeometry(id: number): { x: number; y: number; k: number } {
    return { ...this.trayOrigin(id), k: this.layout.tray.cell };
  }

  /** 让物品从 from 飞到 target。飞的时候它不在原来的地方画，飞完才算落下 */
  private fly(
    id: number,
    from: { x: number; y: number; k: number; lift: number },
    target: { x: number; y: number; k: number },
    ms: number,
    onLand?: () => void,
  ): void {
    this.spins.get(id)?.handle?.cancel();
    this.spins.delete(id);
    this.shakes.get(id)?.handle?.cancel();
    this.shakes.delete(id);
    const flight: Flight = { ...from };
    this.flights.set(id, flight);
    this.tweens.animate(flight, { ...target, lift: 0 }, {
      duration: ms,
      ease: easing.easeOutCubic,
      onComplete: () => {
        this.flights.delete(id);
        onLand?.();
      },
    });
  }

  /** 状态要整个换掉（重来、提示）时，先停掉正在播的动画，免得旧的动画落在新的状态上 */
  private clearAnimations(): void {
    this.tweens.cancelAll();
    this.flights.clear();
    this.spins.clear();
    this.shakes.clear();
    this.presses.clear();
    this.glows.clear();
    this.dragged = null;
    this.pickup = null;
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

  /** 按钮缩下去再弹回来。连点时从头再来 */
  private startPress(kind: ButtonKind): void {
    const press: Press = { s: 0 };
    this.presses.set(kind, press);
    this.tweens.add({
      duration: PRESS_MS,
      onUpdate: (p) => {
        // 前 40% 缩下去，后 60% 弹回来
        press.s = p < 0.4 ? p / 0.4 : (1 - p) / 0.6;
      },
      onComplete: () => {
        if (this.presses.get(kind) === press) this.presses.delete(kind);
      },
    });
  }

  /** 物品落进答案的位置之后，在它身上闪两下光再暗下去 */
  private startGlow(id: number): void {
    this.events?.sound?.('hint');
    const glow: Glow = { a: 1 };
    this.glows.set(id, glow);
    this.tweens.add({
      duration: GLOW_MS,
      onUpdate: (p) => {
        glow.a = (1 - p) * (0.65 + 0.35 * wave(p, GLOW_PULSES));
      },
      onComplete: () => {
        if (this.glows.get(id) === glow) this.glows.delete(id);
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
      drawPiece(ctx, piece, x, y, cell, 0, this.icons);
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
    drawPiece(ctx, piece, x, y, cell, 0, this.icons);
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
    if (piece) drawPiece(ctx, piece, x, y, k, lift, this.icons);
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
    drawPieceGhost(ctx, piece, board.grid.x + d.snap.c * board.cell, board.grid.y + d.snap.r * board.cell, board.cell, GHOST_ALPHA, this.icons);
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

    // 右端：静音开关；"第 N 关"在它左边。城市名放不下时压窄（fillText 的最大宽度）
    const { sound } = this.layout;
    const levelText = `第 ${level.n} 关`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.tagAccent;
    ctx.font = `bold 18px ${FONT}`;
    const levelRight = sound.x - 8;
    ctx.fillText(levelText, levelRight, h.y + h.h / 2);
    const levelLeft = levelRight - ctx.measureText(levelText).width;

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.ink;
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(level.dest.code, h.x + 46, h.y + h.h / 2 - 1);
    const codeW = ctx.measureText(level.dest.code).width;
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = theme.inkSoft;
    const cityX = h.x + 46 + codeW + 10;
    ctx.fillText(level.dest.city, cityX, h.y + h.h / 2 + 3, Math.max(0, levelLeft - 8 - cityX));

    this.drawSoundButton(ctx, sound);
  }

  /** 静音开关：浅色圆底加喇叭 emoji，静音时是划掉的喇叭 */
  private drawSoundButton(ctx: Platform['ctx'], r: Rect): void {
    const muted = this.events?.muted?.() ?? false;
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = muted ? theme.soundOff : theme.soundOn;
    ctx.fill();
    ctx.font = `18px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(muted ? '🔇' : '🔊', r.x + r.w / 2, r.y + r.h / 2 + 1);
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
    for (const [id, glow] of this.glows) {
      const p = this.game.pieces[id];
      if (p?.pos && !away.has(id)) drawPieceGlow(ctx, p, grid.x + p.pos.c * cell, grid.y + p.pos.r * cell, cell, glow.a, theme.hintGlow);
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
    this.drawButton(ctx, restart, '🔄', '重来', theme.buttonFree, false, this.presses.get('restart')?.s ?? 0);
    this.drawButton(ctx, hint, '💡', '提示', theme.buttonHint, true, this.presses.get('hint')?.s ?? 0);
    this.drawButton(ctx, skip, '⏭', '跳关', theme.buttonSkip, true, this.presses.get('skip')?.s ?? 0);
  }

  /** pressed：按下的程度 0～1。按下去按钮缩小、影子变浅，像被按进桌面 */
  private drawButton(ctx: Platform['ctx'], r: Rect, icon: string, label: string, fill: string, ad: boolean, pressed: number): void {
    ctx.save();
    if (pressed > 0) {
      const k = 1 - (1 - PRESS_SCALE) * pressed;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }
    // 影子只给底色，文字和角标不带影子
    ctx.save();
    ctx.shadowColor = 'rgba(74, 55, 40, 0.22)';
    ctx.shadowBlur = 6 * (1 - 0.6 * pressed);
    ctx.shadowOffsetY = 3 * (1 - 0.6 * pressed);
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
    ctx.restore();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
