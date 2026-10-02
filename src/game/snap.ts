// 吸附：物品被拖到箱子上方时，找一个最近的、放得下的位置。
// 纯函数，只读 Game 的状态，不碰画面。
import type { Game } from '../core/game.ts';

/** 物品外框的左上角离某个格子的格点最多多远（单位：格）还会吸过去。再远就当作没有对准任何位置。 */
export const SNAP_RADIUS = 0.8;

export interface Snap {
  readonly r: number;
  readonly c: number;
}

/**
 * 物品外框左上角在箱子里的位置是 (fr, fc)，单位是格，可以是小数。
 * 在附近的格点里找放得下的，返回离得最近的一个；没有放得下的，或者都超出 SNAP_RADIUS，返回 null。
 *
 * 不是简单地四舍五入：四舍五入到的那一格放不下，但旁边一格能放时，吸到旁边，玩家手指不用那么准。
 * 距离一样近时取靠上、靠左的，结果不随浮点误差抖动。
 */
export function findSnap(game: Game, id: number, fr: number, fc: number): Snap | null {
  const piece = game.pieces[id];
  if (!piece) return null;
  const r0 = Math.round(fr);
  const c0 = Math.round(fc);
  let best: Snap | null = null;
  let bestD = SNAP_RADIUS * SNAP_RADIUS;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      // 用平方比较，不开方：距离相同的格点取先遇到的（靠上、靠左），差 1e-9 以内当作相同
      const d = (r - fr) * (r - fr) + (c - fc) * (c - fc);
      if (d > bestD + 1e-9 || (best && d >= bestD - 1e-9)) continue;
      if (!game.canPlace(id, piece.oi, r, c)) continue;
      best = { r, c };
      bestD = d;
    }
  }
  return best;
}
