// 微信入口：创建微信平台，交给游戏。这里不放游戏逻辑。
import { startGame } from '../game/start.ts';
import { createWechatPlatform } from '../platform/wechat.ts';

startGame(createWechatPlatform(wx, (cb) => requestAnimationFrame(cb)));
