// 音效表：每个音效是一小组音符（ADR 0005）。游戏层只说"播哪个"，发声由平台做。
// 全是电子合成音，音量都不大：游戏的声音是点缀，不能盖过玩家自己手机里正在放的东西。
// 音高、时长都是凭感觉定的，真机上听了不顺耳就改这里，不用动别的代码。
import type { Tone } from '../platform/types.ts';

export type SoundName =
  | 'pickup' // 拿起物品
  | 'drop' // 物品落进箱子
  | 'back' // 物品放不下，退回去
  | 'rotate' // 转一下
  | 'nope' // 想转但转不动
  | 'tap' // 点按钮
  | 'hint' // 提示摆好一件
  | 'stamp' // 盖章
  | 'win' // 登机牌出来
  | 'slide'; // 换关

const tone = (
  wave: Tone['wave'],
  freq: number,
  start: number,
  duration: number,
  gain: number,
  endFreq?: number,
): Tone => (endFreq === undefined ? { wave, freq, start, duration, gain } : { wave, freq, endFreq, start, duration, gain });

export const SOUNDS: Readonly<Record<SoundName, readonly Tone[]>> = {
  pickup: [tone('sine', 520, 0, 70, 0.12, 700)],
  drop: [tone('triangle', 392, 0, 90, 0.18), tone('sine', 784, 40, 120, 0.08)],
  back: [tone('sine', 440, 0, 120, 0.1, 300)],
  rotate: [tone('triangle', 500, 0, 90, 0.12, 640)],
  nope: [tone('square', 160, 0, 80, 0.06, 130), tone('square', 160, 110, 80, 0.06, 130)],
  tap: [tone('sine', 600, 0, 50, 0.1)],
  hint: [tone('sine', 880, 0, 100, 0.12), tone('sine', 1320, 90, 160, 0.1)],
  stamp: [tone('square', 120, 0, 160, 0.14, 60), tone('triangle', 200, 0, 140, 0.14, 80)],
  win: [
    tone('triangle', 523, 0, 140, 0.15),
    tone('triangle', 659, 120, 140, 0.15),
    tone('triangle', 784, 240, 140, 0.15),
    tone('triangle', 1047, 360, 320, 0.15),
  ],
  slide: [tone('sine', 300, 0, 220, 0.06, 600)],
};
