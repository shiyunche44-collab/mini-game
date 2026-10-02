# 0004 Platform 增加下一帧回调和墙上时钟

- 状态：已采纳
- 日期：2026-10-02

## 背景

- 2.1 要做主循环和补间。engine 属于业务层，不能直接用 `requestAnimationFrame`、`Date`、`performance`（[ADR 0002](0002-layering.md)），而 Platform 接口里没有这两样东西。
- 1.5 的插屏频控由调用方传入 `now`，存档里记着"上次插屏的时间"。这个时间要跨次启动，只能是墙上时钟，同样要从 Platform 拿。

## 决定

`Platform` 增加两个成员：

```ts
/** 下一帧回调。参数是单调递增的毫秒数，只用来算帧间隔，不能存档。 */
requestFrame(cb: (frameTimeMs: number) => void): void;
/** 墙上时钟（epoch 毫秒）。要存档、要跨次启动比较的时间用它。 */
now(): number;
```

1. **帧时间和墙上时钟分开。** 帧时间单调，适合算 `dt`；墙上时钟可能被用户改动，不适合算动画，但存档需要它。
2. **不提供 `cancelFrame`。** 主循环用运行标志停下：`onHide` 时置位，挂着的回调到点后发现标志已变就直接返回。接口因此更小，三个平台也不用各自处理取消。
3. **主循环把 `dt` 夹在 0～100ms。** 切后台回来、时钟回拨都不会让补间跳变。
4. 三端对应：Web 用 `requestAnimationFrame` 和 `Date.now`；微信、抖音用 `wx`、`tt` 的 `requestAnimationFrame` 和 `Date.now`。
5. 假平台 `test/fake-platform.ts` 的时间由测试手动推进：`advance(ms)` 按 16.67ms 一帧运行已登记的帧回调，同时推进 `now()`。

## 理由

- 只加两个成员，是主循环、补间、频控需要的最小集合。
- 时间由平台提供、假平台手动推进，engine 和 game 的动画逻辑可以在 node 里确定地测试，不用真的等。

## 代价

- 三个平台实现（2.2、4.1）都要补上这两个成员。
- 没有 `cancelFrame`，停下之后会有一次空转的回调；换来的是接口更小。

## 什么时候重新考虑

- 需要降帧率或精确取消帧回调（例如省电模式）。
- 某个平台的 `requestAnimationFrame` 不能这样用。
