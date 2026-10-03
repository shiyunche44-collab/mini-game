# 0005 Platform 增加音效：游戏层给出"音符"，平台负责发声

- 状态：已采纳
- 日期：2026-10-03

## 背景

- 阶段 5.4 要加音效。游戏层（core、engine、game）不能直接用 `Audio`、`AudioContext`、`wx`、`tt`（[ADR 0002](0002-layering.md)），而 Platform 接口里没有发声的能力。
- 音效文件会增加包体（有 300KB 的 JS 上限，素材另算）、要解决素材来源和版权，三端的音频文件格式、加载方式又各不相同；这些现在都没定。
- 三个平台都有 WebAudio（Web 是 `AudioContext`，微信是 `wx.createWebAudioContext`，抖音预计是 `tt.createWebAudioContext`，**抖音这端没有对照官方文档**），可以用振荡器直接合成简单的"叮""咔哒"。

## 决定

`Platform` 增加一个成员：

```ts
/** 一个音符：从 start 毫秒开始，持续 duration 毫秒，音高从 freq 滑到 endFreq（不写就不滑） */
interface Tone {
  readonly freq: number;
  readonly endFreq?: number;
  readonly start: number;
  readonly duration: number;
  /** 音量 0～1 */
  readonly gain: number;
  readonly wave: 'sine' | 'triangle' | 'square';
}

readonly audio: {
  /** 同时播放一组音符。没有声音能力、被系统静音、出任何错都不抛异常，当作没播。 */
  play(tones: readonly Tone[]): void;
};
```

1. **游戏层只说"播哪几个音符"**，一个音效是一小张音符表（`game/sounds.ts`）。发声交给平台：用振荡器加增益节点合成。
2. **不用音频文件。** 包体几乎不增加，没有版权问题，三个平台用同一张音符表，音色一致。代价是音色朴素（电子音），以后要换成录好的音效，只改平台实现和音符表，游戏层调用不变。
3. **静音在游戏层。** 游戏层记着"是否静音"（存档 key 为 `settings`，和进度分开，不动存档格式），静音时不调用 `audio.play`。平台不需要知道。
4. **平台懒创建音频上下文**，第一次播放时才创建（浏览器要求用户操作之后才能出声），创建失败、接口不存在就永远当作没播。
5. 假平台 `test/fake-platform.ts` 记录每次 `play` 的音符，测试可以检查"这个操作播了哪个音效"。

## 理由

- 只加一个成员、一个函数，是游戏层发声需要的最小集合。
- 音符表是纯数据，游戏层在 node 里就能测"什么时候播什么"，不用真的发声。

## 代价

- 三个平台实现各有一份几乎一样的合成代码（平台实现之间不能互相引用，见 backlog 里"wechat.ts 和 douyin.ts 有大段重复"）。
- 合成音色简单。真机上声音好不好听、会不会爆音、延迟多大，只能在真机上验证。
- 抖音的 `createWebAudioContext` 没有对照官方文档，接口不存在时静默没有声音。

## 什么时候重新考虑

- 需要录好的音效、背景音乐（那时要加载音频文件，要重新看包体和素材来源）。
- 真机上合成音延迟或爆音严重。
