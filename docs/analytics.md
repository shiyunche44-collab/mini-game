# 埋点事件表（roadmap 4.4）

游戏通过 `platform.track(事件名, 字段)` 上报，微信走 `wx.reportEvent`，抖音走 `tt.reportAnalytics`，Web 只在控制台打印。事件名集中在 `src/game/Session.ts` 的 `EVENTS`，**后台是按这些名字配置的，改名等于换了一个新事件**，所以不要随手改。

两个平台只收字符串和数字，布尔值在平台实现里转成 1 / 0（`watched`、`ok`、`available` 这几个字段）。

| 事件 | 什么时候上报 | 字段 |
|---|---|---|
| `level_start` | 开始玩一关（启动时接着玩的那一关、点"下一站"、跳关都算） | `level` |
| `level_complete` | 全部装下的那一刻 | `level`、`hints`（这一局用了几次提示）、`seconds`（这次打开游戏之后玩这一关花的秒数，接着存档玩的关卡不含之前玩过的部分） |
| `level_restart` | 点"重来" | `level` |
| `level_skip` | 看完广告跳关 | `level` |
| `ad_rewarded` | 激励视频放完（提示、跳关都走这个） | `placement`（`hint` 或 `skip`）、`watched`（有没有看完）、`level` |
| `ad_interstitial` | 插屏放完 | `level`（刚通关的关卡） |
| `share_click` | 点登机牌上的分享 | `kind`（`friend` 分享给朋友 / `video` 分享录屏）、`level` |
| `share_video_result` | 分享录屏的结果回来 | `level`、`ok`（玩家有没有分享成功） |
| `sidebar_check` | 启动时问了一次侧边栏能不能用（只有抖音） | `available` |
| `sidebar_click` | 点"加入侧边栏"（只有抖音，且 `available` 为真） | `level` |

## 后台怎么配

- **微信**：小游戏后台"自定义分析"里，事件英文名填上表的事件名，字段名也要一一配上，没配的字段收不到。
- **抖音**：开发者后台的"自定义事件"里同样按事件名和字段配置。
- 各平台对事件数量、字段数量、字段名长度有限制，具体数字我没有查过，配置时如果超了请告诉我，我再合并或精简事件。

## 现在统计不到的

- **玩家从哪进来**（自然进入、分享卡片、侧边栏）：要读启动场景和链接参数，Platform 接口现在拿不到，做的话要先写 ADR（见 [backlog](backlog.md)）。所以"分享带来了多少新玩家""侧边栏带来了多少回访"现在看不出来，只能看到点击次数。
- **没有玩家标识**：平台后台自己会按用户去重，游戏没有另外生成 ID。
