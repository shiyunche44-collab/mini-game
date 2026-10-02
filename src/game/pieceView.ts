// 画一件物品：每个格子一块圆角色块，emoji 画在 core 算好的位置上。
// 以后换图（阶段 5 的图集）只改这个文件：画法只依赖"这件物品、这个朝向、画在哪、一格多大"。
import { fillRoundRect, mixColor } from '../engine/draw.ts';
import type { PieceState } from '../core/game.ts';
import type { Canvas2D } from '../platform/types.ts';
import { EMOJI_FONT } from './theme.ts';

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
  if (lift > 0) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = lift * 1.5;
    ctx.shadowOffsetY = lift;
  }
  const has = new Set(o.cells.map(([r, c]) => `${r},${c}`));
  const size = cell - 2 * inset;
  const thick = Math.max(1.5, cell * 0.07);
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
  layer(mixColor(base, '#000000', 0.18), 0);
  layer(base, thick);
  // 阴影只给色块，emoji 不要再叠一层
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.font = `${Math.round(cell * (o.label.big ? 1.2 : 0.7))}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText(piece.item.emoji, x + o.label.x * cell, y + o.label.y * cell);
  ctx.restore();
}
