// Web 入口：创建浏览器平台，交给游戏。这里不放游戏逻辑。
import { startGame } from '../game/start.ts';
import { createWebPlatform } from '../platform/web.ts';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('页面里没有 id 为 game 的 <canvas>');
startGame(createWebPlatform(canvas));
