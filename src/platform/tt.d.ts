// 抖音小游戏的全局声明。不引入抖音的类型库（不加依赖），所以 tt 的类型是 any：
// platform/douyin.ts 自己声明了用到的那部分接口，入口把 tt 传进去时由它接住。
// requestAnimationFrame 是小游戏里的全局函数，入口要用它。
// eslint 之类的检查没有用在这个项目里，这里的 any 是有意的。
declare const tt: any;
declare function requestAnimationFrame(callback: (timestamp: number) => void): number;
