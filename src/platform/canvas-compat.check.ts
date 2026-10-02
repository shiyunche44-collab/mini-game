// 只在编译期起作用，运行时不会被任何代码引用，也不会进入打包产物。
// 如果有人往 Canvas2D 里加了浏览器 Canvas 里没有（或类型对不上）的成员，这里会编译失败，
// 报错信息里会出现出问题的成员名。
//
// 微信的类型库里 RenderingContext 是空接口，没法在编译期对照；微信、抖音的实际表现靠 4.1 真机验证。
import type { Canvas2D, ImageSource } from './types.ts';

// 样式属性是"写进去"的方向：我们允许写入的值，浏览器必须也接受。
type WriteKeys = 'fillStyle' | 'strokeStyle';

type Check<Real, Mine> = {
  [K in keyof Mine]: K extends keyof Real
    ? K extends WriteKeys
      ? Mine[K] extends Real[K]
        ? true
        : K
      : Real[K] extends Mine[K]
        ? true
        : K
    : K;
}[keyof Mine];

type Assert<T extends true> = T;

// drawImage 单独处理：浏览器的参数是一组具体的元素类型（CanvasImageSource），
// 我们自己声明的 ImageSource 只有宽高，两个类型在参数位置对不上。
// 所以改为保证：浏览器里会用到的图片对象都满足 ImageSource，
// web.ts 在把真实 ctx 交出去时，对 drawImage 的参数做一次类型断言。
export type DomCanvasIsCompatible = Assert<Check<CanvasRenderingContext2D, Omit<Canvas2D, 'drawImage'>>>;
export type DomImageIsImageSource = Assert<HTMLImageElement extends ImageSource ? true : false>;
export type DomCanvasElementIsImageSource = Assert<HTMLCanvasElement extends ImageSource ? true : false>;
