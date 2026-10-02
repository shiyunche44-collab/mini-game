// 游戏启动：三个平台的入口都调这一个函数，入口自己只负责创建 Platform。
import { Game } from '../core/game.ts';
import { generateLevel } from '../core/levels.ts';
import { loadProgress, SAVE_KEY } from '../core/progress.ts';
import { createGestureRecognizer } from '../engine/input.ts';
import { Loop } from '../engine/loop.ts';
import type { Platform } from '../platform/types.ts';
import { PlayScene } from './PlayScene.ts';

export interface StartOptions {
  /** 调试用：直接看第几关，不读存档 */
  level?: number;
  /** 调试用：开局先用掉几次提示，用来看箱子里摆了东西的样子 */
  hints?: number;
}

/** 启动主循环。返回 Loop，测试可以用它停下。 */
export function startGame(platform: Platform, options: StartOptions = {}): Loop {
  const n = options.level ?? loadProgress(platform.storage.get(SAVE_KEY, null)).level;
  const game = new Game(generateLevel(n));
  for (let i = 0; i < (options.hints ?? 0); i++) game.hint();

  const scene = new PlayScene(platform, game);
  platform.onPointer(createGestureRecognizer(() => platform.now(), scene));
  const loop = new Loop(platform, {
    update: (dt) => scene.update(dt),
    render: () => scene.render(),
  });
  loop.start();
  return loop;
}
