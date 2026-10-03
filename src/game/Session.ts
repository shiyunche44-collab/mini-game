// 一次游戏的整体流程：读存档、玩当前这一关、过关、下一站。
// PlayScene 管一关之内的画面和操作，WinOverlay 管过关画面，这里管它们之间怎么衔接，以及存档和广告。
//
// 按钮：重来免费；提示和跳关要看完激励视频，看完（rewarded 返回 true）才给，中途关闭、加载失败都不给。
// 跳关之后不弹插屏：跳关是看完广告换来的，紧接着再弹一个插屏很烦（见 core/progress.ts）。
//
// 埋点（platform.track）：事件名和字段是后台要配的，改名等于换一个事件，所以集中在 EVENTS 里。
// 字段里的 level 都是"这一关的关卡号"；通关事件里的 seconds 是这次打开游戏之后玩这一关花的时间，
// 接着存档玩的关卡不含之前玩过的部分。
//
// 换关：新的一关从右边滑进来，旧的（连同登机牌）向左滑出去，约 0.3 秒；这期间不响应触摸。
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
import { easing, Tweens } from '../engine/tween.ts';
import type { Platform, SharePayload } from '../platform/types.ts';
import type { GuideKind } from './Guide.ts';
import { PlayScene, type ButtonKind } from './PlayScene.ts';
import { Sfx } from './Sfx.ts';
import { WinOverlay } from './WinOverlay.ts';

export interface SessionOptions {
  /** 调试用：直接玩第几关。不读也不写存档，进度只在这次打开里有效 */
  level?: number;
  /** 调试用：开局先用掉几次提示，用来看箱子里摆了东西的样子。全摆完就直接进入过关画面 */
  hints?: number;
}

type SessionPlatform = Pick<
  Platform,
  'ctx' | 'screen' | 'storage' | 'ads' | 'now' | 'share' | 'recorder' | 'sidebar' | 'track' | 'audio'
>;

/** 前几关才有新手引导：之后的关卡玩家早就会了 */
export const GUIDE_LAST_LEVEL = 3;

/** 换关滑动的时长（毫秒）：太短看不出来，太长玩家等着不耐烦 */
export const SLIDE_MS = 300;

/** 正在滑走的旧一关。p 是滑动进度 0～1 */
interface Slide {
  readonly from: PlayScene;
  readonly fromWin: WinOverlay | null;
  p: number;
}

/** 埋点事件名。后台按这些名字配置，不要随手改 */
export const EVENTS = {
  levelStart: 'level_start',
  levelComplete: 'level_complete',
  levelRestart: 'level_restart',
  levelSkip: 'level_skip',
  /** 激励视频放完了：watched 表示玩家有没有看完（提示和跳关都走这个） */
  adRewarded: 'ad_rewarded',
  adInterstitial: 'ad_interstitial',
  /** 点了登机牌上的分享：kind 是 friend（分享给朋友）或 video（分享录屏） */
  shareClick: 'share_click',
  shareVideoResult: 'share_video_result',
  /** 启动时问了一次侧边栏能不能用（只有抖音） */
  sidebarCheck: 'sidebar_check',
  sidebarClick: 'sidebar_click',
} as const;

export class Session implements GestureHandlers {
  private readonly platform: SessionPlatform;
  /** false 时不读不写存档（调试用） */
  private readonly persist: boolean;
  private progress: Progress;
  private scene: PlayScene;
  private win: WinOverlay | null = null;
  private slide: Slide | null = null;
  private readonly tweens = new Tweens();
  private readonly sfx: Sfx;
  /** 正在等插屏广告放完：这期间不响应触摸 */
  private busy = false;
  /** 这一关是什么时候开始玩的（platform.now()），算通关用时 */
  private levelStartedAt = 0;
  /** 平台问过了，当前能放"加入侧边栏"的入口。问是异步的，答案回来之前登机牌不画这个按钮 */
  private sidebarUsable = false;
  /** 这次打开游戏之后，玩家做过哪些引导演示的动作。不存档：重新打开最多多演示一次，换来存档格式不变 */
  private readonly learned = new Set<GuideKind>();

  constructor(platform: SessionPlatform, options: SessionOptions = {}) {
    this.platform = platform;
    this.persist = options.level === undefined;
    this.sfx = new Sfx(platform);
    this.progress =
      options.level === undefined
        ? loadProgress(platform.storage.get(SAVE_KEY, null))
        : { ...newProgress(), level: options.level };

    this.checkSidebar();
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

  /** 正在换关（旧的一关还在滑走）。这期间不响应触摸 */
  get sliding(): boolean {
    return this.slide !== null;
  }

  update(dtMs: number): void {
    this.tweens.update(dtMs);
    this.slide?.from.update(dtMs);
    this.slide?.fromWin?.update(dtMs);
    this.scene.update(dtMs);
    this.win?.update(dtMs);
  }

  render(): void {
    const slide = this.slide;
    if (!slide) {
      this.scene.render();
      this.win?.render();
      return;
    }
    // 两个画面各自画满整个屏幕（背景是同一个渐变），错开一个屏幕宽，接缝处看不出来
    const { ctx, screen } = this.platform;
    // 取整到物理像素：平移到小数像素时，两个画面交界处的边缘会抗锯齿出一条细缝
    const shift = Math.round(screen.width * slide.p * screen.dpr) / screen.dpr;
    ctx.save();
    ctx.translate(-shift, 0);
    slide.from.render();
    slide.fromWin?.render();
    ctx.restore();
    ctx.save();
    ctx.translate(screen.width - shift, 0);
    this.scene.render();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 触摸：过关画面出现之后只给它，没出现之前给当前这一关
  // -------------------------------------------------------------------------

  tap(x: number, y: number): void {
    if (this.busy || this.slide) return;
    if (this.win) this.win.tap(x, y);
    else this.scene.tap(x, y);
  }

  dragStart(e: DragEvent): void {
    if (!this.busy && !this.slide && !this.win) this.scene.dragStart(e);
  }

  dragMove(e: DragEvent): void {
    if (!this.busy && !this.slide && !this.win) this.scene.dragMove(e);
  }

  dragEnd(e: DragEvent): void {
    if (!this.busy && !this.slide && !this.win) this.scene.dragEnd(e);
  }

  dragCancel(): void {
    if (!this.busy && !this.slide && !this.win) this.scene.dragCancel();
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

  /** 启动时问一次，不阻塞游戏：出错、没有这个能力都当作不可用 */
  private checkSidebar(): void {
    const sidebar = this.platform.sidebar;
    if (!sidebar) return;
    sidebar
      .available()
      .catch(() => false)
      .then((usable) => {
        this.sidebarUsable = usable;
        this.platform.track(EVENTS.sidebarCheck, { available: usable });
      });
  }

  private makeScene(game: Game): PlayScene {
    this.levelStartedAt = this.platform.now();
    this.platform.track(EVENTS.levelStart, { level: game.level.n });
    // 每一关开始时录（已经在录就接着录，平台自己处理），通关时停，登机牌上才能分享这一段
    this.platform.recorder?.start();
    return new PlayScene(
      this.platform,
      game,
      {
        change: () => this.onChange(),
        complete: () => this.onComplete(),
        button: (kind) => this.onButton(kind),
        taught: (kind) => void this.learned.add(kind),
        sound: (name) => this.sfx.play(name),
        muted: () => this.sfx.muted,
        toggleSound: () => this.sfx.toggle(),
      },
      this.guideFor(game),
    );
  }

  /**
   * 这一关演示什么：先教旋转（能转的关卡里玩家没转过），再教拖动（没拖过）；都会了就不演示。
   * 第 1 关不能旋转，所以只演示拖动。
   */
  private guideFor(game: Game): GuideKind | null {
    if (game.level.n > GUIDE_LAST_LEVEL) return null;
    if (game.level.rotate && !this.learned.has('rotate')) return 'rotate';
    return this.learned.has('drag') ? null : 'drag';
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
    this.platform.track(EVENTS.levelComplete, {
      level: cleared.n,
      hints: game.hintsUsed,
      seconds: Math.max(0, Math.round((this.platform.now() - this.levelStartedAt) / 1000)),
    });
    const recorder = this.platform.recorder;
    const sidebar = this.sidebarUsable ? this.platform.sidebar : undefined;
    void recorder?.stop().catch(() => undefined);
    this.win = new WinOverlay(this.platform, layout, { level: cleared, hintsUsed: game.hintsUsed }, {
      sound: (name) => this.sfx.play(name),
      next: () => void this.advance(cleared.n),
      share: () => {
        this.platform.track(EVENTS.shareClick, { kind: 'friend', level: cleared.n });
        this.platform.share(shareOf(cleared.n));
      },
      // 分享面板是平台自己的界面，不需要 busy；失败（没录到、玩家取消）时什么都不发生，登机牌还在
      ...(recorder
        ? {
            shareVideo: () => {
              this.platform.track(EVENTS.shareClick, { kind: 'video', level: cleared.n });
              void recorder
                .share()
                .catch(() => false)
                .then((ok) => this.platform.track(EVENTS.shareVideoResult, { level: cleared.n, ok }));
            },
          }
        : {}),
      ...(sidebar
        ? {
            sidebar: () => {
              this.platform.track(EVENTS.sidebarClick, { level: cleared.n });
              sidebar.open();
            },
          }
        : {}),
    });
  }

  private onButton(kind: ButtonKind): void {
    if (this.busy || this.slide) return;
    if (kind === 'restart') {
      this.platform.track(EVENTS.levelRestart, { level: this.scene.game.level.n });
      this.scene.restart();
    } else if (kind === 'hint') void this.requestHint();
    else void this.requestSkip();
  }

  /** 看广告，返回看完没有。看广告期间 busy，不响应触摸，所以回来的时候局面还是点按钮时的样子 */
  private async watchRewarded(placement: 'hint' | 'skip'): Promise<boolean> {
    this.busy = true;
    try {
      const watched = await this.platform.ads.rewarded(placement);
      this.platform.track(EVENTS.adRewarded, { placement, watched, level: this.scene.game.level.n });
      return watched;
    } finally {
      this.busy = false;
    }
  }

  private async requestHint(): Promise<void> {
    if (await this.watchRewarded('hint')) this.scene.applyHint();
  }

  private async requestSkip(): Promise<void> {
    if (!(await this.watchRewarded('skip'))) return;
    this.platform.track(EVENTS.levelSkip, { level: this.scene.game.level.n });
    this.progress = nextLevel(this.progress);
    this.save();
    this.switchScene();
  }

  /** 换成当前进度的这一关：新的从右边滑进来，旧的（带着登机牌）滑出去 */
  private switchScene(): void {
    this.sfx.play('slide');
    const slide: Slide = { from: this.scene, fromWin: this.win, p: 0 };
    this.scene = this.makeScene(this.newGame());
    this.win = null;
    this.slide = slide;
    this.tweens.animate(slide, { p: 1 }, {
      duration: SLIDE_MS,
      ease: easing.easeOutCubic,
      onComplete: () => {
        if (this.slide === slide) this.slide = null;
      },
    });
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
        this.platform.track(EVENTS.adInterstitial, { level: clearedLevel });
        // 放完之后的时间才是"上次弹插屏的时间"
        this.progress = recordInterstitial(this.progress, this.platform.now());
        this.save();
      }
      this.switchScene();
    } finally {
      this.busy = false;
    }
  }
}

/** 分享出去的内容：通关的关卡号放进链接参数，以后（4.4）可以用来统计从哪来 */
function shareOf(clearedLevel: number): SharePayload {
  return { title: `我把第 ${clearedLevel} 关的行李装下了，你能装下吗？`, query: `from=share&level=${clearedLevel}` };
}
