# Backlog

计划外的想法和已知问题都记在这里，不在当前任务里顺手做。每条写清来源。排进 [roadmap](roadmap.md) 以后，就从这里删掉。

## 已知问题

### wechat.ts、douyin.ts 能用浏览器 API 并通过类型检查

- 来源：0.4
- 现状：`platform` 目录整体带 DOM 和微信的类型库。微信、抖音的实现里写 `window`、`document` 也能编译，但小游戏运行时没有这些对象。
- 已有的保障：4.1 的验收会检查产物里没有浏览器接口。
- 可选的改法：写 `wechat.ts`、`douyin.ts` 之前，给它们单独配一份不带 DOM 的 tsconfig，提前到编译期拦截。

## 想法

暂无。
