// 抖音入口：创建抖音平台，交给游戏。这里不放游戏逻辑。
import { startGame } from '../game/start.ts';
import { createDouyinPlatform } from '../platform/douyin.ts';

startGame(createDouyinPlatform(tt, (cb) => requestAnimationFrame(cb)));
