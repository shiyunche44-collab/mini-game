import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng, shuffle, weightedOrder } from '../src/core/rng.ts';

function take(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

describe('createRng', () => {
  it('同一个种子给出同一串数', () => {
    assert.deepEqual(take(createRng(123), 50), take(createRng(123), 50));
  });

  it('不同种子给出不同的数', () => {
    assert.notDeepEqual(take(createRng(1), 5), take(createRng(2), 5));
  });

  it('序列固定不变：改了算法关卡就全变了（ADR 0003）', () => {
    assert.deepEqual(take(createRng(1), 5), [
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849,
    ]);
    assert.deepEqual(take(createRng(0), 3), [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]);
  });

  it('每个数都在 [0, 1) 里，平均数接近 0.5', () => {
    const xs = take(createRng(7), 10000);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    assert.ok(Math.abs(mean - 0.5) < 0.02, `平均数 ${mean}`);
  });

  it('种子按 32 位无符号整数处理：负数、超过 2^32、小数', () => {
    assert.deepEqual(take(createRng(-1), 5), take(createRng(4294967295), 5));
    assert.deepEqual(take(createRng(2 ** 32 + 5), 5), take(createRng(5), 5));
    assert.deepEqual(take(createRng(1.5), 5), take(createRng(1), 5));
  });
});

describe('shuffle', () => {
  it('原地洗牌，返回同一个数组，元素不增不减', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = shuffle(arr, createRng(42));
    assert.equal(out, arr);
    assert.deepEqual([...arr].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('同一个种子结果一样，且固定不变', () => {
    assert.deepEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], createRng(42)), [1, 8, 4, 6, 3, 2, 9, 10, 5, 7]);
  });

  it('空数组和一个元素的数组不会出错，也不消耗随机数', () => {
    const rng = createRng(1);
    assert.deepEqual(shuffle([], rng), []);
    assert.deepEqual(shuffle(['a'], rng), ['a']);
    assert.equal(rng(), 0.6270739405881613);
  });

  it('三个元素的 6 种排列都会出现，次数大致均匀', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 6000; seed++) {
      const k = shuffle(['a', 'b', 'c'], createRng(seed)).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    assert.equal(counts.size, 6);
    for (const [k, n] of counts) assert.ok(n > 800 && n < 1200, `${k} 出现 ${n} 次`);
  });
});

describe('weightedOrder', () => {
  const weights: Record<string, number> = { a: 1, b: 2, c: 0, d: 4 };
  const w = (x: string) => weights[x] ?? 0;

  it('权重为 0 的丢掉，其余都在，不改动传进来的数组', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = weightedOrder(input, w, createRng(5));
    assert.deepEqual([...out].sort(), ['a', 'b', 'd']);
    assert.deepEqual(input, ['a', 'b', 'c', 'd']);
  });

  it('同一个种子结果一样，且固定不变', () => {
    assert.deepEqual(weightedOrder(['a', 'b', 'c', 'd'], w, createRng(42)), ['d', 'b', 'a']);
    assert.deepEqual(weightedOrder(['a', 'b', 'c', 'd'], w, createRng(42)), ['d', 'b', 'a']);
  });

  it('权重越大越容易排第一，比例等于权重占比', () => {
    const first = new Map<string, number>();
    const N = 14000;
    for (let seed = 0; seed < N; seed++) {
      const k = weightedOrder(['a', 'b', 'c', 'd'], w, createRng(seed))[0] as string;
      first.set(k, (first.get(k) ?? 0) + 1);
    }
    // 权重 1:2:4，占比 1/7、2/7、4/7
    for (const [k, share] of [['a', 1 / 7], ['b', 2 / 7], ['d', 4 / 7]] as const) {
      const got = (first.get(k) ?? 0) / N;
      assert.ok(Math.abs(got - share) < 0.02, `${k}：期望 ${share}，实际 ${got}`);
    }
    assert.equal(first.get('c'), undefined);
  });

  it('每个权重大于 0 的物品用掉一个随机数', () => {
    const rng = createRng(9);
    weightedOrder(['a', 'b', 'c', 'd'], w, rng);
    const after = rng();
    const ref = createRng(9);
    take(ref, 3);
    assert.equal(after, ref());
  });

  it('空数组、全是 0 权重都返回空数组，不消耗随机数', () => {
    const rng = createRng(1);
    assert.deepEqual(weightedOrder([], () => 1, rng), []);
    assert.deepEqual(weightedOrder(['x', 'y'], () => 0, rng), []);
    assert.equal(rng(), 0.6270739405881613);
  });

  it('随机数取到最大值附近也不会越界', () => {
    const almostOne = () => 1 - 2 ** -53;
    assert.deepEqual(weightedOrder(['a', 'b', 'c'], () => 1, almostOne), ['c', 'b', 'a']);
    assert.deepEqual(weightedOrder(['a', 'b', 'c'], () => 1, () => 0), ['a', 'b', 'c']);
  });

  it('权重是负数、NaN、无穷大时抛错', () => {
    for (const bad of [-1, NaN, Infinity]) {
      assert.throws(() => weightedOrder(['a'], () => bad, createRng(1)), RangeError);
    }
  });
});
