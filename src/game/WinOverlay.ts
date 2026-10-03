// 过关画面：箱盖合上 → 盖章 → 登机牌升起，登机牌上的"下一站"按钮进入下一关。
//
// 时间线（毫秒）：先等最后一件物品落稳，再合盖，盖章和合盖的尾巴重叠，最后升起登机牌。
// 玩家着急的话，登机牌出来之前点一下屏幕就直接跳到最后；登机牌出来之后才响应"下一站"，
// 免得玩家连点着最后一件物品时误触，一下子跳过了结算。
import type { Level } from '../core/levels.ts';
import { fillRoundRect, roundRectPath, strokeRoundRect } from '../engine/draw.ts';
import { easing, Tweens } from '../engine/tween.ts';
import type { Platform } from '../platform/types.ts';
import { contains, type Layout, type Rect } from './layout.ts';
import { EMOJI_FONT, FONT, theme } from './theme.ts';

const SETTLE_MS = 220;
const LID_MS = 420;
const STAMP_DELAY_MS = SETTLE_MS + LID_MS - 80;
const STAMP_MS = 260;
const CARD_DELAY_MS = STAMP_DELAY_MS + STAMP_MS + 380;
const CARD_MS = 420;

/** 按钮上的字 */
export const NEXT_LABEL = '下一站';
export const SHARE_LABEL = '分享给朋友';
export const VIDEO_LABEL = '分享录屏';

const CARD_H = 404;
/** 分享按钮这一行：在条形码下面、"下一站"上面 */
const SHARE_ROW_Y = 282;
const SHARE_ROW_H = 40;
const SHARE_GAP = 12;
const CARD_MAX_W = 360;

/** 登机牌上要写的内容 */
export interface WinInfo {
  readonly level: Level;
  /** 这一局用了几次提示 */
  readonly hintsUsed: number;
}

/** 登机牌上的按钮点了要做什么 */
export interface WinActions {
  next(): void;
  share(): void;
  /** 只有平台支持录屏时才有；没有就不画"分享录屏"按钮 */
  shareVideo?: () => void;
}

/** 各个动画的进度，都是 0 → 1（有的缓动会短暂超过 1）。tween 改它们，render 读它们。 */
interface Progress {
  lid: number;
  stamp: number;
  card: number;
}

export class WinOverlay {
  private readonly platform: Pick<Platform, 'ctx' | 'screen'>;
  private readonly layout: Layout;
  private readonly info: WinInfo;
  private readonly actions: WinActions;
  private readonly tweens = new Tweens();
  private readonly p: Progress = { lid: 0, stamp: 0, card: 0 };
  private used = false;
  /** 登机牌已经完全出来，可以点"下一站"了 */
  private ready = false;

  constructor(
    platform: Pick<Platform, 'ctx' | 'screen'>,
    layout: Layout,
    info: WinInfo,
    actions: WinActions,
  ) {
    this.platform = platform;
    this.layout = layout;
    this.info = info;
    this.actions = actions;
    this.tweens.animate(this.p, { lid: 1 }, { delay: SETTLE_MS, duration: LID_MS, ease: easing.easeOutCubic });
    this.tweens.animate(this.p, { stamp: 1 }, { delay: STAMP_DELAY_MS, duration: STAMP_MS, ease: easing.easeOutBack });
    this.tweens.animate(this.p, { card: 1 }, {
      delay: CARD_DELAY_MS,
      duration: CARD_MS,
      ease: easing.easeOutCubic,
      onComplete: () => this.finish(),
    });
  }

  /** 登机牌是不是已经完全出来了（测试和 Session 用） */
  get isReady(): boolean {
    return this.ready;
  }

  update(dtMs: number): void {
    this.tweens.update(dtMs);
  }

  /** 点一下：动画没放完就直接跳到最后；放完了，点在"下一站"上就进下一关 */
  tap(x: number, y: number): void {
    if (!this.ready) {
      this.tweens.cancelAll();
      this.p.lid = 1;
      this.p.stamp = 1;
      this.p.card = 1;
      this.finish();
      return;
    }
    if (this.used) return;
    if (contains(this.buttonRect(), x, y)) {
      this.used = true;
      this.actions.next();
      return;
    }
    // 分享可以点很多次，不影响进下一关
    const { share, video } = this.shareRects();
    if (contains(share, x, y)) this.actions.share();
    else if (video && this.actions.shareVideo && contains(video, x, y)) this.actions.shareVideo();
  }

  private finish(): void {
    this.ready = true;
  }

  // -------------------------------------------------------------------------
  // 画
  // -------------------------------------------------------------------------

  render(): void {
    const { ctx } = this.platform;
    this.drawLid(ctx);
    this.drawStamp(ctx);
    this.drawPass(ctx);
  }

  /** 箱盖从上面合下来，只在箱子外壳里可见 */
  private drawLid(ctx: Platform['ctx']): void {
    if (this.p.lid <= 0) return;
    const f = this.layout.board.frame;
    const radius = this.layout.board.cell * 0.35;
    const y = f.y - f.h * (1 - Math.min(this.p.lid, 1));

    ctx.save();
    roundRectPath(ctx, f.x, f.y, f.w, f.h, radius);
    ctx.clip();
    ctx.fillStyle = theme.lid;
    ctx.fillRect(f.x, y, f.w, f.h);
    // 两条箱带
    ctx.fillStyle = theme.lidStrap;
    ctx.fillRect(f.x + f.w * 0.2, y, f.w * 0.07, f.h);
    ctx.fillRect(f.x + f.w * 0.73, y, f.w * 0.07, f.h);
    // 下沿的厚边，合上的那一刻有"咔"的感觉
    ctx.fillRect(f.x, y + f.h - 8, f.w, 8);
    // 中间的锁扣
    const lw = Math.min(f.w * 0.2, 56);
    const lh = lw * 0.8;
    fillRoundRect(ctx, f.x + f.w / 2 - lw / 2, y + f.h / 2 - lh / 2, lw, lh, lw * 0.18, theme.lidLatchDark);
    fillRoundRect(ctx, f.x + f.w / 2 - lw / 2 + 2, y + f.h / 2 - lh / 2 + 1, lw - 4, lh - 5, lw * 0.16, theme.lidLatch);
    ctx.beginPath();
    ctx.arc(f.x + f.w / 2, y + f.h / 2 - lh * 0.05, lw * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = theme.lidLatchDark;
    ctx.fill();
    ctx.restore();
  }

  /** "已装箱"印章：从大一圈、透明的样子压下来，压过头一点再弹回 */
  private drawStamp(ctx: Platform['ctx']): void {
    const t = this.p.stamp;
    if (t <= 0) return;
    const f = this.layout.board.frame;
    const scale = 1 + (1 - t) * 1.2;
    const w = Math.min(f.w * 0.78, 220);
    const h = w * 0.42;

    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.5);
    ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
    ctx.rotate(-0.21);
    ctx.scale(scale, scale);
    strokeRoundRect(ctx, -w / 2, -h / 2, w, h, h * 0.18, theme.stamp, 5);
    strokeRoundRect(ctx, -w / 2 + 9, -h / 2 + 9, w - 18, h - 18, h * 0.1, theme.stamp, 1.5);
    ctx.fillStyle = theme.stamp;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.42)}px ${FONT}`;
    ctx.fillText('已装箱', 0, -h * 0.06, w - 24);
    ctx.font = `bold ${Math.round(h * 0.17)}px ${FONT}`;
    ctx.fillText('PACKED', 0, h * 0.28, w - 24);
    ctx.restore();
  }

  private cardRect(): Rect {
    return winCardRect(this.layout, this.platform.screen.height);
  }

  private buttonRect(): Rect {
    return winButtonRect(this.layout, this.platform.screen.height);
  }

  private shareRects(): { share: Rect; video: Rect | null } {
    return winShareRects(this.layout, this.platform.screen.height, this.actions.shareVideo !== undefined);
  }

  private drawPass(ctx: Platform['ctx']): void {
    const t = Math.min(this.p.card, 1);
    if (t <= 0) return;
    const { screen } = this.platform;
    const c = this.cardRect();
    const { level, hintsUsed } = this.info;

    // 暗幕
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = theme.dim;
    ctx.fillRect(0, 0, screen.width, screen.height);
    ctx.restore();

    // 登机牌从下面升起：按过冲后的进度算位置
    const dy = (1 - this.p.card) * (screen.height - c.y) * 0.6;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, dy);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    fillRoundRect(ctx, c.x, c.y, c.w, c.h, 18, theme.passPaper);
    ctx.restore();

    // 顶部色带
    ctx.save();
    roundRectPath(ctx, c.x, c.y, c.w, c.h, 18);
    ctx.clip();
    ctx.fillStyle = theme.passBand;
    ctx.fillRect(c.x, c.y, c.w, 44);
    ctx.restore();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText('登机牌  BOARDING PASS', c.x + 20, c.y + 23);
    ctx.textAlign = 'right';
    ctx.fillText(`第 ${level.n} 关`, c.x + c.w - 20, c.y + 23);

    // 出发 → 到达
    const midY = c.y + 100;
    this.drawPlace(ctx, c.x + 20, midY, '出发 FROM', level.dest.code, level.dest.city, 'left');
    this.drawPlace(ctx, c.x + c.w - 20, midY, '到达 TO', level.next.code, level.next.city, 'right');
    ctx.textAlign = 'center';
    ctx.font = `28px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000000';
    ctx.fillText('✈️', c.x + c.w / 2, midY + 2);

    // 三格信息
    const cells: [string, string][] = [
      ['行李', `${level.pieces.length} 件`],
      ['提示', hintsUsed === 0 ? '没用提示' : `${hintsUsed} 次`],
      ['登机口', gate(level.n)],
    ];
    const cw = (c.w - 40) / 3;
    cells.forEach(([label, value], i) => {
      const cx = c.x + 20 + cw * i + cw / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.inkSoft;
      ctx.font = `12px ${FONT}`;
      ctx.fillText(label, cx, c.y + 176);
      ctx.fillStyle = theme.ink;
      ctx.font = `bold 17px ${FONT}`;
      ctx.fillText(value, cx, c.y + 198, cw - 6);
    });

    // 撕口和条形码
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = theme.trayLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x + 14, c.y + 222);
    ctx.lineTo(c.x + c.w - 14, c.y + 222);
    ctx.stroke();
    ctx.restore();
    this.drawBarcode(ctx, c.x + 20, c.y + 236, c.w - 40, 28, level.n);

    // 分享：次要按钮，描边不填色，免得抢了"下一站"的风头
    const { share, video } = this.shareRects();
    this.drawOutlineButton(ctx, share, '📤', SHARE_LABEL);
    if (video) this.drawOutlineButton(ctx, video, '🎬', VIDEO_LABEL);

    // 下一站
    const b = this.buttonRect();
    ctx.save();
    ctx.shadowColor = 'rgba(74, 55, 40, 0.28)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    fillRoundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2, theme.passBand);
    ctx.restore();
    // 文字和 emoji 用不同的字体，分开画：✈ 用文字字体画出来是个黑白的小符号
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 20px ${FONT}`;
    const labelW = ctx.measureText(NEXT_LABEL).width;
    const left = b.x + (b.w - labelW - 8 - 22) / 2;
    ctx.textAlign = 'left';
    ctx.fillText(NEXT_LABEL, left, b.y + b.h / 2 + 1);
    ctx.font = `22px ${EMOJI_FONT}`;
    ctx.fillText('✈️', left + labelW + 8, b.y + b.h / 2 + 1);

    ctx.restore();
  }

  private drawOutlineButton(ctx: Platform['ctx'], r: Rect, emoji: string, label: string): void {
    strokeRoundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2, theme.passBand, 2);
    // 文字和 emoji 分开画，原因同"下一站"
    ctx.fillStyle = theme.passBand;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `bold 16px ${FONT}`;
    const labelW = ctx.measureText(label).width;
    const left = r.x + (r.w - 20 - 6 - labelW) / 2;
    ctx.font = `18px ${EMOJI_FONT}`;
    ctx.fillText(emoji, left, r.y + r.h / 2 + 1);
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText(label, left + 20 + 6, r.y + r.h / 2 + 1);
  }

  private drawPlace(
    ctx: Platform['ctx'],
    x: number,
    y: number,
    label: string,
    code: string,
    city: string,
    align: 'left' | 'right',
  ): void {
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.inkSoft;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(label, x, y - 34);
    ctx.fillStyle = theme.ink;
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText(code, x, y);
    ctx.fillStyle = theme.inkSoft;
    ctx.font = `15px ${FONT}`;
    ctx.fillText(city, x, y + 32);
  }

  /** 装饰用的条形码：粗细由关卡号算出来，同一关每次画的一样，不用随机数 */
  private drawBarcode(ctx: Platform['ctx'], x: number, y: number, w: number, h: number, n: number): void {
    ctx.fillStyle = theme.ink;
    let cx = x;
    let i = 0;
    while (cx < x + w) {
      const bar = 1 + ((n * 7 + i * 5) % 4);
      const gap = 1 + ((n * 3 + i * 11) % 3);
      ctx.fillRect(cx, y, Math.min(bar, x + w - cx), h);
      cx += bar + gap + 1;
      i++;
    }
  }
}

/** 登机口：关卡号算出来的字母加数字，只是装饰 */
export function gate(n: number): string {
  return `${String.fromCharCode(65 + (n % 6))}${1 + ((n * 7) % 30)}`;
}

/** 登机牌的位置：在内容区里垂直居中，屏幕太矮时贴着内容区顶部 */
export function winCardRect(layout: Layout, screenHeight: number): Rect {
  const { content } = layout;
  const w = Math.min(content.w, CARD_MAX_W);
  const y = Math.max(content.y, content.y + (content.h - CARD_H) / 2);
  return { x: content.x + (content.w - w) / 2, y: Math.min(y, screenHeight - CARD_H), w, h: CARD_H };
}

/** "下一站"按钮，在登机牌最下面 */
export function winButtonRect(layout: Layout, screenHeight: number): Rect {
  const c = winCardRect(layout, screenHeight);
  return { x: c.x + 20, y: c.y + CARD_H - 64, w: c.w - 40, h: 48 };
}

/** 分享按钮：一排。支持录屏时左右各一个，否则只有"分享给朋友"，占满一排 */
export function winShareRects(
  layout: Layout,
  screenHeight: number,
  hasVideo: boolean,
): { share: Rect; video: Rect | null } {
  const c = winCardRect(layout, screenHeight);
  const x = c.x + 20;
  const y = c.y + SHARE_ROW_Y;
  const w = c.w - 40;
  if (!hasVideo) return { share: { x, y, w, h: SHARE_ROW_H }, video: null };
  const half = (w - SHARE_GAP) / 2;
  return {
    share: { x, y, w: half, h: SHARE_ROW_H },
    video: { x: x + half + SHARE_GAP, y, w: half, h: SHARE_ROW_H },
  };
}
