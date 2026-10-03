// 布局：根据屏幕和关卡算出每样东西画在哪。纯函数，没有画图也没有状态，所以能在各种屏幕尺寸下直接测。
//
// 竖屏手机是主场景：内容占满宽度。桌面浏览器是调试用的，内容限制在一个窄列里居中。
// 从上到下：行李牌、教学提示（有才有）、箱子、托盘、按钮。
// 托盘里的物品一件都不能被裁掉，也不滚动，所以箱子的格子大小要和托盘一起算：先试大格子，托盘放不下就缩小。
import type { Level } from '../core/levels.ts';
import type { ScreenInfo } from '../platform/types.ts';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Layout {
  /** 居中的内容列 */
  readonly content: Rect;
  /** 行李牌 */
  readonly header: Rect;
  /** 行李牌右端的静音开关，在 header 里面 */
  readonly sound: Rect;
  /** 教学提示，这一关没有就是 null */
  readonly tip: Rect | null;
  readonly board: {
    /** 箱子外壳 */
    readonly frame: Rect;
    /** 箱子顶上的提手 */
    readonly handle: Rect;
    /** 格子区域，左上角是第 0 行第 0 列的左上角 */
    readonly grid: Rect;
    readonly cell: number;
  };
  readonly tray: {
    readonly panel: Rect;
    /** 托盘里一格的边长，比箱子里的小 */
    readonly cell: number;
    /** 每件物品的位置，下标和 level.pieces 一一对应。是个正方形，边长是它最长的一边，转起来也不会换位置。 */
    readonly slots: readonly Rect[];
  };
  readonly buttons: { readonly restart: Rect; readonly hint: Rect; readonly skip: Rect };
}

/** 内容列最宽多少 CSS 像素。更宽的屏幕（桌面）两边留空 */
export const MAX_CONTENT_WIDTH = 440;
const MARGIN = 12;
const GAP = 12;
const HEADER_H = 60;
const SOUND_SIZE = 36;
const TIP_H = 24;
const BUTTON_H = 48;
const HANDLE_H = 10;
const TRAY_PAD = 10;

/** 箱子里一格最大和最小多大 */
const MAX_BOARD_CELL = 56;
const MIN_BOARD_CELL = 20;
/** 托盘格子至少是箱子格子的这个比例，并且不小于 MIN_TRAY_CELL：太小的物品看不清 emoji，也不好点 */
const MIN_TRAY_RATIO = 0.55;
const MIN_TRAY_CELL = 18;
/** 屏幕实在太小时的底线，宁可挤也不能裁掉物品 */
const FLOOR_TRAY_CELL = 8;

export function computeLayout(screen: ScreenInfo, level: Level): Layout {
  const { safeArea: safe } = screen;
  const availW = screen.width - safe.left - safe.right - 2 * MARGIN;
  const w = Math.min(availW, MAX_CONTENT_WIDTH);
  const x = safe.left + MARGIN + (availW - w) / 2;
  const top = safe.top + MARGIN;
  const bottom = screen.height - safe.bottom - MARGIN;
  const content: Rect = { x, y: top, w, h: bottom - top };

  const header: Rect = { x, y: top, w, h: HEADER_H };
  const sound: Rect = { x: x + w - 10 - SOUND_SIZE, y: top + (HEADER_H - SOUND_SIZE) / 2, w: SOUND_SIZE, h: SOUND_SIZE };
  let y = top + HEADER_H + GAP;
  let tip: Rect | null = null;
  if (level.tip) {
    tip = { x, y, w, h: TIP_H };
    y += TIP_H + GAP;
  }

  const buttonY = bottom - BUTTON_H;
  const bw = (w - 2 * GAP) / 3;
  const buttons = {
    restart: { x, y: buttonY, w: bw, h: BUTTON_H },
    hint: { x: x + bw + GAP, y: buttonY, w: bw, h: BUTTON_H },
    skip: { x: x + 2 * (bw + GAP), y: buttonY, w: bw, h: BUTTON_H },
  };

  // 箱子和托盘共用 [y, buttonY - GAP] 这段高度
  const areaTop = y;
  const areaH = buttonY - GAP - areaTop;
  const dims = level.pieces.map((p) => p.item.maxDim);

  const boardAt = (cell: number) => {
    const pad = boardPad(cell);
    const frameW = level.cols * cell + 2 * pad;
    const frameH = level.rows * cell + 2 * pad;
    return { pad, frameW, frameH, totalH: HANDLE_H + frameH };
  };

  let cell = MIN_BOARD_CELL;
  let tray: { cell: number; slots: Rect[] } | null = null;
  const trayInner = (boardH: number) => ({
    x: x + TRAY_PAD,
    y: areaTop + boardH + GAP + TRAY_PAD,
    w: w - 2 * TRAY_PAD,
    h: areaH - boardH - GAP - 2 * TRAY_PAD,
  });
  // 从大到小试箱子的格子：第一个让托盘也放得舒服的就用
  for (let c = MAX_BOARD_CELL; c >= MIN_BOARD_CELL; c--) {
    const b = boardAt(c);
    if (b.frameW > w) continue;
    const packed = packTray(dims, trayInner(b.totalH), c, Math.max(MIN_TRAY_CELL, Math.ceil(c * MIN_TRAY_RATIO)));
    if (packed) {
      cell = c;
      tray = packed;
      break;
    }
  }
  // 都不满足：箱子用能放下的最小格子，托盘尽量塞
  if (!tray) {
    cell = Math.max(MIN_BOARD_CELL, Math.min(MAX_BOARD_CELL, fitCell(level, w)));
    const area = trayInner(boardAt(cell).totalH);
    tray = packTray(dims, area, cell, FLOOR_TRAY_CELL) ?? {
      cell: FLOOR_TRAY_CELL,
      slots: dims.map(() => ({ x: area.x, y: area.y, w: 0, h: 0 })),
    };
  }

  const b = boardAt(cell);
  const frame: Rect = { x: x + (w - b.frameW) / 2, y: areaTop + HANDLE_H, w: b.frameW, h: b.frameH };
  const board = {
    frame,
    handle: { x: frame.x + frame.w / 2 - frame.w * 0.15, y: areaTop, w: frame.w * 0.3, h: HANDLE_H + 2 },
    grid: { x: frame.x + b.pad, y: frame.y + b.pad, w: level.cols * cell, h: level.rows * cell },
    cell,
  };
  const panelY = areaTop + b.totalH + GAP;
  const panel: Rect = { x, y: panelY, w, h: buttonY - GAP - panelY };

  return { content, header, sound, tip, board, tray: { panel, cell: tray.cell, slots: tray.slots }, buttons };
}

/** 箱子外壳比格子区域宽出来的边 */
function boardPad(cell: number): number {
  return Math.max(8, Math.round(cell * 0.2));
}

/** 宽度方向上能放下的最大格子 */
function fitCell(level: Level, contentW: number): number {
  let c = MAX_BOARD_CELL;
  while (c > 1 && level.cols * c + 2 * boardPad(c) > contentW) c--;
  return c;
}

/**
 * 把物品摆进托盘：每件占一个正方形的位置（边长 = 最长的一边 × 格子大小），一排一排地摆（货架式），
 * 每排居中，整体在托盘里上下居中。从 maxCell 往下找第一个全部放得下的格子大小，小于 minCell 就放弃。
 * 位置固定为正方形是为了物品在托盘里旋转时，别的物品不跟着换位置。
 */
export function packTray(
  dims: readonly number[],
  area: Rect,
  maxCell: number,
  minCell: number,
): { cell: number; slots: Rect[] } | null {
  if (area.w <= 0 || area.h <= 0) return null;
  // 大的先摆，空隙小一些；摆完按原来的序号放回去
  const order = dims.map((_, i) => i).sort((a, b) => (dims[b] as number) - (dims[a] as number) || a - b);

  for (let t = Math.floor(maxCell); t >= minCell; t--) {
    const gap = Math.max(6, Math.round(t * 0.4));
    const rows: { ids: number[]; w: number; h: number }[] = [];
    let ok = true;
    for (const id of order) {
      const side = (dims[id] as number) * t;
      if (side > area.w) {
        ok = false;
        break;
      }
      const row = rows[rows.length - 1];
      if (row && row.w + gap + side <= area.w) {
        row.ids.push(id);
        row.w += gap + side;
        row.h = Math.max(row.h, side);
      } else {
        rows.push({ ids: [id], w: side, h: side });
      }
    }
    if (!ok) continue;
    const totalH = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);
    if (totalH > area.h) continue;

    const slots: Rect[] = new Array(dims.length);
    let yy = area.y + (area.h - totalH) / 2;
    for (const row of rows) {
      let xx = area.x + (area.w - row.w) / 2;
      for (const id of row.ids) {
        const side = (dims[id] as number) * t;
        // 同一排里高矮不一，上下居中
        slots[id] = { x: xx, y: yy + (row.h - side) / 2, w: side, h: side };
        xx += side + gap;
      }
      yy += row.h + gap;
    }
    return { cell: t, slots };
  }
  return null;
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** 屏幕上的点落在箱子的哪一格；不在格子区域里返回 null */
export function boardCellAt(layout: Layout, x: number, y: number): { r: number; c: number } | null {
  const { grid, cell } = layout.board;
  if (!contains(grid, x, y)) return null;
  return { r: Math.floor((y - grid.y) / cell), c: Math.floor((x - grid.x) / cell) };
}
