import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  DESTINATIONS,
  findSolutionProblems,
  GENERATOR_VERSION,
  generateLevel,
  levelConfig,
  type Level,
} from '../src/core/levels.ts';

/** 把一关里决定内容的部分写成纯数据，用来比较和算指纹 */
function plain(l: Level) {
  return {
    n: l.n,
    cols: l.cols,
    rows: l.rows,
    blocked: l.blocked,
    pieces: l.pieces.map((p) => [p.item.id, p.solution.oi, p.solution.r, p.solution.c, p.startOi]),
    tip: l.tip,
    dest: l.dest.code,
    next: l.next.code,
  };
}

function fingerprint(from: number, to: number): string {
  const h = createHash('sha256');
  for (let n = from; n <= to; n++) h.update(JSON.stringify(plain(generateLevel(n))) + '\n');
  return h.digest('hex');
}

describe('levelConfig：难度参数', () => {
  it('前 7 关是手工定的，第 1 关不能旋转，第 6 关开始有拉杆槽', () => {
    const rows = Array.from({ length: 7 }, (_, i) => {
      const c = levelConfig(i + 1);
      return [c.cols, c.rows, c.tier, c.rotate, c.singles, c.blocked];
    });
    assert.deepEqual(rows, [
      [4, 3, 1, false, 0, 0],
      [4, 4, 1, true, 0, 0],
      [4, 5, 2, true, 1, 0],
      [5, 5, 2, true, 1, 0],
      [5, 6, 3, true, 1, 0],
      [5, 6, 3, true, 1, 2],
      [6, 6, 3, true, 1, 1],
    ]);
  });

  it('教学提示只在第 1、2、6 关', () => {
    const withTip = Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => levelConfig(n).tip !== null);
    assert.deepEqual(withTip, [1, 2, 6]);
  });

  it('第 8 关起在 6 档之间循环，单格物品每 3 关少一次', () => {
    const size = (n: number) => {
      const c = levelConfig(n);
      return `${c.cols}x${c.rows}槽${c.blocked}`;
    };
    assert.deepEqual([8, 9, 10, 11, 12, 13].map(size), ['5x6槽1', '6x6槽2', '6x7槽1', '5x5槽0', '6x7槽3', '6x6槽0']);
    assert.deepEqual([14, 15, 16, 17, 18, 19].map(size), [8, 9, 10, 11, 12, 13].map(size));
    assert.deepEqual([8, 9, 10, 11, 12].map((n) => levelConfig(n).singles), [1, 0, 1, 1, 0]);
    assert.ok([8, 100, 5000].every((n) => levelConfig(n).tier === 3 && levelConfig(n).rotate));
  });

  it('关卡号不是从 1 开始的整数时抛错', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 53]) {
      assert.throws(() => levelConfig(bad), RangeError, String(bad));
      assert.throws(() => generateLevel(bad), RangeError, String(bad));
    }
  });
});

describe('generateLevel：每一关都正好铺满', () => {
  it('前 200 关的答案把箱子正好铺满：不出界、不压拉杆槽、不重叠、没有空格', () => {
    for (let n = 1; n <= 200; n++) {
      assert.deepEqual(findSolutionProblems(generateLevel(n)), [], `第 ${n} 关`);
    }
  });

  it('201～2000 关也都能生成，答案也都正确（不会在某一关卡死或抛错）', () => {
    for (let n = 201; n <= 2000; n++) {
      assert.deepEqual(findSolutionProblems(generateLevel(n)), [], `第 ${n} 关`);
    }
  });

  it('物品的总格数 = 箱子格数 - 拉杆槽数', () => {
    for (let n = 1; n <= 200; n++) {
      const l = generateLevel(n);
      const cells = l.pieces.reduce((s, p) => s + p.item.size, 0);
      assert.equal(cells, l.cols * l.rows - l.blocked.length, `第 ${n} 关`);
    }
  });

  it('遵守难度参数：尺寸、拉杆槽数量、单格物品数量、物品档次、旋转', () => {
    for (let n = 1; n <= 200; n++) {
      const cfg = levelConfig(n);
      const l = generateLevel(n);
      const where = `第 ${n} 关`;
      assert.deepEqual([l.cols, l.rows], [cfg.cols, cfg.rows], where);
      assert.equal(l.blocked.length, cfg.blocked, where);
      assert.equal(new Set(l.blocked).size, l.blocked.length, `${where}：拉杆槽不重复`);
      assert.ok(l.pieces.filter((p) => p.item.size === 1).length <= cfg.singles, where);
      assert.ok(l.pieces.every((p) => p.item.tier <= cfg.tier), where);
      assert.equal(l.tip, cfg.tip, where);
      assert.equal(l.rotate, cfg.rotate, where);
      if (!cfg.rotate) assert.ok(l.pieces.every((p) => p.startOi === p.solution.oi), `${where}：不能旋转时一开始就是正确朝向`);
    }
  });

  it('物品不会太少：至少 ceil(可用格数 / 4.5) 件', () => {
    for (let n = 1; n <= 200; n++) {
      const l = generateLevel(n);
      assert.ok(l.pieces.length >= Math.ceil((l.cols * l.rows - l.blocked.length) / 4.5), `第 ${n} 关`);
    }
  });

  it('后面的关卡里，起始朝向和答案朝向会不同（旋转是真的要用）', () => {
    const l = generateLevel(30);
    assert.ok(l.pieces.some((p) => p.startOi !== p.solution.oi));
  });

  it('关卡名按机场三字码轮流：这一关去哪、下一关去哪', () => {
    assert.equal(generateLevel(1).dest.code, 'HGH');
    assert.equal(generateLevel(1).next.code, 'CTU');
    assert.equal(generateLevel(20).dest.code, 'PEK');
    assert.equal(generateLevel(20).next.code, 'HGH');
    assert.equal(generateLevel(21).dest.code, 'HGH');
    assert.equal(new Set(DESTINATIONS.map((d) => d.code)).size, DESTINATIONS.length);
  });
});

describe('generateLevel：同一关号结果一致', () => {
  it('连续生成两次，完全相同', () => {
    for (let n = 1; n <= 200; n++) assert.deepEqual(plain(generateLevel(n)), plain(generateLevel(n)), `第 ${n} 关`);
  });

  it('和生成顺序无关：先生成别的关，再生成这一关，结果不变（没有藏在外面的状态）', () => {
    const alone = plain(generateLevel(37));
    for (let n = 200; n >= 1; n--) generateLevel(n);
    assert.deepEqual(plain(generateLevel(37)), alone);
  });

  it('相邻的关卡不一样', () => {
    for (let n = 8; n <= 60; n++) assert.notDeepEqual(plain(generateLevel(n)).pieces, plain(generateLevel(n + 1)).pieces);
  });
});

describe('generateLevel：指纹（ADR 0003）', () => {
  // 生成器的任何改动，只要让某一关变样，这里就会失败。
  // 如果是有意的改动：把 GENERATOR_VERSION 加 1，更新下面两处，并在提交说明里写清楚为什么。
  // 上线以后再改会让玩家看到的关卡变样，要格外慎重。
  const VERSION = 1;
  const FIRST_200 = '1263e1a160ce2ddcb688df0e5dd9405cfb5ec651d54e50a06ca6103196c1770a';

  it('前三关的内容（给人看的）', () => {
    assert.deepEqual(plain(generateLevel(1)), {
      n: 1,
      cols: 4,
      rows: 3,
      blocked: [],
      pieces: [
        ['boot', 0, 1, 2, 0],
        ['cap', 0, 2, 0, 0],
        ['boot', 2, 0, 2, 2],
        ['books', 0, 0, 0, 0],
      ],
      tip: '把物品拖进箱子，全部装下就能出发',
      dest: 'HGH',
      next: 'CTU',
    });
    assert.deepEqual(plain(generateLevel(2)).pieces, [
      ['boot', 0, 0, 0, 2],
      ['umbrella', 1, 1, 2, 0],
      ['cap', 1, 2, 3, 1],
      ['books', 0, 2, 0, 0],
      ['sneaker', 1, 0, 3, 1],
      ['cap', 0, 0, 1, 0],
    ]);
    assert.deepEqual(plain(generateLevel(6)).blocked, [25, 26]);
  });

  it('前 200 关的指纹没变，版本号和指纹对得上', () => {
    assert.equal(GENERATOR_VERSION, VERSION, '改了生成器要同时改版本号和指纹，见这一组测试开头的说明');
    assert.equal(fingerprint(1, 200), FIRST_200, '前 200 关的内容变了。如果是有意的，见这一组测试开头的说明');
  });
});

describe('generateLevel：速度', () => {
  it('前 200 关每一关生成不超过 50ms', () => {
    // 每关量 3 次取最快的一次：要查的是生成本身的耗时，不是机器偶尔的卡顿
    const slow: string[] = [];
    let worst = 0;
    for (let n = 1; n <= 200; n++) {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t = performance.now();
        generateLevel(n);
        best = Math.min(best, performance.now() - t);
      }
      worst = Math.max(worst, best);
      if (best >= 50) slow.push(`第 ${n} 关 ${best.toFixed(1)}ms`);
    }
    assert.deepEqual(slow, [], `最慢一关 ${worst.toFixed(1)}ms`);
  });
});

describe('findSolutionProblems：能发现错误的答案', () => {
  const base = generateLevel(6); // 有拉杆槽的一关
  const withPieces = (pieces: Level['pieces']): Level => ({ ...base, pieces });
  const first = base.pieces[0] as Level['pieces'][number];

  it('正确的答案没有问题', () => {
    assert.deepEqual(findSolutionProblems(base), []);
  });

  it('少一件物品：有空格没被盖住', () => {
    const problems = findSolutionProblems(withPieces(base.pieces.slice(1)));
    assert.equal(problems.length, first.item.size);
    assert.ok(problems.every((p) => p.includes('没有被盖住')));
  });

  it('多一件重复的物品：重叠', () => {
    const problems = findSolutionProblems(withPieces([...base.pieces, first]));
    assert.equal(problems.length, first.item.size);
    assert.ok(problems.every((p) => p.includes('重叠')));
  });

  it('物品挪出箱子：出界，原来的位置变成空格', () => {
    const moved = { ...first, solution: { ...first.solution, c: first.solution.c + 100 } };
    const problems = findSolutionProblems(withPieces([moved, ...base.pieces.slice(1)]));
    assert.ok(problems.some((p) => p.includes('超出了箱子')));
    assert.ok(problems.some((p) => p.includes('没有被盖住')));
  });

  it('物品压在拉杆槽上', () => {
    const cell = first.solution.r * base.cols + first.solution.c; // 第一件物品占着的一格
    const problems = findSolutionProblems({ ...base, blocked: [...base.blocked, cell] });
    assert.ok(problems.some((p) => p.includes('压在拉杆槽上')));
  });

  it('朝向编号不存在、拉杆槽位置不在箱子里', () => {
    const badOi = { ...first, solution: { ...first.solution, oi: 99 } };
    assert.ok(findSolutionProblems(withPieces([badOi])).some((p) => p.includes('答案朝向 99 不存在')));
    const badStart = { ...first, startOi: -1 };
    assert.ok(findSolutionProblems(withPieces([badStart, ...base.pieces.slice(1)])).some((p) => p.includes('起始朝向')));
    assert.ok(findSolutionProblems({ ...base, blocked: [999] }).some((p) => p.includes('不在箱子里')));
  });
});
