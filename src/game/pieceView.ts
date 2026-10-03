// 画一件物品：每个格子一块圆角色块，emoji 画在 core 算好的位置上。
// 以后换图（阶段 5 的图集）只改这个文件：画法只依赖"这件物品、这个朝向、画在哪、一格多大"。
import { addRoundRect, fillRoundRect, mixColor } from '../engine/draw.ts';
import type { PieceState } from '../core/game.ts';
import type { Canvas2D } from '../platform/types.ts';
import { EMOJI_FONT } from './theme.ts';

type Orient = NonNullable<PieceState['item']['orients'][number]>;

/** 把整件物品的轮廓拼成当前路径（几块的并集），一次 fill 就是一整块，投影和半透明都只算一次 */
function outlinePath(ctx: Canvas2D, o: Orient, x: number, y: number, cell: number): void {
  const inset = Math.max(1, cell * 0.04);
  const size = cell - 2 * inset;
  const has = new Set(o.cells.map(([r, c]) => `${r},${c}`));
  ctx.beginPath();
  for (const [r, c] of o.cells) {
    const cx = x + c * cell + inset;
    const cy = y + r * cell + inset;
    addRoundRect(ctx, cx, cy, size, size, cell * 0.2);
    // 相邻的格子之间补一块方形，把缝连上
    if (has.has(`${r},${c + 1}`)) ctx.rect(cx + size / 2, cy, cell, size);
    if (has.has(`${r + 1},${c}`)) ctx.rect(cx, cy + size / 2, size, cell);
  }
}

/**
 * 把物品画在 (x, y)，这是它当前朝向外框的左上角。
 * lift 大于 0 时表示被手指拿起来：下面垫一层影子，让它看起来飘着（拖动时用）。
 */
export function drawPiece(ctx: Canvas2D, piece: PieceState, x: number, y: number, cell: number, lift = 0): void {
  const o = piece.item.orients[piece.oi];
  if (!o) return;
  const base = piece.item.color;
  const inset = Math.max(1, cell * 0.04);
  const radius = cell * 0.2;

  ctx.save();
  const has = new Set(o.cells.map(([r, c]) => `${r},${c}`));
  const size = cell - 2 * inset;
  const thick = Math.max(1.5, cell * 0.07);
  const dark = mixColor(base, '#000000', 0.18);

  if (lift > 0) {
    // 影子：把整件物品的轮廓拼成一条路径，一次填充、一次投影。
    // 如果每格各投各的，一格的影子会盖在相邻一格的色块上，物品中间出现一道道深色的缝。
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = lift * 1.5;
    ctx.shadowOffsetY = lift;
    outlinePath(ctx, o, x, y, cell);
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  // 分两层画：先画整个轮廓的深色底，再在上面画本色、下沿留一条深边，看起来有点厚度。
  // 相邻的格子之间补一块方形把缝连上，同一件物品是一整块而不是一堆碎格子；
  // 补的方块盖住了相邻两格靠里的圆角，只剩外轮廓是圆的。
  const layer = (color: string, cut: number): void => {
    for (const [r, c] of o.cells) {
      const cx = x + c * cell + inset;
      const cy = y + r * cell + inset;
      const below = has.has(`${r + 1},${c}`);
      const h = below ? size : size - cut;
      fillRoundRect(ctx, cx, cy, size, h, radius, color);
      ctx.fillStyle = color;
      if (has.has(`${r},${c + 1}`)) ctx.fillRect(cx + size / 2, cy, cell, h);
      if (below) ctx.fillRect(cx, cy + size / 2, size, cell);
    }
  };
  layer(dark, 0);
  layer(base, thick);
  drawLabel(ctx, piece, o, x, y, cell);
  ctx.restore();
}

/**
 * 吸附预览：在 (x, y) 画一个半透明的物品，表示松手会落在这里。
 * 整件轮廓一次填充，不分层：分层画再叠半透明，格子之间会透出一道道深浅不一的条纹。
 */
export function drawPieceGhost(ctx: Canvas2D, piece: PieceState, x: number, y: number, cell: number, alpha: number): void {
  const o = piece.item.orients[piece.oi];
  if (!o) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  outlinePath(ctx, o, x, y, cell);
  ctx.fillStyle = piece.item.color;
  ctx.fill();
  drawLabel(ctx, piece, o, x, y, cell);
  ctx.restore();
}

/**
 * 提示高亮：在已经摆好的物品上盖一层发光的轮廓。alpha 是亮度，0 时什么都不画。
 * 整件轮廓一次填充：和预览一样，分格画再叠半透明会出现条纹。
 */
export function drawPieceGlow(ctx: Canvas2D, piece: PieceState, x: number, y: number, cell: number, alpha: number, color: string): void {
  const o = piece.item.orients[piece.oi];
  if (!o || alpha <= 0) return;
  ctx.save();
  // 最亮时也留着一部分透明，不把物品上的 emoji 盖住
  ctx.globalAlpha = Math.min(1, alpha) * 0.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = cell * 0.8;
  outlinePath(ctx, o, x, y, cell);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawLabel(ctx: Canvas2D, piece: PieceState, o: Orient, x: number, y: number, cell: number): void {
  ctx.font = `${Math.round(cell * (o.label.big ? 1.2 : 0.7))}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText(piece.item.emoji, x + o.label.x * cell, y + o.label.y * cell);
}
