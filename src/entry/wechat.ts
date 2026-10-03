// 微信入口：创建微信平台，交给游戏。这里不放游戏逻辑。
import { startGame } from '../game/start.ts';
import { createWechatPlatform } from '../platform/wechat.ts';

// 构建时扫描 assets/icons 得到的物品 id（tools/build.mjs 的 define）：只有这些物品有图标，不会去请求不存在的图
declare const __ICON_IDS__: readonly string[];

// 广告位 id：在微信的后台开通流量主、创建广告位之后填在这里。留空的那种广告退回模拟：
// 激励视频弹一个确认框（点"领取奖励"才给），插屏直接跳过。
const AD_UNITS = { rewarded: '', interstitial: '' };

startGame(createWechatPlatform(wx, (cb) => requestAnimationFrame(cb), AD_UNITS), { icons: __ICON_IDS__ });
