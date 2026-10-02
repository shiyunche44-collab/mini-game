// 可复现的随机数：同一关每次生成的布局都一样
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 按权重随机排序（权重越大越靠前），权重为 0 的直接丢掉
export function weightedOrder(items, weightOf, rng) {
  return items
    .map((it) => ({ it, w: weightOf(it) }))
    .filter((e) => e.w > 0)
    .map((e) => ({ it: e.it, k: Math.pow(rng(), 1 / e.w) }))
    .sort((a, b) => b.k - a.k)
    .map((e) => e.it);
}
