// Web 入口：创建浏览器平台，交给游戏。这里不放游戏逻辑。
import { startGame, type StartOptions } from '../game/start.ts';
import { createWebPlatform } from '../platform/web.ts';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('页面里没有 id 为 game 的 <canvas>');

// 构建时扫描 assets/icons 得到的物品 id（tools/build.mjs 的 define）：只有这些物品有图标，不会去请求不存在的图
declare const __ICON_IDS__: readonly string[];

// 调试用的网址参数：?level=10&hints=3 直接看第 10 关、先摆好 3 件。参数不对就忽略。
const params = new URLSearchParams(window.location.search);
const options: StartOptions = {};
const level = Number(params.get('level'));
if (Number.isSafeInteger(level) && level >= 1) options.level = level;
const hints = Number(params.get('hints'));
if (Number.isSafeInteger(hints) && hints >= 1) options.hints = hints;

options.icons = __ICON_IDS__;
startGame(createWebPlatform(canvas), options);

// 转屏或者改窗口宽度之后，布局要重新算：刷新页面。进度每一步都存了档，刷新只会丢手上正拿着的那一件。
// 只看宽度：手机浏览器的地址栏收起、弹出时只有高度变，不能为这个刷新。
const initialWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth !== initialWidth) window.location.reload();
});
