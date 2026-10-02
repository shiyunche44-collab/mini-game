// 游戏启动：三个平台的入口都调这一个函数，入口自己只负责创建 Platform。
import { createGestureRecognizer } from '../engine/input.ts';
import { Loop } from '../engine/loop.ts';
import type { Platform } from '../platform/types.ts';
import { Session, type SessionOptions } from './Session.ts';

export type StartOptions = SessionOptions;

/** 启动主循环。返回 Loop，测试可以用它停下。 */
export function startGame(platform: Platform, options: StartOptions = {}): Loop {
  const session = new Session(platform, options);
  platform.onPointer(createGestureRecognizer(() => platform.now(), session));
  const loop = new Loop(platform, {
    update: (dt) => session.update(dt),
    render: () => session.render(),
  });
  loop.start();
  return loop;
}
