// 音效开关和播放。静音在游戏层（ADR 0005）：静音时不调用 platform.audio，平台不需要知道。
// 静音状态存在自己的 key 里，和进度分开：不动存档格式，读坏了也不影响进度。
import type { Platform } from '../platform/types.ts';
import { SOUNDS, type SoundName } from './sounds.ts';

export const SETTINGS_KEY = 'settings';

export class Sfx {
  private readonly platform: Pick<Platform, 'audio' | 'storage'>;
  private mutedNow: boolean;

  constructor(platform: Pick<Platform, 'audio' | 'storage'>) {
    this.platform = platform;
    // 存的东西什么样都不能崩：只认 { muted: true }
    const raw = platform.storage.get<unknown>(SETTINGS_KEY, null);
    this.mutedNow = typeof raw === 'object' && raw !== null && (raw as { muted?: unknown }).muted === true;
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  play(name: SoundName): void {
    if (!this.mutedNow) this.platform.audio.play(SOUNDS[name]);
  }

  /** 切换静音并存下来。从静音切回有声时响一下，让玩家知道声音开了 */
  toggle(): void {
    this.mutedNow = !this.mutedNow;
    this.platform.storage.set(SETTINGS_KEY, { muted: this.mutedNow });
    this.play('tap');
  }
}
