// 可复现的随机数：同一个种子永远给出同一串数，关卡生成靠它保证"同一关所有玩家看到的都一样"。
//
// 这个文件里只用加法、乘法、除法、位运算和 Math.imul、Math.floor。
// 它们的结果在所有 JavaScript 引擎上逐位一致；Math.pow、Math.sin 这类函数规范允许各引擎给出近似值，
// 所以不能用（ADR 0003）。test/core-determinism.test.ts 会检查 core 里没有这类写法。

/** 返回 [0, 1) 里的下一个数 */
export type Rng = () => number;

/** mulberry32。种子会先转成 32 位无符号整数，所以 -1 和 4294967295 是同一个种子。 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 原地洗牌（Fisher-Yates），返回传进来的同一个数组 */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 按权重随机排序，权重越大越可能排在前面；权重为 0 的丢掉。不改动传进来的数组。
 *
 * 做法是每次在剩下的里面按权重抽一个，抽走后再抽下一个。
 * 草稿里用 rng^(1/权重) 排序，分布和这里相同，但要用 Math.pow，换成了不需要幂运算的写法。
 * 每抽一个用掉一个随机数，所以用掉的随机数个数等于权重大于 0 的物品数。
 */
export function weightedOrder<T>(items: readonly T[], weightOf: (item: T) => number, rng: Rng): T[] {
  const pool: { item: T; w: number }[] = [];
  for (const item of items) {
    const w = weightOf(item);
    if (!(w >= 0) || w === Infinity) throw new RangeError(`权重必须是有限的非负数，收到 ${w}`);
    if (w > 0) pool.push({ item, w });
  }

  const out: T[] = [];
  while (pool.length > 0) {
    let total = 0;
    for (const p of pool) total += p.w;
    let x = rng() * total;
    // 最后一个不用比较：浮点误差让 x 略大于剩余权重之和时，也能落在最后一个上
    let k = 0;
    while (k < pool.length - 1 && x >= (pool[k] as { w: number }).w) {
      x -= (pool[k] as { w: number }).w;
      k++;
    }
    out.push((pool.splice(k, 1)[0] as { item: T }).item);
  }
  return out;
}
