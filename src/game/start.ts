// 游戏启动：三个平台的入口都调这一个函数，入口自己只负责创建 Platform。
import { Loop } from '../engine/loop.ts';
import type { Platform } from '../platform/types.ts';
import { theme } from './theme.ts';

function drawBackground(platform: Platform): void {
  const { ctx, screen } = platform;
  const sky = ctx.createLinearGradient(0, 0, 0, screen.height);
  sky.addColorStop(0, theme.backgroundTop);
  sky.addColorStop(1, theme.backgroundBottom);
  ctx.fillStyle = sky;
  // 每帧整屏重画，不需要 clearRect
  ctx.fillRect(0, 0, screen.width, screen.height);
}

/** 启动主循环。返回 Loop，测试可以用它停下。 */
export function startGame(platform: Platform): Loop {
  const loop = new Loop(platform, {
    update: () => {},
    render: () => drawBackground(platform),
  });
  loop.start();
  return loop;
}
