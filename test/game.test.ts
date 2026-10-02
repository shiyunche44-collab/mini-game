import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game, type Snapshot } from '../src/core/game.ts';
import { itemById, type Item } from '../src/core/items.ts';
import { DESTINATIONS, findSolutionProblems, generateLevel, type Level, type Piece } from '../src/core/levels.ts';
import { createRng } from '../src/core/rng.ts';

// ---------------------------------------------------------------------------
// 手工搭的小关卡：边界情况在真实关卡里不一定出现
// ---------------------------------------------------------------------------

function piece(item: Item, oi: number, r: number, c: number, startOi: number): Piece {
  return { item, solution: { oi, r, c }, startOi };
}

function makeLevel(cols: number, rows: number, blocked: number[], rotate: boolean, pieces: Piece[]): Level {
  const level: Level = { n: 1, cols, rows, blocked, rotate, pieces, tip: null, dest: DESTINATIONS[0]!, next: DESTINATIONS[1]! };
  assert.deepEqual(findSolutionProblems(level), [], '手工搭的关卡本身要是对的');
  return level;
}

const boot = itemById('boot');
const sneaker = itemById('sneaker');
const socks = itemById('socks');
const earphones = itemById('earphones');

// 3×2，左上角是拉杆槽。登山靴转两下（orient 2）占 (0,1)(0,2)(1,2)，运动鞋横着占 (1,0)(1,1)
//   # B B
//   A A B
const small = () =>
  makeLevel(3, 2, [0], true, [piece(boot, 2, 0, 1, 0), piece(sneaker, 0, 1, 0, 1)]);

// 3×2，两只登山靴朝向不同，不能旋转。A 占 (0,0)(1,0)(1,1)，B 占 (0,1)(0,2)(1,2)
//   A B B
//   A A B
const twoBoots = () =>
  makeLevel(3, 2, [], false, [piece(boot, 0, 0, 0, 0), piece(boot, 2, 0, 1, 2)]);

// 和 small 一样的箱子，但小件排在前面：提示该先摆大件，和物品的顺序无关
const smallReversed = () =>
  makeLevel(3, 2, [0], true, [piece(sneaker, 0, 1, 0, 1), piece(boot, 2, 0, 1, 0)]);

// 2×2，两只运动鞋：谁在上谁在下都行
const twin = () => makeLevel(2, 2, [], true, [piece(sneaker, 0, 0, 0, 1), piece(sneaker, 0, 1, 0, 1)]);

// 2×1，袜子和耳机都是单格，只有一个朝向
const singles = () => makeLevel(2, 1, [], true, [piece(socks, 0, 0, 0, 0), piece(earphones, 0, 0, 1, 0)]);

/** 把物品按答案全部摆好 */
function solve(g: Game): void {
  g.level.pieces.forEach((p, id) => assert.ok(g.place(id, p.solution.r, p.solution.c, p.solution.oi), `第 ${id} 件`));
}

/** 画面层看到的状态和规则内部的占格要一致：没有多占、漏占，拉杆槽没被动过 */
function assertConsistent(g: Game): void {
  const { cols, rows, blocked } = g.level;
  let covered = 0;
  for (const p of g.pieces) {
    if (!p.pos) continue;
    for (const [dr, dc] of p.item.orients[p.oi]!.cells) {
      assert.equal(g.pieceAt(p.pos.r + dr, p.pos.c + dc), p.id, `第 ${p.id} 件的格子`);
      assert.ok(!g.isBlocked(p.pos.r + dr, p.pos.c + dc));
      covered++;
    }
  }
  let occupied = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g.pieceAt(r, c) !== null) occupied++;
  assert.equal(occupied, covered, '有格子被占着，但没有物品声称占了它');
  for (const i of blocked) assert.ok(g.isBlocked(Math.floor(i / cols), i % cols));
  assert.equal(g.remaining, g.pieces.filter((p) => !p.pos).length);
}

describe('Game：初始状态', () => {
  it('物品全在托盘里，朝向是关卡给的起始朝向，还没有提示', () => {
    const level = generateLevel(6);
    const g = new Game(level);
    assert.equal(g.pieces.length, level.pieces.length);
    assert.equal(g.remaining, level.pieces.length);
    assert.equal(g.isComplete(), false);
    assert.equal(g.hintsUsed, 0);
    g.pieces.forEach((p, id) => {
      assert.equal(p.id, id);
      assert.equal(p.pos, null);
      assert.equal(p.oi, level.pieces[id]!.startOi);
      assert.equal(p.item, level.pieces[id]!.item);
    });
    assertConsistent(g);
  });

  it('拉杆槽是 isBlocked，箱子外面不是；空格没有物品', () => {
    const g = new Game(small());
    assert.equal(g.isBlocked(0, 0), true);
    assert.equal(g.isBlocked(0, 1), false);
    assert.equal(g.isBlocked(-1, 0), false);
    assert.equal(g.isBlocked(0, 3), false);
    assert.equal(g.pieceAt(0, 0), null);
    assert.equal(g.pieceAt(-1, 0), null);
    assert.equal(g.pieceAt(9, 9), null);
  });

  it('物品编号不存在时抛错（是调用方写错了，不是玩家操作）', () => {
    const g = new Game(small());
    for (const bad of [-1, 2, 1.5, NaN]) {
      assert.throws(() => g.place(bad, 0, 0), RangeError, String(bad));
      assert.throws(() => g.remove(bad), RangeError, String(bad));
      assert.throws(() => g.rotate(bad), RangeError, String(bad));
      assert.throws(() => g.canPlace(bad, 0, 0, 0), RangeError, String(bad));
    }
  });
});

describe('Game：放置和移除', () => {
  it('放进空位：占住格子，托盘里少一件', () => {
    const g = new Game(small());
    assert.equal(g.place(1, 1, 0, 0), true); // 运动鞋横着放在 (1,0)
    assert.deepEqual(g.pieces[1]!.pos, { r: 1, c: 0 });
    assert.equal(g.pieces[1]!.oi, 0);
    assert.equal(g.pieceAt(1, 0), 1);
    assert.equal(g.pieceAt(1, 1), 1);
    assert.equal(g.pieceAt(0, 0), null);
    assert.equal(g.remaining, 1);
    assertConsistent(g);
  });

  it('不传朝向就用物品现在的朝向', () => {
    const g = new Game(small());
    assert.equal(g.place(1, 0, 1), true); // 运动鞋起始是竖着的
    assert.equal(g.pieces[1]!.oi, 1);
    assert.equal(g.pieceAt(1, 1), 1);
  });

  it('放不下就返回 false，什么都不变：出界、压拉杆槽、和别的物品重叠、坐标不是整数', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2)); // 登山靴摆好：(0,1)(0,2)(1,2)
    const before = g.snapshot();
    const tries: [number, number, number, number][] = [
      [1, 1, 2, 0], // 横着的运动鞋伸出右边界
      [1, 2, 0, 0], // 伸出下边界
      [1, -1, 0, 0], // 伸出上边界
      [1, 0, -1, 0], // 伸出左边界
      [1, 0, 0, 0], // 压在拉杆槽 (0,0) 上
      [1, 1, 1, 0], // 和登山靴重叠在 (1,2)
      [1, 1, 0.5, 0],
      [1, NaN, 0, 0],
      [1, 1, 0, 7], // 朝向不存在
      [1, 1, 0, -1],
    ];
    for (const [id, r, c, oi] of tries) {
      assert.equal(g.place(id, r, c, oi), false, `放 ${id} 到 (${r},${c}) 朝向 ${oi}`);
      assert.deepEqual(g.snapshot(), before);
    }
    assertConsistent(g);
  });

  it('已经在箱子里的物品可以挪位置，挪到和自己原来的格子重叠的地方也行；旧格子空出来', () => {
    const g = new Game(small());
    assert.ok(g.place(1, 1, 0, 0)); // 占 (1,0)(1,1)
    assert.ok(g.place(1, 1, 1, 0)); // 右移一格，占 (1,1)(1,2)，(1,1) 是自己原来占的
    assert.equal(g.pieceAt(1, 0), null);
    assert.equal(g.pieceAt(1, 1), 1);
    assert.equal(g.pieceAt(1, 2), 1);
    assert.equal(g.remaining, 1);
    assertConsistent(g);
  });

  it('挪不过去时留在原地', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2));
    assert.ok(g.place(1, 1, 0, 0));
    assert.equal(g.place(1, 1, 1, 0), false); // (1,2) 被登山靴占着
    assert.deepEqual(g.pieces[1]!.pos, { r: 1, c: 0 });
    assertConsistent(g);
  });

  it('移除：回到托盘，格子空出来，朝向不变；本来就在托盘里则什么也不做', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2));
    g.remove(0);
    assert.equal(g.pieces[0]!.pos, null);
    assert.equal(g.pieces[0]!.oi, 2);
    assert.equal(g.pieceAt(0, 1), null);
    assert.equal(g.remaining, 2);
    const before = g.snapshot();
    g.remove(0);
    g.remove(1);
    assert.deepEqual(g.snapshot(), before);
    assertConsistent(g);
  });

  it('全部按答案放好就过关；少一件就没过关', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2));
    assert.equal(g.isComplete(), false);
    assert.ok(g.place(1, 1, 0, 0));
    assert.equal(g.isComplete(), true);
    assert.equal(g.remaining, 0);
    g.remove(0);
    assert.equal(g.isComplete(), false);
  });

  it('前 50 关按答案摆都能过关，中途状态始终一致', () => {
    for (let n = 1; n <= 50; n++) {
      const g = new Game(generateLevel(n));
      solve(g);
      assert.equal(g.isComplete(), true, `第 ${n} 关`);
      assertConsistent(g);
    }
  });
});

describe('Game：旋转', () => {
  it('托盘里的物品顺时针转，转一圈回到原来的朝向', () => {
    const g = new Game(small());
    assert.equal(g.pieces[0]!.oi, 0);
    const seen = [0];
    for (let i = 0; i < 4; i++) {
      assert.equal(g.rotate(0), true);
      seen.push(g.pieces[0]!.oi);
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 0]); // 登山靴有 4 个朝向
    assert.equal(g.pieces[0]!.pos, null);
  });

  it('只有一个朝向的物品转不动，返回 false', () => {
    const g = new Game(singles());
    assert.equal(g.rotate(0), false);
    assert.equal(g.pieces[0]!.oi, 0);
  });

  it('不能旋转的关卡（第 1 关）：托盘里和箱子里都转不动，也不能用别的朝向放', () => {
    const level = generateLevel(1);
    assert.equal(level.rotate, false);
    const g = new Game(level);
    solve(g);
    for (const p of g.pieces) assert.equal(g.rotate(p.id), false);
    g.reset();
    for (const p of g.pieces) assert.equal(g.rotate(p.id), false);
    const first = level.pieces[0]!;
    const other = (first.startOi + 1) % first.item.orients.length;
    assert.equal(g.place(0, first.solution.r, first.solution.c, other), false);
    assert.ok(g.pieces.every((p, i) => p.oi === level.pieces[i]!.startOi));
  });

  it('箱子里的物品原地旋转：中心对不齐时挪一格也要转得开', () => {
    const g = new Game(small());
    assert.ok(g.place(1, 1, 0, 0)); // 横着的运动鞋占 (1,0)(1,1)
    assert.equal(g.rotate(1), true); // 竖着：原位 (1,1) 会伸出下边界，试到上移一格 (0,1)
    assert.equal(g.pieces[1]!.oi, 1);
    assert.deepEqual(g.pieces[1]!.pos, { r: 0, c: 1 });
    assert.equal(g.pieceAt(0, 1), 1);
    assert.equal(g.pieceAt(1, 1), 1);
    assert.equal(g.pieceAt(1, 0), null);
    assertConsistent(g);
  });

  it('箱子里转不开就不转，位置朝向都不变', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2));
    assert.ok(g.place(1, 1, 0, 0));
    const before = g.snapshot();
    assert.equal(g.rotate(1), false); // 竖着的所有位置都被拉杆槽、登山靴或边界挡住
    assert.deepEqual(g.snapshot(), before);
    assertConsistent(g);
  });
});

describe('Game：重来', () => {
  it('物品全部回到托盘，朝向保持现状，提示次数不清零', () => {
    const g = new Game(small());
    assert.ok(g.place(0, 0, 1, 2));
    g.rotate(1);
    assert.ok(g.hint());
    g.reset();
    assert.ok(g.pieces.every((p) => p.pos === null));
    assert.equal(g.remaining, 2);
    assert.equal(g.pieces[0]!.oi, 2);
    assert.equal(g.hintsUsed, 1);
    assertConsistent(g);
  });
});

describe('Game：提示', () => {
  it('空箱子：先摆最大的一件，摆在答案里的位置，占的格子和答案一模一样', () => {
    const level = generateLevel(6);
    const g = new Game(level);
    const hint = g.hint();
    assert.ok(hint);
    assert.deepEqual(hint.kicked, []);
    const p = g.pieces[hint.id]!;
    assert.equal(p.item.size, Math.max(...level.pieces.map((q) => q.item.size)));
    const cells = (item: Item, oi: number, r: number, c: number) =>
      item.orients[oi]!.cells.map(([dr, dc]) => `${r + dr},${c + dc}`).sort().join(' ');
    const answers = level.pieces.map((q) => cells(q.item, q.solution.oi, q.solution.r, q.solution.c));
    assert.ok(answers.includes(cells(p.item, p.oi, p.pos!.r, p.pos!.c)));
    assert.equal(g.hintsUsed, 1);
    assertConsistent(g);
  });

  it('挡路的物品退回托盘，用的是托盘里的那件，提示次数加一', () => {
    const g = new Game(twin());
    assert.ok(g.place(0, 0, 0, 1)); // 一只运动鞋竖着，同时挡住两个答案位置
    assert.deepEqual(g.hint(), { id: 1, kicked: [0] });
    assert.equal(g.pieces[0]!.pos, null);
    assert.deepEqual(g.pieces[1]!.pos, { r: 0, c: 0 });
    assert.equal(g.pieces[1]!.oi, 0);
    assert.deepEqual(g.hint(), { id: 0, kicked: [] });
    assert.equal(g.isComplete(), true);
    assert.equal(g.hint(), null);
    assert.equal(g.hintsUsed, 2);
    assertConsistent(g);
  });

  it('形状相同的物品可以互换：已经摆在某个答案位置上的不会被挪走', () => {
    const g = new Game(twin());
    assert.ok(g.place(1, 0, 0, 0)); // 第二只鞋摆在了第一只的答案位置
    assert.deepEqual(g.hint(), { id: 0, kicked: [] }); // 第一只去另一个位置
    assert.deepEqual(g.pieces[1]!.pos, { r: 0, c: 0 });
    assert.deepEqual(g.pieces[0]!.pos, { r: 1, c: 0 });
  });

  it('单格物品也能互换', () => {
    const g = new Game(singles());
    assert.ok(g.place(1, 0, 0)); // 耳机摆在袜子的答案位置
    assert.deepEqual(g.hint(), { id: 0, kicked: [] });
    assert.deepEqual(g.pieces[0]!.pos, { r: 0, c: 1 });
    assert.equal(g.isComplete(), true);
  });

  it('已经全部摆对：没有提示可给，也不扣次数', () => {
    const g = new Game(small());
    solve(g);
    assert.equal(g.hint(), null);
    assert.equal(g.hintsUsed, 0);
  });

  it('大件的答案位置被小件占着：把小件退回托盘，大件摆上去', () => {
    const g = new Game(small());
    assert.ok(g.place(1, 0, 1, 1)); // 竖着的运动鞋占 (0,1)(1,1)，挡住登山靴的答案位置
    assert.deepEqual(g.hint(), { id: 0, kicked: [1] });
    assert.equal(g.pieces[1]!.pos, null);
    assert.deepEqual(g.pieces[0]!.pos, { r: 0, c: 1 });
    assertConsistent(g);
  });

  it('不能旋转的关卡里，提示不会改物品的朝向（第 1 关有两只朝向不同的登山靴）', () => {
    const level = generateLevel(1);
    const g = new Game(level);
    for (let i = 0; i < level.pieces.length; i++) {
      assert.ok(g.hint(), `第 ${i + 1} 次`);
      assertConsistent(g);
    }
    assert.equal(g.isComplete(), true);
    assert.equal(g.hint(), null);
    assert.ok(g.pieces.every((p, i) => p.oi === level.pieces[i]!.startOi));
  });

  it('先摆大件，和物品在托盘里的顺序无关', () => {
    const g = new Game(smallReversed());
    assert.deepEqual(g.hint(), { id: 1, kicked: [] }); // 登山靴 3 格，运动鞋 2 格
  });

  it('不能旋转的关卡：提示只会拿朝向本来就对的那件，哪怕托盘里有另一件更方便', () => {
    const g = new Game(twoBoots());
    assert.ok(g.place(0, 0, 1)); // A 摆错了地方：占 (0,1)(1,1)(1,2)，B 留在托盘
    assert.deepEqual(g.hint(), { id: 0, kicked: [] }); // 只有 A 的朝向对得上第一个答案位置，把它挪回去
    assert.deepEqual(g.pieces[0]!.pos, { r: 0, c: 0 });
    assert.deepEqual(g.hint(), { id: 1, kicked: [] });
    assert.equal(g.isComplete(), true);
    assert.deepEqual(g.pieces.map((p) => p.oi), [0, 2]);
  });

  it('提示会把物品转到答案的朝向，形状不同的物品不会拿错', () => {
    // 登山靴起始朝向和答案不同；运动鞋只有 2 格，不能拿去占登山靴的位置
    const g = new Game(small());
    const r = g.hint();
    assert.equal(r?.id, 0);
    assert.equal(g.pieces[0]!.oi, 2);
  });
});

describe('Game：随机乱玩', () => {
  // 用种子随机数乱放、乱转、乱拿，任何时刻规则内部的占格都要和画面层看到的一致；
  // 失败的操作不能改动状态；最后连点提示，一定在（物品数）次以内摆成答案
  it('前 40 关各乱玩 60 步：状态始终一致，失败的操作不改状态，提示一定能通关', () => {
    for (let n = 1; n <= 40; n++) {
      const level = generateLevel(n);
      const g = new Game(level);
      const rng = createRng(n * 7919);
      const pick = (k: number) => Math.floor(rng() * k);
      for (let step = 0; step < 60; step++) {
        const id = pick(level.pieces.length);
        const before = g.snapshot();
        const op = pick(5);
        const where = `第 ${n} 关第 ${step} 步`;
        if (op <= 1) {
          const oi = pick(g.pieces[id]!.item.orients.length);
          const r = pick(level.rows + 2) - 1;
          const c = pick(level.cols + 2) - 1;
          const expected = (level.rotate || oi === g.pieces[id]!.oi) && g.canPlace(id, oi, r, c);
          assert.equal(g.place(id, r, c, oi), expected, where);
          if (!expected) assert.deepEqual(g.snapshot(), before, where);
        } else if (op === 2) {
          if (!g.rotate(id)) assert.deepEqual(g.snapshot(), before, where);
        } else if (op === 3) {
          g.remove(id);
          assert.equal(g.pieces[id]!.pos, null, where);
        } else {
          g.hint();
        }
        assertConsistent(g);
      }
      for (let i = 0; i < level.pieces.length; i++) if (!g.hint()) break;
      assert.equal(g.isComplete(), true, `第 ${n} 关连点提示没能通关`);
      assert.equal(g.hint(), null, `第 ${n} 关`);
      assertConsistent(g);
    }
  });
});

describe('Game：快照与恢复', () => {
  const played = (level: Level) => {
    const g = new Game(level);
    const rng = createRng(11);
    for (let i = 0; i < 12; i++) {
      const id = Math.floor(rng() * level.pieces.length);
      g.place(id, Math.floor(rng() * level.rows), Math.floor(rng() * level.cols), Math.floor(rng() * 2));
      if (i % 4 === 3) g.rotate(id);
    }
    g.hint();
    return g;
  };

  it('存下来再恢复到新的一局，状态完全一样（含提示次数）', () => {
    const level = generateLevel(12);
    const a = played(level);
    assert.ok(a.pieces.some((p) => p.pos) && a.pieces.some((p) => !p.pos), '测试用的局面里既有放好的也有没放的');
    const b = new Game(level);
    assert.equal(b.restore(a.snapshot()), true);
    assert.deepEqual(b.snapshot(), a.snapshot());
    assert.equal(b.hintsUsed, a.hintsUsed);
    b.pieces.forEach((p, i) => {
      assert.equal(p.oi, a.pieces[i]!.oi);
      assert.deepEqual(p.pos, a.pieces[i]!.pos);
    });
    assertConsistent(b);
  });

  it('快照只含数字和数组，经过 JSON 来回以后还能恢复', () => {
    const level = generateLevel(12);
    const a = played(level);
    const stored: unknown = JSON.parse(JSON.stringify(a.snapshot()));
    const b = new Game(level);
    assert.equal(b.restore(stored), true);
    assert.deepEqual(b.snapshot(), a.snapshot());
  });

  it('快照不受之后的操作影响（存下来的是当时的样子）', () => {
    const g = new Game(small());
    const snap = g.snapshot();
    g.place(1, 1, 0, 0);
    assert.deepEqual(snap.pieces, [[0, -1, -1], [1, -1, -1]]);
  });

  it('恢复会整个替换现在的局面：原来放着的物品不会留下', () => {
    const level = generateLevel(12);
    const g = new Game(level);
    solve(g);
    assert.equal(g.restore(new Game(level).snapshot()), true);
    assert.equal(g.remaining, level.pieces.length);
    assertConsistent(g);
    g.hint();
    assertConsistent(g);
  });

  it('恢复出来的局面能接着玩：连点提示就能通关', () => {
    const level = generateLevel(12);
    const g = new Game(level);
    assert.ok(g.restore(played(level).snapshot()));
    for (let i = 0; i < level.pieces.length && g.hint(); i++);
    assert.equal(g.isComplete(), true);
    assertConsistent(g);
  });

  describe('坏数据：返回 false，局面一点都不改', () => {
    const level = generateLevel(6); // 有拉杆槽，可以旋转
    const good = (): { n: number; hints: number; pieces: number[][] } => {
      const s = played(level).snapshot();
      return { n: s.n, hints: s.hints, pieces: s.pieces.map((p) => [...p]) };
    };
    const placed = (s: ReturnType<typeof good>) => s.pieces.findIndex((p) => p[1]! >= 0);

    const bad: [string, (s: ReturnType<typeof good>) => unknown][] = [
      ['null', () => null],
      ['不是对象', () => 'abc'],
      ['数字', () => 42],
      ['数组', () => []],
      ['空对象', () => ({})],
      ['别的关卡的存档', (s) => ({ ...s, n: s.n + 1 })],
      ['没有关卡号', (s) => ({ hints: s.hints, pieces: s.pieces })],
      ['提示次数是负数', (s) => ({ ...s, hints: -1 })],
      ['提示次数不是整数', (s) => ({ ...s, hints: 1.5 })],
      ['提示次数不是数字', (s) => ({ ...s, hints: '1' })],
      ['物品少一件', (s) => ({ ...s, pieces: s.pieces.slice(1) })],
      ['物品多一件', (s) => ({ ...s, pieces: [...s.pieces, [0, -1, -1]] })],
      ['pieces 不是数组', (s) => ({ ...s, pieces: {} })],
      ['某件不是数组', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? 'x' : p)) })],
      ['某件长度不对', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [0, -1] : p)) })],
      ['朝向不存在', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [99, -1, -1] : p)) })],
      ['朝向是负数', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [-1, -1, -1] : p)) })],
      ['位置不是整数', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], 0.5, 0] : p)) })],
      ['位置是字符串', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], '0', '0'] : p)) })],
      ['位置是 NaN（JSON 里会变成 null）', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], NaN, 0] : p)) })],
      ['只有行是 -1', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], -1, 0] : p)) })],
      ['伸出箱子', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], 0, level.cols] : p)) })],
      ['压在拉杆槽上', (s) => ({ ...s, pieces: s.pieces.map((p, i) => (i === 0 ? [p[0], 5, 0] : p)) })],
      [
        '两件重叠',
        (s) => {
          const i = placed(s);
          return { ...s, pieces: s.pieces.map((p, k) => (k === (i + 1) % s.pieces.length ? [...s.pieces[i]!] : p)) };
        },
      ],
    ];

    for (const [name, make] of bad) {
      it(name, () => {
        const g = played(level);
        const before = g.snapshot();
        assert.equal(g.restore(make(good())), false);
        assert.deepEqual(g.snapshot(), before);
        assertConsistent(g);
      });
    }

    it('不能旋转的关卡里，存档的朝向和起始朝向不同', () => {
      const l1 = generateLevel(1);
      const g = new Game(l1);
      const s = g.snapshot();
      const first = l1.pieces[0]!;
      const turned = [...s.pieces] as unknown as number[][];
      turned[0] = [(first.startOi + 1) % first.item.orients.length, -1, -1];
      assert.equal(g.restore({ ...s, pieces: turned }), false);
      assert.deepEqual(g.snapshot(), s);
    });

    it('好数据本身是能恢复的（上面的坏数据都是从它改出来的）', () => {
      const g = new Game(level);
      assert.equal(g.restore(good()), true);
      const s: Snapshot = g.snapshot();
      assert.equal(s.n, level.n);
    });
  });
});
