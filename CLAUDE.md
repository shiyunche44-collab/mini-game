# CLAUDE.md

整理行李箱：一款同时上微信和抖音的休闲小游戏。TypeScript + 原生 Canvas 2D，不用游戏引擎。

开始工作前先读：

- [docs/roadmap.md](docs/roadmap.md)：分阶段任务和进度。下一个任务就是表里第一个没打 ✅ 的任务。
- [docs/architecture.md](docs/architecture.md)：分层规则和防跑偏机制
- [docs/design.md](docs/design.md)：玩法定义
- [docs/adr/](docs/adr/)：重大决定的记录
- [docs/backlog.md](docs/backlog.md)：计划外的想法和已知问题

## 命令

需要 Node 22.18 以上（测试直接用 node 运行 .ts）。

| 命令 | 作用 |
|---|---|
| `npm ci` | 安装依赖 |
| `npm run check` | 全部检查：架构检查、类型检查、包体检查、素材检查、单元测试。**提交前必须通过** |
| `npm run check:arch` | 只跑架构检查 |
| `npm run typecheck` | 只跑分层类型检查 |
| `npm run check:size` | 只跑包体检查（产物 JS 不超过 300KB） |
| `npm run check:assets` | 只跑素材检查（`assets/icons` 里的物品图标符合 [docs/art-spec.md](docs/art-spec.md)） |
| `npm run build:web` | 构建 Web 产物到 `dist/web/` |
| `npm run build:wechat` / `npm run build:douyin` | 构建微信 / 抖音产物到 `dist/wechat/`、`dist/douyin/`，可直接导入开发者工具（步骤见 [docs/devtools.md](docs/devtools.md)） |
| `npm run smoke` | 浏览器冒烟测试（需要 Chromium：`npx playwright install chromium`）。不在 `npm run check` 里，CI 单独跑 |
| `npm run dev` | 开发：监听改动、起本地服务（端口默认 8000，`PORT=xxxx` 可改） |
| `npm test` | 只跑单元测试 |
| `npm run levels:preview` | 在命令行打印前 10 关的答案网格和物品清单；`-- 30` 看前 30 关，`-- 11-20` 看第 11～20 关 |

## 工作方式

1. **一次只做一个任务**，任务编号以 roadmap 为准。开始前列出要改的文件、验收标准和这次不做什么。
2. **只做任务范围内的事。** 计划外的想法记进 `docs/backlog.md`，不顺手做。
3. 做完跑 `npm run check`，全部通过才提交。一个任务提交一次，提交信息以任务编号开头（如"1.2 关卡生成器"），推送到 `dev` 分支。
4. 在同一次提交里，把 `docs/roadmap.md` 里的这个任务标成 ✅。
5. 停下来汇报：改了什么、验收结果（附命令输出）、下一个任务是什么。**用户说"继续"再做下一个。**
6. 每个阶段结束后，由用户决定是否合并到 `main`。用户没要求就不开 PR。

## 必须先停下来问的情况

遇到下面这些，先停下，向用户说明原因和方案。用户同意后先写 ADR（流程见 architecture.md），再改代码：

- 改分层规则、Platform 接口、Canvas2D 子集
- 改关卡生成的确定性约束（ADR 0003）
- 引入任何依赖：npm 包、新的构建工具、服务器
- 想放宽检查来让代码通过：改 check-arch 的规则、放宽 tsconfig、加 `@ts-ignore`、删除或跳过测试

## 架构规则速查

完整说明见 [docs/architecture.md](docs/architecture.md)，下面每条都有检查拦着。

- 分层：core ← engine ← game ← entry；platform/types.ts 只放接口；平台实现只引用 platform/types.ts。
- 业务层（core、engine、game、platform/types.ts）不直接用 `wx`、`tt`、`GameGlobal`、`window`、`document`、`navigator`、`localStorage`、`sessionStorage`、`globalThis`。平台能力只通过 Platform 接口拿到，由 entry 传进来。
- 画图只用 `Canvas2D` 子集里的方法。
- `src` 里只写 `.ts`，不引用 npm 包、node 内置模块和 `src` 以外的文件。
- 关卡生成必须在所有设备上结果一致：只用 core 自带的种子随机数，不读时间，不用 `Math.pow`、`Math.sin` 这类允许近似的函数（ADR 0003）。
- game 层的逻辑要能在 `test/fake-platform.ts` 的假平台上测试。

## 写法约定

- 代码注释、文档、提交信息、给用户的汇报都用中文。
- 注释写"为什么"，不复述代码在做什么。
- 测试用 `node:test` 和 `node:assert/strict`。测试名用中文写清楚行为，例如"看完广告才给提示"。
