import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { GENERATOR_VERSION, generateLevel } from '../src/core/levels.ts';
import {
  INTERSTITIAL_EVERY,
  INTERSTITIAL_FIRST_LEVEL,
  INTERSTITIAL_MIN_GAP_MS,
  loadProgress,
  MIGRATIONS,
  migrate,
  newProgress,
  nextLevel,
  recordInterstitial,
  resumableGame,
  SAVE_KEY,
  SAVE_VERSION,
  shouldShowInterstitial,
  withGame,
  type Progress,
} from '../src/core/progress.ts';
import { FakePlatform } from './fake-platform.ts';

/** 玩到第 n 关，放了几件物品 */
function halfPlayed(n: number): Game {
  const g = new Game(generateLevel(n));
  g.hint();
  g.hint();
  return g;
}

describe('newProgress：新玩家', () => {
  it('从第 1 关开始，没有进行中的局面，没弹过插屏', () => {
    assert.deepEqual(newProgress(), { version: SAVE_VERSION, level: 1, game: null, lastInterstitialAt: null });
  });
});

describe('loadProgress：读存档', () => {
  it('存下来再读出来，内容一样（经过 JSON 来回）', () => {
    let p = nextLevel(nextLevel(newProgress())); // 第 3 关
    p = withGame(p, halfPlayed(3).snapshot());
    p = recordInterstitial(p, 123456);
    assert.deepEqual(loadProgress(JSON.parse(JSON.stringify(p))), p);
  });

  it('什么都没存过、不是对象、数组：当作新玩家', () => {
    for (const bad of [undefined, null, 42, 'abc', true, [], [1, 2]]) {
      assert.deepEqual(loadProgress(bad), newProgress(), String(JSON.stringify(bad)));
    }
  });

  it('空对象、版本号不对：只能看懂关卡号时保留关卡号，否则从第 1 关开始', () => {
    assert.deepEqual(loadProgress({}), newProgress());
    assert.deepEqual(loadProgress({ level: 9 }), { ...newProgress(), level: 9 });
    assert.deepEqual(loadProgress({ version: 0, level: 9 }), { ...newProgress(), level: 9 });
    assert.deepEqual(loadProgress({ version: 'x', level: 9 }), { ...newProgress(), level: 9 });
    assert.deepEqual(loadProgress({ version: 1.5, level: 9 }), { ...newProgress(), level: 9 });
  });

  it('关卡号不对：从第 1 关开始', () => {
    for (const level of [0, -3, 2.5, '7', null, NaN, Infinity, 2 ** 60]) {
      assert.equal(loadProgress({ version: SAVE_VERSION, level }).level, 1, String(level));
    }
    assert.equal(loadProgress({ version: SAVE_VERSION, level: 250 }).level, 250);
  });

  it('进行中的局面外形不对：丢掉这一局，关卡号保留', () => {
    const snapshot = halfPlayed(4).snapshot();
    const base = { version: SAVE_VERSION, level: 4, lastInterstitialAt: null };
    const bad: unknown[] = [
      'x',
      42,
      [],
      { generator: GENERATOR_VERSION },
      { snapshot },
      { generator: '1', snapshot },
      { generator: 1.5, snapshot },
      { generator: GENERATOR_VERSION, snapshot: 'x' },
      { generator: GENERATOR_VERSION, snapshot: { ...snapshot, n: 5 } }, // 不是这一关的
      { generator: GENERATOR_VERSION, snapshot: { hints: 0, pieces: [] } },
    ];
    for (const game of bad) {
      const p = loadProgress({ ...base, game });
      assert.equal(p.game, null, JSON.stringify(game));
      assert.equal(p.level, 4);
    }
  });

  it('上次弹插屏的时间不对：当作没弹过', () => {
    for (const at of [-1, NaN, Infinity, '100', {}, undefined]) {
      assert.equal(loadProgress({ version: SAVE_VERSION, level: 1, lastInterstitialAt: at }).lastInterstitialAt, null, String(at));
    }
    assert.equal(loadProgress({ version: SAVE_VERSION, level: 1, lastInterstitialAt: 0 }).lastInterstitialAt, 0);
  });

  it('多余的字段不会带进来', () => {
    const p = loadProgress({ version: SAVE_VERSION, level: 2, coins: 999, game: null, lastInterstitialAt: null });
    assert.deepEqual(Object.keys(p).sort(), ['game', 'lastInterstitialAt', 'level', 'version']);
  });

  it('读出来的是新对象：改读到的原始数据不会影响 Progress 的顶层字段', () => {
    const raw = { version: SAVE_VERSION, level: 3, game: null, lastInterstitialAt: null };
    const p = loadProgress(raw);
    raw.level = 99;
    assert.equal(p.level, 3);
  });
});

describe('loadProgress：版本迁移', () => {
  // 假设以后存档格式升到第 3 版：第 1 版没有 coins，第 2 版加了 coins，第 3 版把 coins 改名成 stars
  const migrations = {
    1: (old: Record<string, unknown>) => ({ ...old, coins: 0 }),
    2: (old: Record<string, unknown>) => {
      const { coins, ...rest } = old;
      return { ...rest, stars: coins };
    },
  };

  it('migrate：从旧版本一步步升到目标版本，每步之后版本号加 1', () => {
    const out = migrate({ version: 1, level: 5 }, migrations, 3);
    assert.deepEqual(out, { version: 3, level: 5, stars: 0 });
  });

  it('migrate：已经是目标版本就原样返回；缺少某一步时抛错', () => {
    const cur = { version: 3, level: 5 };
    assert.equal(migrate(cur, migrations, 3), cur);
    assert.throws(() => migrate({ version: 1 }, { 2: (o) => o }, 3), /没有从第 1 版存档升级的方法/);
  });

  it('现在只有第 1 版，没有要迁移的', () => {
    assert.equal(SAVE_VERSION, 1);
    assert.deepEqual(MIGRATIONS, {});
  });

  it('旧版本的存档读进来：先迁移再检查，关卡号和进行中的局面都保留', () => {
    const snapshot = halfPlayed(5).snapshot();
    const old = { version: 1, level: 5, game: { generator: GENERATOR_VERSION, snapshot }, lastInterstitialAt: 900 };
    const p = loadProgress(old, migrations, 3);
    assert.deepEqual(p, { version: 3, level: 5, game: old.game, lastInterstitialAt: 900 });
    assert.equal(loadProgress({ ...old, version: 2 }, migrations, 3).version, 3);
  });

  it('迁移过程中出错：只保留关卡号，不报错', () => {
    const boom = { 1: () => { throw new Error('坏了'); } };
    const p = loadProgress({ version: 1, level: 6, game: { generator: 1, snapshot: halfPlayed(6).snapshot() } }, boom, 2);
    assert.deepEqual(p, { ...newProgress(), level: 6 });
    // 缺少某一步也一样
    assert.deepEqual(loadProgress({ version: 1, level: 6 }, {}, 2), { ...newProgress(), level: 6 });
  });

  it('比当前版本新（玩家退回了旧版本的游戏）：看不懂格式，只保留关卡号，不报错', () => {
    const p = loadProgress({ version: SAVE_VERSION + 1, level: 40, game: { weird: true }, lastInterstitialAt: 5, stars: 3 });
    assert.deepEqual(p, { ...newProgress(), level: 40 });
    assert.deepEqual(loadProgress({ version: 4, level: 8 }, migrations, 3), { ...newProgress(), level: 8 });
  });
});

describe('withGame / nextLevel / resumableGame', () => {
  it('存下进行中的局面，记下现在的生成器版本；原来的 Progress 不变', () => {
    const p = newProgress();
    const snap = halfPlayed(1).snapshot();
    const q = withGame(p, snap);
    assert.deepEqual(q.game, { generator: GENERATOR_VERSION, snapshot: snap });
    assert.equal(p.game, null);
  });

  it('快照不是这一关的：抛错（调用方写错了）', () => {
    assert.throws(() => withGame(newProgress(), halfPlayed(2).snapshot()), RangeError);
  });

  it('进入下一关：关卡号加一，清掉进行中的局面，别的不动', () => {
    const p = recordInterstitial(withGame(newProgress(), halfPlayed(1).snapshot()), 777);
    const q = nextLevel(p);
    assert.equal(q.level, 2);
    assert.equal(q.game, null);
    assert.equal(q.lastInterstitialAt, 777);
    assert.equal(p.level, 1);
  });

  it('能接着玩：存档里的局面可以直接恢复到 Game 里', () => {
    const g = halfPlayed(7);
    let p = newProgress();
    for (let i = 1; i < 7; i++) p = nextLevel(p);
    p = withGame(p, g.snapshot());
    const snap = resumableGame(loadProgress(JSON.parse(JSON.stringify(p))));
    assert.ok(snap);
    const again = new Game(generateLevel(7));
    assert.equal(again.restore(snap), true);
    assert.deepEqual(again.snapshot(), g.snapshot());
  });

  it('生成器版本对不上：这一关重新开始（ADR 0003）', () => {
    const p = withGame(newProgress(), halfPlayed(1).snapshot());
    assert.ok(resumableGame(p));
    const old = { ...p, game: { ...p.game!, generator: GENERATOR_VERSION - 1 } };
    assert.equal(resumableGame(old), null);
    const newer = { ...p, game: { ...p.game!, generator: GENERATOR_VERSION + 1 } };
    assert.equal(resumableGame(newer), null);
    assert.equal(resumableGame(newProgress()), null);
  });

  it('版本对不上的存档读进来后关卡号还在，只是不能接着玩', () => {
    const p = withGame(nextLevel(newProgress()), halfPlayed(2).snapshot());
    const stale = loadProgress(JSON.parse(JSON.stringify({ ...p, game: { ...p.game!, generator: 0 } })));
    assert.equal(stale.level, 2);
    assert.equal(resumableGame(stale), null);
  });
});

describe('插屏广告的频率', () => {
  const at = (lastInterstitialAt: number | null): Progress => ({ ...newProgress(), lastInterstitialAt });
  const GAP = INTERSTITIAL_MIN_GAP_MS;

  it('规则常量：第 5 关起，每 3 关一次，至少隔 90 秒', () => {
    assert.equal(INTERSTITIAL_FIRST_LEVEL, 5);
    assert.equal(INTERSTITIAL_EVERY, 3);
    assert.equal(GAP, 90_000);
  });

  it('通关第 5、8、11、14…… 关轮到弹，其余不弹（从没弹过时）', () => {
    const due = Array.from({ length: 30 }, (_, i) => i + 1).filter((n) => shouldShowInterstitial(newProgress(), n, 1_000_000));
    assert.deepEqual(due, [5, 8, 11, 14, 17, 20, 23, 26, 29]);
    assert.equal(shouldShowInterstitial(newProgress(), 302, 1_000_000), true);
    assert.equal(shouldShowInterstitial(newProgress(), 303, 1_000_000), false);
  });

  it('离上次不足 90 秒不弹；够 90 秒就弹', () => {
    assert.equal(shouldShowInterstitial(at(1_000_000), 5, 1_000_000 + GAP - 1), false);
    assert.equal(shouldShowInterstitial(at(1_000_000), 5, 1_000_000 + GAP), true);
    assert.equal(shouldShowInterstitial(at(1_000_000), 5, 1_000_000), false);
  });

  it('这次被频率挡掉就不弹了，不往后顺延到下一关', () => {
    const p = at(1_000_000);
    assert.equal(shouldShowInterstitial(p, 5, 1_000_000 + 10_000), false);
    assert.equal(shouldShowInterstitial(p, 6, 1_000_000 + 20_000), false); // 第 6 关本来就不轮到
    assert.equal(shouldShowInterstitial(p, 7, 1_000_000 + GAP * 2), false);
  });

  it('系统时间被往回调过：当作间隔够了，不会一直弹不出来', () => {
    assert.equal(shouldShowInterstitial(at(9_000_000), 5, 1_000), true);
  });

  it('记下弹过的时间以后，在 90 秒内又轮到时不弹', () => {
    let p = newProgress();
    assert.equal(shouldShowInterstitial(p, 5, 500_000), true);
    p = recordInterstitial(p, 500_000);
    assert.equal(p.lastInterstitialAt, 500_000);
    assert.equal(shouldShowInterstitial(p, 8, 500_000 + 60_000), false); // 玩得很快，3 关只用了 1 分钟
    assert.equal(shouldShowInterstitial(p, 8, 500_000 + 120_000), true);
  });

  it('参数不对时抛错：关卡号不是正整数，时间不是不小于 0 的有限数', () => {
    for (const bad of [0, -5, 1.5, NaN]) assert.throws(() => shouldShowInterstitial(newProgress(), bad, 0), RangeError, String(bad));
    for (const bad of [-1, NaN, Infinity]) {
      assert.throws(() => shouldShowInterstitial(newProgress(), 5, bad), RangeError, String(bad));
      assert.throws(() => recordInterstitial(newProgress(), bad), RangeError, String(bad));
    }
  });
});

describe('和假平台的存储配合', () => {
  it('存进 storage 再读出来：关卡号、局面、插屏时间都在，局面能接着玩', () => {
    const platform = new FakePlatform();
    const g = halfPlayed(3);
    let p = nextLevel(nextLevel(newProgress()));
    p = recordInterstitial(withGame(p, g.snapshot()), 42_000);
    platform.storage.set(SAVE_KEY, p);

    const back = loadProgress(platform.storage.get<unknown>(SAVE_KEY, null));
    assert.deepEqual(back, p);
    const resumed = new Game(generateLevel(back.level));
    assert.equal(resumed.restore(resumableGame(back)), true);
    assert.deepEqual(resumed.snapshot(), g.snapshot());
  });

  it('没存过：读到新玩家', () => {
    assert.deepEqual(loadProgress(new FakePlatform().storage.get<unknown>(SAVE_KEY, null)), newProgress());
  });

  it('存档文本损坏：storage 给回默认值，读到新玩家，不会抛错', () => {
    const platform = new FakePlatform();
    platform.setRawStorage(SAVE_KEY, '{"version":1,"level":');
    assert.deepEqual(loadProgress(platform.storage.get<unknown>(SAVE_KEY, null)), newProgress());
  });
});
