# 架构

这份文档写清分层规则和防跑偏机制。每条规则的来由见 [ADR](adr/)。改规则必须先写新的 ADR，经用户同意后再改代码。

## 目标和约束

- 一套代码打出三份产物：Web（开发调试、手机试玩链接）、微信小游戏、抖音小游戏。
- TypeScript + 原生 Canvas 2D，不用游戏引擎，运行时不依赖第三方库（[ADR 0001](adr/0001-no-game-engine.md)）。
- 代码包小于 300KB。
- 关卡按关卡号确定地生成，所有设备上结果一致（[ADR 0003](adr/0003-deterministic-levels.md)）。

## 分层

规则来自 [ADR 0002](adr/0002-layering.md)，由 `tools/check-arch.mjs` 执行。下表和脚本里的 `LAYERS` 保持一致，改规则要两边一起改。

| 层 | 位置 | 职责 | 可以引用 |
|---|---|---|---|
| core | `src/core/` | 纯规则：物品、关卡生成、一局状态、存档模型 | 只能引用 core 内部 |
| engine | `src/engine/` | 主循环、补间、输入识别（点击 / 拖动）、绘制工具 | core、platform/types.ts |
| game | `src/game/` | 场景、布局、绘制、交互流程 | core、engine、platform/types.ts |
| platform/types.ts | `src/platform/types.ts` | Platform 接口、Canvas2D 子集接口 | 不引用任何文件 |
| 平台实现 | `src/platform/` 下其他文件 | 把平台 API 翻译成 Platform 接口，不含游戏逻辑 | 只能引用 platform/types.ts |
| entry | `src/entry/` | 组装：创建平台实例，启动游戏 | 以上全部 |

依赖方向（箭头表示"引用"，反过来一律不行）：

```
entry → game → engine → core
game、engine → platform/types.ts
entry → 平台实现 → platform/types.ts
```

另外几条规则：

- **业务层**（core、engine、game、platform/types.ts）不能直接使用运行环境的全局对象：`wx`、`tt`、`GameGlobal`、`window`、`document`、`navigator`、`localStorage`、`sessionStorage`、`globalThis`。局部变量也不用这些名字。业务层也不能写 `/// <reference>`。
- 平台实现之间不互相引用，入口之间也不互相引用。每个入口单独打包成一个平台的产物；入口共用的启动逻辑放进 game。
- `src` 里不能引用 npm 包、node 内置模块，也不能引用 `src` 以外的文件（test、tools）。
- `src` 里只写 `.ts` 文件，每个文件都要放在某一层里。
- 所有写法的引用都算，包括 `import type`、`export from`、`import()`、`typeof import()`。

## 目录结构

带 ✓ 的已经存在，其余是计划中的。

```
src/
  core/      rng.ts ✓  items.ts ✓  levels.ts ✓  game.ts ✓  progress.ts ✓
  engine/    loop.ts ✓  tween.ts ✓  input.ts ✓  draw.ts ✓
  game/      PlayScene.ts ✓  Session.ts ✓  WinOverlay.ts ✓  pieceView.ts ✓  layout.ts ✓  snap.ts ✓  theme.ts ✓  start.ts ✓
  platform/  types.ts ✓  canvas-compat.check.ts ✓  web.ts ✓  wechat.ts  douyin.ts  tt.d.ts
  entry/     web.ts ✓  wechat.ts  douyin.ts（每个入口配一份 tsconfig.<入口名>.json）
test/        fake-platform.ts ✓、core 单测、game 层在假平台上的测试、Playwright 冒烟测试
tools/       typecheck.mjs ✓  check-arch.mjs ✓  check.mjs ✓  levels-preview.mjs ✓  build.mjs ✓  check-size.mjs ✓  smoke.mjs ✓  publish-pages.mjs ✓
platforms/   web/index.html ✓；wechat/ 和 douyin/ 的 game.json、project.config.json 模板
docs/        architecture.md  design.md  roadmap.md  backlog.md  adr/
```

## 平台接口

接口以 [`src/platform/types.ts`](../src/platform/types.ts) 为准，这里只做概括。entry 创建平台实例，交给 game；engine 和 game 只认识接口。

| 能力 | 接口 | 微信 | 抖音 | Web |
|---|---|---|---|---|
| 画布 | `ctx`、`screen` | `wx.createCanvas` | `tt.createCanvas` | `<canvas>` |
| 触摸 | `onPointer` | `wx.onTouch*` | `tt.onTouch*` | pointer 事件 |
| 下一帧、时钟 | `requestFrame`、`now` | `requestAnimationFrame`、`Date.now` | 同左（`tt`） | `requestAnimationFrame`、`Date.now` |
| 存储 | `storage` | `wx.getStorageSync` 等 | `tt.getStorageSync` 等 | localStorage（包 try/catch） |
| 激励视频、插屏 | `ads` | `wx.createRewardedVideoAd`、`createInterstitialAd` | `tt` 的同名接口 | 激励视频：模拟弹层（倒计时后才能领奖，可提前关闭）；插屏：只打日志 |
| 分享 | `share` | `wx.shareAppMessage` | `tt.shareAppMessage` | 无 |
| 震动 | `vibrate` | `wx.vibrateShort` | `tt.vibrateShort` | `navigator.vibrate` |
| 前后台 | `onShow`、`onHide` | `wx.onShow` 等 | `tt.onShow` 等 | visibilitychange |
| 埋点 | `track` | `wx.reportEvent` | `tt.reportAnalytics` | console |
| 录屏 | `recorder`（可选） | 无 | `tt.getGameRecorderManager` | 无 |
| 侧边栏复访 | `sidebar`（可选） | 无 | `tt.checkScene` 等 | 无 |

约定：

- 坐标一律用 CSS 像素，原点在画布左上角。`ctx` 已按 dpr 缩放好。
- `requestFrame` 的参数是单调递增的帧时间，只用来算 dt；要存档、跨次启动比较的时间用 `now()`（墙上时钟）。没有取消帧回调的接口，想停下的一方自己设标志（[ADR 0004](adr/0004-platform-frame-and-clock.md)）。
- 广告接口不抛异常。激励视频只有完整看完才返回 `true`。
- 存储的值必须能被 JSON 序列化。读不到或数据损坏时返回调用方给的默认值。

## Canvas2D 子集

游戏只能通过 `Canvas2D` 接口画图。接口里只放微信、抖音、浏览器都支持的方法和属性。

- 故意没有放进去的：`roundRect`、`ellipse`、`filter`、`letterSpacing`、`fontKerning`、`direction`、`createPattern`、`getTransform`、`isPointInPath`、`OffscreenCanvas`。圆角矩形用 `arcTo` 自己画（`engine/draw.ts`）。
- `src/platform/canvas-compat.check.ts` 在编译期保证这个子集确实是浏览器 Canvas 的子集。
- 微信的类型库里 `RenderingContext` 是空接口，没法在编译期对照，微信、抖音的实际表现靠 4.1 真机验证。

## 类型检查的分层

`tools/typecheck.mjs` 按目录逐个跑 `tsc`，每层只带自己该有的类型库：

| 目录 | 类型库 | 效果 |
|---|---|---|
| core、engine、game | 只有 ES2020 | 写 `window`、`document`、`wx` 直接编译失败 |
| entry（每个入口一份 `tsconfig.<入口名>.json`） | web 入口：ES2020 + DOM；微信、抖音入口在 4.1 配各自的类型库 | 入口会引用对应的平台实现，平台实现要用平台 API，所以入口要带同一套类型库；入口没配 tsconfig，类型检查直接失败 |
| platform | ES2020、DOM、微信类型 | 平台实现可以用平台 API |
| test | ES2020、node | 测试可以用 node 的 API |

被引用的文件会按引用方的配置再检查一遍。入口因此会把 game 等业务层文件也按带 DOM 的配置再查一遍，但业务层直接用 `window` 这类全局对象仍会被架构检查和各层自己的 tsconfig 拦住。例如假平台引用了 platform/types.ts，所以 types.ts 也要在 test 不带 DOM 的配置下通过，往里面写 `HTMLCanvasElement` 这类类型会被拦下。

所有层都开启 `strict`、`noUncheckedIndexedAccess` 和 `erasableSyntaxOnly`。最后一项禁止 `enum`、`namespace` 这类不能直接擦掉的语法，这样 node 可以直接运行 `.ts` 测试，不需要先编译。

## 防跑偏机制

全部检查汇总在 `npm run check`（`tools/check.mjs`）里，提交前必须通过。

| 怎么跑偏 | 机制 | 位置 | 状态 |
|---|---|---|---|
| 逻辑层用了某个平台独有的东西 | 分层 tsconfig | `src/*/tsconfig.json`、`tools/typecheck.mjs` | 0.1 已完成 |
| 用了小游戏不一定支持的 Canvas API | Canvas2D 子集和编译期兼容检查 | `src/platform/types.ts`、`canvas-compat.check.ts` | 0.2 已完成 |
| 绕开分层：引用方向错误、`globalThis`、`declare const wx` | 架构检查和它的自测 | `tools/check-arch.mjs`、`check-arch.test.mjs` | 0.3 已完成 |
| 游戏层悄悄依赖浏览器行为 | 假平台：记录绘制调用，模拟触摸、广告、前后台，手动推进时间 | `test/fake-platform.ts` | 0.2 已完成；game 层测试从 3.1 开始 |
| 规则在多次会话之间被遗忘 | 本文档、ADR、`CLAUDE.md` | `docs/`、`CLAUDE.md` | 0.4 已完成 |
| 范围慢慢膨胀 | 每个任务写明不做什么；计划外的想法记进 backlog | `docs/backlog.md` | 0.4 已完成 |
| 没跑检查就推送 | GitHub Actions 跑 `npm run check` | `.github/workflows/check.yml` | 0.5 已完成 |
| 关卡生成变慢 | 单测：每关生成不超过 50ms | core 单测 | 1.2 |
| 包体膨胀 | 产物超过 300KB（压缩后的 JS）时报错 | `tools/check-size.mjs` | 2.2 已完成 |
| 单测都过了，页面在真浏览器里却打不开、摸不动 | Chromium 里的冒烟测试，CI 单独一个任务（要装浏览器，不放进 `npm run check`） | `tools/smoke.mjs` | 3.5 已完成 |

## 构建

`tools/build.mjs` 用 esbuild 把每个入口打成一个 IIFE 格式的文件，产物有三份（带 ✓ 的已经有）：

- `dist/web/` ✓：调试，也用来生成手机试玩链接（推送 `dev` 后由 `.github/workflows/pages.yml` 发布到 `gh-pages` 分支，见 [playtest.md](playtest.md)）。`npm run build:web` 构建；`npm run dev` 监听改动并起本地服务（端口默认 8000，`PORT=xxxx npm run dev` 可改）
- `dist/wechat/`：导入微信开发者工具（4.1）
- `dist/douyin/`：导入抖音开发者工具（4.1）

## 改架构的流程

1. 发现需要改规则或接口时，先停下，向用户说明原因和方案。
2. 用户同意后，在 `docs/adr/` 写一篇新的 ADR，编号接着往下排。
3. 再改代码，同时更新本文档、`CLAUDE.md` 和 `tools/check-arch.mjs`（如果涉及）。
4. 被取代的旧 ADR 不删，把它的状态改成"已被 NNNN 取代"。

ADR 模板：

```markdown
# NNNN 标题

- 状态：提议中 / 已采纳 / 已被 NNNN 取代
- 日期：YYYY-MM-DD

## 背景
## 决定
## 理由
## 代价
## 什么时候重新考虑
```

现有 ADR：

| 编号 | 标题 |
|---|---|
| [0001](adr/0001-no-game-engine.md) | 不用游戏引擎：TypeScript + 原生 Canvas 2D |
| [0002](adr/0002-layering.md) | 分层和依赖规则 |
| [0003](adr/0003-deterministic-levels.md) | 关卡按关卡号确定地生成 |
| [0004](adr/0004-platform-frame-and-clock.md) | Platform 增加下一帧回调和墙上时钟 |
