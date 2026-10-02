// 玩法测试共用的辅助：用假平台搭一局游戏，模拟手指在托盘和箱子之间点按、拖动。
// 手指的位置都由场景的布局（scene.layout）和拿起时的几何规则换算出来，
// 所以场景改了布局，测试跟着变，不用改数字。
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.ts';
import { generateLevel } from '../src/core/levels.ts';
import { createGestureRecognizer } from '../src/engine/input.ts';
import { Loop } from '../src/engine/loop.ts';
import { LIFT_CELLS, PlayScene } from '../src/game/PlayScene.ts';
import { FakePlatform, type DrawCall } from './fake-platform.ts';

export const FRAME = FakePlatform.FRAME_MS;

/** 搭一局：假平台 + 第 n 关 + 场景 + 手势 + 主循环，并画好第一帧 */
export function setup(n = 1) {
  const p = new FakePlatform();
  const game = new Game(generateLevel(n));
  const scene = new PlayScene(p, game);
  p.onPointer(createGestureRecognizer(() => p.now(), scene));
  new Loop(p, { update: (dt) => scene.update(dt), render: () => scene.render() }).start();
  p.advance(FRAME);
  return { p, game, scene };
}
export type Ctx = ReturnType<typeof setup>;

/** 物品在托盘里时外框的左上角（在自己的正方形位置里居中） */
export function trayOrigin({ game, scene }: Ctx, id: number) {
  const o = game.pieces[id]?.item.orients[game.pieces[id]?.oi ?? 0];
  const slot = scene.layout.tray.slots[id];
  assert.ok(o && slot);
  const t = scene.layout.tray.cell;
  return { x: slot.x + (slot.w - o.w * t) / 2, y: slot.y + (slot.h - o.h * t) / 2, o, t };
}

/** 托盘里这件物品的位置中心 */
export function traySlotCenter({ scene }: Ctx, id: number): [number, number] {
  const slot = scene.layout.tray.slots[id];
  assert.ok(slot);
  return [slot.x + slot.w / 2, slot.y + slot.h / 2];
}

/** 按在托盘里这件物品第一格的中心。返回按下的点，以及抓的位置占外框宽、高的比例 */
export function grabInTray(ctx: Ctx, id: number) {
  const { x, y, o, t } = trayOrigin(ctx, id);
  const [r0, c0] = o.cells[0] ?? [0, 0];
  const px = x + (c0 + 0.5) * t;
  const py = y + (r0 + 0.5) * t;
  return { px, py, fx: (px - x) / (o.w * t), fy: (py - y) / (o.h * t), o };
}

/** 要让物品外框的左上角落在箱子的 (r, c)（可以是小数），手指应该在哪 */
export function fingerFor(ctx: Ctx, g: { fx: number; fy: number; o: { w: number; h: number } }, r: number, c: number) {
  const { grid, cell } = ctx.scene.layout.board;
  return [grid.x + c * cell + g.fx * g.o.w * cell, grid.y + r * cell + g.fy * g.o.h * cell + LIFT_CELLS * cell] as const;
}

/** 把托盘里的物品拖到箱子的 (r, c)，瞬间完成（手指很快） */
export function dragIn(ctx: Ctx, id: number, r: number, c: number) {
  const g = grabInTray(ctx, id);
  const [fx, fy] = fingerFor(ctx, g, r, c);
  ctx.p.touch.drag([[g.px, g.py], [g.px + 15, g.py], [fx, fy]]);
}

/** 画一帧，返回这一帧的绘制调用 */
export function frame(p: FakePlatform): DrawCall[] {
  p.ctx.clearCalls();
  p.advance(FRAME);
  return [...p.ctx.calls];
}

export const emojiCalls = (calls: DrawCall[], emoji: string) =>
  calls.filter((c) => c.op === 'fillText' && c.args[0] === emoji);

/** 这个 emoji 画在哪。同一帧里画了多个时（预览、手上拿着的），取最后一个，也就是最上面的那个 */
export const emojiPos = (calls: DrawCall[], emoji: string) => {
  const c = emojiCalls(calls, emoji).at(-1);
  return c ? ([c.args[1], c.args[2]] as [number, number]) : null;
};

export const fontSize = (c: DrawCall | undefined) => Number(/(\d+)px/.exec(c?.style.font ?? '')?.[1]);
