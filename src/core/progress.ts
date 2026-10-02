// 存档模型：玩到第几关、进行中的那一局、上次弹插屏的时间。
// 只管数据和规则，不碰平台：读写 platform.storage 由 game 层做，把读出来的值交给 loadProgress，
// 把 Progress 交给 storage.set（它是纯数据，可以直接 JSON 序列化）。
// core 里没有时钟，所以需要"现在几点"的函数都由调用方传 now（毫秒时间戳）。
import type { Snapshot } from './game.ts';
import { GENERATOR_VERSION } from './levels.ts';

/** 存档在 platform.storage 里的 key */
export const SAVE_KEY = 'progress';

/** 存档格式的版本。存档的字段变了就加 1，并在 MIGRATIONS 里补一步迁移 */
export const SAVE_VERSION = 1;

/** 进行中的那一局，连同它是哪个版本的生成器生成的（ADR 0003：版本对不上，这一关要重新开始） */
export interface SavedGame {
  readonly generator: number;
  readonly snapshot: Snapshot;
}

export interface Progress {
  readonly version: number;
  /** 现在要玩的关卡，从 1 开始 */
  readonly level: number;
  /** 这一关进行到一半的局面；没开始或者刚过关是 null */
  readonly game: SavedGame | null;
  /** 上次弹插屏广告的时间（毫秒时间戳）；从没弹过是 null */
  readonly lastInterstitialAt: number | null;
}

export function newProgress(): Progress {
  return { version: SAVE_VERSION, level: 1, game: null, lastInterstitialAt: null };
}

// ---------------------------------------------------------------------------
// 读：迁移和校验
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

/**
 * 旧格式升级到下一个版本。键是旧版本号，函数把这个版本的存档变成"版本号加 1"的格式。
 * 现在只有第 1 版，所以是空的；以后改了字段就在这里加一步，不要改已有的步骤。
 */
export const MIGRATIONS: Readonly<Record<number, (old: Raw) => Raw>> = {};

/** 一步步升级到 target 版本。缺少某一步迁移时抛错 */
export function migrate(raw: Raw, migrations: Readonly<Record<number, (old: Raw) => Raw>>, target: number): Raw {
  let cur = raw;
  for (let v = cur.version as number; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`没有从第 ${v} 版存档升级的方法`);
    cur = { ...step(cur), version: v + 1 };
  }
  return cur;
}

const isLevel = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 1;

/**
 * 把 storage 里读出来的东西变成可信的 Progress。读出来的可能是任何东西（没有存过、损坏、旧版本、被改过、
 * 更新版本的游戏写的），所以这个函数不会抛错，能留下的进度尽量留下：
 * - 不是对象：当作新玩家，从第 1 关开始
 * - 旧版本：先迁移再检查；迁移出错就只保留关卡号
 * - 比当前版本新（玩家退回了旧版本的游戏）：看不懂它的格式，只保留关卡号
 * - 关卡号不对：从第 1 关开始；进行中的局面不对：丢掉这一局，关卡号保留
 */
export function loadProgress(
  data: unknown,
  migrations: Readonly<Record<number, (old: Raw) => Raw>> = MIGRATIONS,
  target: number = SAVE_VERSION, // 后两个参数只给测试用：现在只有第 1 版，迁移这条路径不传参数就走不到
): Progress {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return newProgress();
  let raw = data as Raw;

  const salvaged = (): Progress => ({ ...newProgress(), level: isLevel(raw.level) ? raw.level : 1 });
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > target) {
    return salvaged();
  }
  try {
    raw = migrate(raw, migrations, target);
  } catch {
    return salvaged();
  }

  const level = isLevel(raw.level) ? raw.level : 1;
  const at = raw.lastInterstitialAt;
  return {
    version: target,
    level,
    game: readGame(raw.game, level),
    lastInterstitialAt: typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : null,
  };
}

// 这里只看外形；局面本身合不合法由 Game.restore 逐项检查
function readGame(x: unknown, level: number): SavedGame | null {
  if (typeof x !== 'object' || x === null) return null;
  const { generator, snapshot } = x as Raw;
  if (!Number.isSafeInteger(generator) || typeof snapshot !== 'object' || snapshot === null) return null;
  if ((snapshot as Partial<Snapshot>).n !== level) return null;
  return { generator: generator as number, snapshot: snapshot as Snapshot };
}

// ---------------------------------------------------------------------------
// 改：每个函数返回新的 Progress，不改传进来的
// ---------------------------------------------------------------------------

/** 存下进行中的这一局 */
export function withGame(p: Progress, snapshot: Snapshot): Progress {
  if (snapshot.n !== p.level) throw new RangeError(`快照是第 ${snapshot.n} 关的，现在要玩的是第 ${p.level} 关`);
  return { ...p, game: { generator: GENERATOR_VERSION, snapshot } };
}

/** 进入下一关，清掉进行中的局面。过关和跳关都用它 */
export function nextLevel(p: Progress): Progress {
  return { ...p, level: p.level + 1, game: null };
}

/**
 * 能接着玩的那一局。没有存过、或者存的时候生成器的版本和现在不同（同一个关卡号现在会生成不一样的关卡）时
 * 返回 null，这一关重新开始。
 */
export function resumableGame(p: Progress): Snapshot | null {
  return p.game !== null && p.game.generator === GENERATOR_VERSION ? p.game.snapshot : null;
}

// ---------------------------------------------------------------------------
// 插屏广告的频率
// ---------------------------------------------------------------------------

/** 从通关第几关开始弹 */
export const INTERSTITIAL_FIRST_LEVEL = 5;
/** 之后每隔几关弹一次 */
export const INTERSTITIAL_EVERY = 3;
/** 两次插屏至少隔多久（毫秒）。不够就这一次不弹，不往后顺延 */
export const INTERSTITIAL_MIN_GAP_MS = 90_000;

/**
 * 通关了第 clearedLevel 关，接下来要不要弹插屏。
 * 第 5、8、11…… 关通关后轮到弹，但离上一次不足 INTERSTITIAL_MIN_GAP_MS 就不弹。
 * 系统时间被往回调过（now 比上次还早）时当作间隔够了：否则上次的时间在未来，会一直弹不出来。
 * 只有通关该问，跳关是看完激励视频换来的，紧接着再弹插屏会很烦，调用方不要在跳关后问。
 */
export function shouldShowInterstitial(p: Progress, clearedLevel: number, now: number): boolean {
  if (!isLevel(clearedLevel)) throw new RangeError(`关卡号必须是从 1 开始的整数，收到 ${clearedLevel}`);
  if (!Number.isFinite(now) || now < 0) throw new RangeError(`时间必须是不小于 0 的数，收到 ${now}`);
  if (clearedLevel < INTERSTITIAL_FIRST_LEVEL || (clearedLevel - INTERSTITIAL_FIRST_LEVEL) % INTERSTITIAL_EVERY !== 0) {
    return false;
  }
  const last = p.lastInterstitialAt;
  return last === null || now < last || now - last >= INTERSTITIAL_MIN_GAP_MS;
}

/** 记下刚弹过一次插屏 */
export function recordInterstitial(p: Progress, now: number): Progress {
  if (!Number.isFinite(now) || now < 0) throw new RangeError(`时间必须是不小于 0 的数，收到 ${now}`);
  return { ...p, lastInterstitialAt: now };
}
