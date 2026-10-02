// 一次游戏的整体流程：读存档、玩当前这一关、过关、下一站。
// PlayScene 管一关之内的画面和操作，WinOverlay 管过关画面，这里管它们之间怎么衔接，以及存档和广告。
//
// 按钮：重来免费；提示和跳关要看完激励视频，看完（rewarded 返回 true）才给，中途关闭、加载失败都不给。
// 跳关之后不弹插屏：跳关是看完广告换来的，紧接着再弹一个插屏很烦（见 core/progress.ts）。
//
// 存档（key 是 SAVE_KEY）：
// - 摆放、取出、旋转之后，把进行中的局面存下来，随时退出都能接着玩
// - 全部装下的那一刻就存"下一关"，不等玩家点"下一站"：登机牌上退出也不会白玩
// - 存档读出来什么样都不会崩：坏了就从头开始，局面对不上这一关就丢掉这一局（见 core/progress.ts）
import { Game } from '../core/game.ts';
import { generateLevel } from '../core/levels.ts';
import {
  loadProgress,
  newProgress,
  nextLevel,
  recordInterstitial,
  resumableGame,
  SAVE_KEY,
  shouldShowInterstitial,
  withGame,
  type Progress,
} from '../core/progress.ts';
import type { DragEvent, GestureHandlers } from '../engine/input.ts';
import type { Platform } from '../platform/types.ts';
import { PlayScene, type ButtonKind } from './PlayScene.ts';
import { WinOverlay } from './WinOverlay.ts';

export interface SessionOptions {
  /** 调试用：直接玩第几关。不读也不写存档，进度只在这次打开里有效 */
  level?: number;
  /** 调试用：开局先用掉几次提示，用来看箱子里摆了东西的样子。全摆完就直接进入过关画面 */
  hints?: number;
}

type SessionPlatform = Pick<Platform, 'ctx' | 'screen' | 'storage' | 'ads' | 'now'>;

export class Session implements GestureHandlers {
  private readonly platform: SessionPlatform;
  /** false 时不读不写存档（调试用） */
  private readonly persist: boolean;
  private progress: Progress;
  private scene: PlayScene;
  private win: WinOverlay | null = null;
  /** 正在等插屏广告放完：这期间不响应触摸 */
  private busy = false;

  constructor(platform: SessionPlatform, options: SessionOptions = {}) {
    this.platform = platform;
    this.persist = options.level === undefined;
    this.progress =
      options.level === undefined
        ? loadProgress(platform.storage.get(SAVE_KEY, null))
        : { ...newProgress(), level: options.level };

    const game = this.newGame();
    for (let i = 0; i < (options.hints ?? 0); i++) game.hint();
    this.scene = this.makeScene(game);
    if (game.isComplete()) this.onComplete();
  }

  /** 现在玩的这一关 */
  get current(): PlayScene {
    return this.scene;
  }

  /** 过关画面，没在过关就是 null */
  get winOverlay(): WinOverlay | null {
    return this.win;
  }

  get saved(): Progress {
    return this.progress;
  }

  update(dtMs: number): void {
    this.scene.update(dtMs);
    this.win?.update(dtMs);
  }

  render(): void {
    this.scene.render();
    this.win?.render();
  }

  // -------------------------------------------------------------------------
  // 触摸：过关画面出现之后只给它，没出现之前给当前这一关
  // -------------------------------------------------------------------------

  tap(x: number, y: number): void {
    if (this.busy) return;
    if (this.win) this.win.tap(x, y);
    else this.scene.tap(x, y);
  }

  dragStart(e: DragEvent): void {
    if (!this.busy && !this.win) this.scene.dragStart(e);
  }

  dragMove(e: DragEvent): void {
    if (!this.busy && !this.win) this.scene.dragMove(e);
  }

  dragEnd(e: DragEvent): void {
    if (!this.busy && !this.win) this.scene.dragEnd(e);
  }

  dragCancel(): void {
    if (!this.busy && !this.win) this.scene.dragCancel();
  }

  // -------------------------------------------------------------------------
  // 流程
  // -------------------------------------------------------------------------

  /** 当前进度这一关的一局：有能接着玩的存档就恢复，否则从头开始 */
  private newGame(): Game {
    const fresh = (): Game => new Game(generateLevel(this.progress.level));
    const game = fresh();
    const snapshot = resumableGame(this.progress);
    if (snapshot && game.restore(snapshot)) {
      // 存的是已经装满的局面（正常不会出现）：恢复出来就直接过关了，不如这一关重新开始
      return game.isComplete() ? fresh() : game;
    }
    return game;
  }

  private makeScene(game: Game): PlayScene {
    return new PlayScene(this.platform, game, {
      change: () => this.onChange(),
      complete: () => this.onComplete(),
      button: (kind) => this.onButton(kind),
    });
  }

  private save(): void {
    if (this.persist) this.platform.storage.set(SAVE_KEY, this.progress);
  }

  private onChange(): void {
    this.progress = withGame(this.progress, this.scene.game.snapshot());
    this.save();
  }

  private onComplete(): void {
    const { game, layout } = this.scene;
    const cleared = game.level;
    this.progress = nextLevel(this.progress);
    this.save();
    this.win = new WinOverlay(this.platform, layout, { level: cleared, hintsUsed: game.hintsUsed }, () => {
      void this.advance(cleared.n);
    });
  }

  private onButton(kind: ButtonKind): void {
    if (this.busy) return;
    if (kind === 'restart') this.scene.restart();
    else if (kind === 'hint') void this.requestHint();
    else void this.requestSkip();
  }

  /** 看广告，返回看完没有。看广告期间 busy，不响应触摸，所以回来的时候局面还是点按钮时的样子 */
  private async watchRewarded(placement: 'hint' | 'skip'): Promise<boolean> {
    this.busy = true;
    try {
      return await this.platform.ads.rewarded(placement);
    } finally {
      this.busy = false;
    }
  }

  private async requestHint(): Promise<void> {
    if (await this.watchRewarded('hint')) this.scene.applyHint();
  }

  private async requestSkip(): Promise<void> {
    if (!(await this.watchRewarded('skip'))) return;
    this.progress = nextLevel(this.progress);
    this.save();
    this.scene = this.makeScene(this.newGame());
  }

  /**
   * 点了"下一站"：该弹插屏就先弹，放完再进下一关。
   * 重复点击由 WinOverlay 只响应一次来保证，这里的 busy 只负责广告期间不响应触摸。
   */
  private async advance(clearedLevel: number): Promise<void> {
    this.busy = true;
    try {
      if (shouldShowInterstitial(this.progress, clearedLevel, this.platform.now())) {
        await this.platform.ads.interstitial('between_levels');
        // 放完之后的时间才是"上次弹插屏的时间"
        this.progress = recordInterstitial(this.progress, this.platform.now());
        this.save();
      }
      this.scene = this.makeScene(this.newGame());
      this.win = null;
    } finally {
      this.busy = false;
    }
  }
}
