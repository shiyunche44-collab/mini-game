// levels-preview 的自测：网格和物品清单要和关卡数据对得上，否则看预览判断难度就没有意义。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { itemById } from '../src/core/items.ts';
import { DESTINATIONS, generateLevel } from '../src/core/levels.ts';
import { displayWidth, parseRange, preview, renderLevel, renderOverview, summarize, turnsNeeded } from './levels-preview.mjs';

const SCRIPT = fileURLToPath(new URL('./levels-preview.mjs', import.meta.url));

/** 从预览里取出网格，每行是一个字符数组 */
const gridOf = (text) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('  | '))
    .map((l) => l.slice(4, -2).split(' '));

/** 手工拼一关：3×2 的箱子，两只登山靴拼成一个长方形 */
function bootsLevel(pieces) {
  return {
    n: 2,
    rotate: true,
    cols: 3,
    rows: 2,
    blocked: [],
    pieces,
    tip: null,
    dest: DESTINATIONS[0],
    next: DESTINATIONS[1],
  };
}
const boot = itemById('boot');
const sneaker = itemById('sneaker');

describe('levels-preview：命令行参数', () => {
  it('不传参数是前 10 关；一个数是前几关；起-止是一段', () => {
    assert.deepEqual(parseRange([]), { from: 1, to: 10 });
    assert.deepEqual(parseRange(['20']), { from: 1, to: 20 });
    assert.deepEqual(parseRange(['11-20']), { from: 11, to: 20 });
    assert.deepEqual(parseRange(['7-7']), { from: 7, to: 7 });
  });

  it('参数不对时报错，并给出用法', () => {
    for (const bad of [['0'], ['abc'], ['5-3'], ['0-3'], ['1.5'], ['-3'], ['3', '4'], ['99999999999999999999']]) {
      assert.throws(() => parseRange(bad), (e) => e instanceof RangeError && e.message.includes('用法'), bad.join(' '));
    }
  });
});

describe('levels-preview：一关的网格', () => {
  it('手工拼的一关：字母按托盘顺序，画在答案的位置上', () => {
    const level = bootsLevel([
      { item: boot, solution: { oi: 0, r: 0, c: 0 }, startOi: 0 },
      { item: boot, solution: { oi: 2, r: 0, c: 1 }, startOi: 2 },
    ]);
    assert.deepEqual(gridOf(renderLevel(level)), [
      ['A', 'B', 'B'],
      ['A', 'A', 'B'],
    ]);
  });

  it('前 10 关：每个字母出现的次数等于那件物品的格数，# 正好在拉杆槽上，没有空格', () => {
    for (let n = 1; n <= 10; n++) {
      const level = generateLevel(n);
      const grid = gridOf(renderLevel(level));
      assert.equal(grid.length, level.rows, `第 ${n} 关的行数`);
      assert.ok(grid.every((row) => row.length === level.cols), `第 ${n} 关的列数`);
      const flat = grid.flat();
      assert.deepEqual(
        flat.flatMap((ch, i) => (ch === '#' ? [i] : [])),
        [...level.blocked].sort((a, b) => a - b),
        `第 ${n} 关的拉杆槽`,
      );
      level.pieces.forEach((p, k) => {
        const letter = String.fromCharCode(65 + k);
        assert.equal(flat.filter((ch) => ch === letter).length, p.item.size, `第 ${n} 关的 ${letter}`);
      });
      assert.ok(!flat.includes('.'), `第 ${n} 关有空格`);
    }
  });

  it('答案没铺满时，空着的格子画成 .，一眼能看出来', () => {
    const level = bootsLevel([{ item: boot, solution: { oi: 0, r: 0, c: 0 }, startOi: 0 }]);
    assert.deepEqual(gridOf(renderLevel(level)), [
      ['A', '.', '.'],
      ['A', 'A', '.'],
    ]);
  });
});

describe('levels-preview：物品清单', () => {
  it('转几下 = 从托盘里的朝向顺时针转到答案的朝向', () => {
    const at = (item, startOi, oi) => ({ item, startOi, solution: { oi, r: 0, c: 0 } });
    assert.equal(turnsNeeded(at(boot, 0, 0)), 0);
    assert.equal(turnsNeeded(at(boot, 0, 1)), 1);
    assert.equal(turnsNeeded(at(boot, 3, 0)), 1); // 转一圈回到第 0 个
    assert.equal(turnsNeeded(at(boot, 1, 0)), 3);
    assert.equal(turnsNeeded(at(sneaker, 1, 0)), 1); // 只有两个朝向
  });

  it('每件一行，按托盘顺序，写明格数、要转几下；前面没出现过的标"新"', () => {
    const level = bootsLevel([
      { item: boot, solution: { oi: 0, r: 0, c: 0 }, startOi: 3 },
      { item: boot, solution: { oi: 2, r: 0, c: 1 }, startOi: 2 },
    ]);
    const lines = (seen) => renderLevel(level, seen).split('\n').filter((l) => /^ {2}[A-Z] /.test(l));
    assert.deepEqual(lines(new Set()), ['  A 🥾 登山靴  3 格  转 1 下  新', '  B 🥾 登山靴  3 格  不用转   新']);
    assert.deepEqual(lines(new Set(['boot'])), ['  A 🥾 登山靴  3 格  转 1 下', '  B 🥾 登山靴  3 格  不用转']);
  });

  it('标题写出关卡号、目的地、箱子尺寸、能不能旋转、教学提示', () => {
    const text = renderLevel(generateLevel(1));
    assert.ok(text.startsWith('第 1 关  HGH 杭州 → CTU 成都\n'));
    assert.ok(text.includes('箱子 4×3，拉杆槽 0 个，4 件物品，不能旋转'));
    assert.ok(text.includes('教学提示：把物品拖进箱子'));
    assert.ok(renderLevel(generateLevel(6)).includes('拉杆槽 2 个'));
    assert.ok(renderLevel(generateLevel(2)).includes('可以旋转'));
  });
});

describe('levels-preview：汇总表', () => {
  it('每关一行：尺寸、拉杆槽、件数、平均格数、要转的件数、新物品', () => {
    const level = bootsLevel([
      { item: boot, solution: { oi: 0, r: 0, c: 0 }, startOi: 3 },
      { item: boot, solution: { oi: 2, r: 0, c: 1 }, startOi: 2 },
    ]);
    const s = summarize(level, new Set(['sneaker']));
    assert.deepEqual({ ...s, fresh: s.fresh.map((it) => it.id) }, {
      n: 2,
      size: '3×2',
      blocked: 0,
      pieces: 2,
      avg: 3,
      turns: 1,
      fresh: ['boot'], // 同一种物品只算一次
    });
    assert.deepEqual(summarize(level, new Set(['boot'])).fresh, []);
  });

  it('按显示宽度对齐：中文和 emoji 占两格', () => {
    assert.equal(displayWidth('ab'), 2);
    assert.equal(displayWidth('关卡'), 4);
    assert.equal(displayWidth('T恤'), 3);
    assert.equal(displayWidth('🥾'), 2);
    const lines = renderOverview([summarize(generateLevel(1), new Set()), summarize(generateLevel(10), new Set())]).split('\n');
    const table = lines.slice(lines.indexOf('') + 1);
    // 每一格在屏幕上从第几列开始、到第几列结束。数字列右对齐看结束位置，最后的"新物品"左对齐看开始位置
    const spans = (line) =>
      [...line.matchAll(/\S+/g)].map((m) => [displayWidth(line.slice(0, m.index)), displayWidth(line.slice(0, m.index + m[0].length))]);
    const head = spans(table[0]);
    assert.equal(head.length, 7);
    for (const row of table.slice(1)) {
      const cells = spans(row);
      assert.deepEqual(cells.slice(0, 6).map(([, end]) => end), head.slice(0, 6).map(([, end]) => end), row);
      assert.equal(cells[6][0], head[6][0], row);
    }
  });
});

describe('levels-preview：整体输出', () => {
  it('第 3～5 关：只打印这三关，"新"仍然从第 1 关算起', () => {
    const text = preview(3, 5);
    assert.deepEqual(
      [...text.matchAll(/^第 (\d+) 关 /gm)].map((m) => Number(m[1])),
      [3, 4, 5],
    );
    // 第 1 关就有的登山靴，到第 3 关不算新
    const bootLine = text.split('\n').find((l) => l.includes('🥾 登山靴'));
    assert.ok(bootLine && !bootLine.endsWith('新'), bootLine);
  });

  it('命令行：默认打印前 10 关，退出码 0；参数不对时打印用法，退出码 1', () => {
    const ok = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal([...ok.stdout.matchAll(/^第 \d+ 关 /gm)].length, 10);
    assert.ok(ok.stdout.includes('汇总'));

    const bad = spawnSync(process.execPath, [SCRIPT, 'abc'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.ok(bad.stderr.includes('用法'));
  });
});
