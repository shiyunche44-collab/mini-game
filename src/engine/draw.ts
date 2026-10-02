// 绘制工具。Canvas2D 子集里故意没有 roundRect（微信、抖音不一定支持），圆角矩形在这里用 arcTo 自己画。
import type { Canvas2D } from '../platform/types.ts';

/** 只描出圆角矩形的路径，不填充也不描边；调用方接着 fill() 或 stroke()。半径过大时按短边的一半算。 */
export function roundRectPath(ctx: Canvas2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Canvas2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
): void {
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRoundRect(
  ctx: Canvas2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  stroke: string,
  lineWidth: number,
): void {
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * 把两个 #rrggbb 颜色按比例混合：t = 0 是 a，t = 1 是 b。
 * 做明暗变化用（和白色混合变亮，和黑色混合变暗），只用加减乘除，每个设备算出的颜色都一样。
 */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const out = ca.map((v, i) => Math.round(v + ((cb[i] ?? 0) - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`颜色必须是 #rrggbb 的形式，收到 ${color}`);
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}
