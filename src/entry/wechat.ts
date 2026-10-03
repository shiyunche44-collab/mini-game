// 微信入口：创建微信平台，交给游戏。这里不放游戏逻辑。
import { startGame } from '../game/start.ts';
import { createWechatPlatform } from '../platform/wechat.ts';

// 广告位 id：在微信的后台开通流量主、创建广告位之后填在这里。留空的那种广告退回模拟：
// 激励视频弹一个确认框（点"领取奖励"才给），插屏直接跳过。
const AD_UNITS = { rewarded: '', interstitial: '' };

startGame(createWechatPlatform(wx, (cb) => requestAnimationFrame(cb), AD_UNITS));
