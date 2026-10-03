import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateLevel } from '../src/core/levels.ts';
import { computeLayout } from '../src/game/layout.ts';
import { gate, NEXT_LABEL, WinOverlay } from '../src/game/WinOverlay.ts';
import { theme } from '../src/game/theme.ts';
import { FakePlatform, type DrawCall } from './fake-platform.ts';
import { FRAME, frame, hasText, setupSession, textPos } from './play-helpers.ts';

/** 单独搭一个过关画面（不经过 Session）：每帧 update 再 render */
function overlay(n = 1, size: [number, number] = [375, 667], hintsUsed = 0) {
  const p = new FakePlatform({ width: size[0], height: size[1] });
  const level = generateLevel(n);
  const layout = computeLayout(p.screen, level);
  let nexts = 0;
  const o = new WinOverlay(p, layout, { level, hintsUsed }, { next: () => nexts++, share: () => undefined });
  const step = (ms: number): void => {
    for (let t = 0; t < ms; t += FRAME) o.update(FRAME);
  };
  const draw = (): DrawCall[] => {
    p.ctx.clearCalls();
    o.render();
    return [...p.ctx.calls];
  };
  return { p, o, layout, level, step, draw, nexts: () => nexts };
}

const lidCalls = (calls: DrawCall[]) => calls.filter((c) => c.op === 'fillRect' && c.style.fillStyle === theme.lid);

describe('过关画面：时间线', () => {
  it('刚过关时什么都没画：先等最后一件物品落稳', () => {
    const w = overlay();
    w.step(100);
    assert.equal(w.draw().length, 0);
  });

  it('先合盖，再盖章，最后登机牌：三样东西按这个顺序出现', () => {
    const w = overlay();
    const seen: Record<string, number> = {};
    for (let t = 0; t < 2500; t += FRAME) {
      w.step(FRAME);
      const calls = w.draw();
      if (lidCalls(calls).length && seen.lid === undefined) seen.lid = t;
      if (hasText(calls, '已装箱') && seen.stamp === undefined) seen.stamp = t;
      if (hasText(calls, '登机牌  BOARDING PASS') && seen.card === undefined) seen.card = t;
    }
    assert.ok(seen.lid !== undefined && seen.stamp !== undefined && seen.card !== undefined, JSON.stringify(seen));
    assert.ok(seen.lid < seen.stamp && seen.stamp < seen.card, `顺序不对：${JSON.stringify(seen)}`);
    assert.ok(seen.card < 2000, `登机牌 ${seen.card}ms 才出来，太慢`);
  });

  it('箱盖从上面落下来，落到箱子外壳正好盖住的位置', () => {
    const w = overlay();
    w.step(220 + 100); // 合盖进行到一小半
    const early = lidCalls(w.draw())[0];
    const f = w.layout.board.frame;
    assert.ok(early);
    assert.ok((early.args[1] as number) < f.y, '一开始盖子应该在箱子上方');

    w.step(600);
    const done = lidCalls(w.draw())[0];
    assert.deepEqual(done?.args, [f.x, f.y, f.w, f.h]);
  });

  it('印章从大变小压下来，最后是原大小', () => {
    const w = overlay();
    w.step(560 + 30);
    const first = w.draw().filter((c) => c.op === 'scale').at(-1);
    assert.ok(first && (first.args[0] as number) > 1.3, `刚盖下去时章应该很大：${first?.args}`);
    w.step(800);
    const last = w.draw().filter((c) => c.op === 'scale').at(-1);
    assert.ok(last && Math.abs((last.args[0] as number) - 1) < 1e-6);
  });

  it('画完 save 和 restore 配对，不留透明度和阴影', () => {
    const w = overlay();
    for (let i = 0; i < 150; i++) {
      w.step(FRAME);
      w.draw();
      assert.equal(w.p.ctx.saveDepth, 0);
    }
    assert.equal(w.p.ctx.globalAlpha, 1);
    assert.equal(w.p.ctx.shadowBlur, 0);
  });

  it('同一关每次画出来都一样（条形码不用随机数）', () => {
    const a = overlay(7);
    const b = overlay(7);
    a.step(3000);
    b.step(3000);
    assert.deepEqual(
      a.draw().map((c) => [c.op, c.args]),
      b.draw().map((c) => [c.op, c.args]),
    );
    const c = overlay(8);
    c.step(3000);
    assert.notDeepEqual(
      a.draw().filter((x) => x.op === 'fillRect').map((x) => x.args),
      c.draw().filter((x) => x.op === 'fillRect').map((x) => x.args),
    );
  });
});

describe('过关画面：登机牌上的内容', () => {
  it('出发地是这一关的目的地，到达地是下一关的；关卡号、行李件数、提示次数', () => {
    const w = overlay(2, [375, 667], 3);
    w.step(3000);
    const calls = w.draw();
    const { level } = w;
    for (const t of [level.dest.code, level.dest.city, level.next.code, level.next.city, '第 2 关', `${level.pieces.length} 件`, '3 次']) {
      assert.ok(hasText(calls, t), `缺少 ${t}`);
    }
    assert.ok(!hasText(calls, '没用提示'));
  });

  it('没用提示就写"没用提示"', () => {
    const w = overlay(1, [375, 667], 0);
    w.step(3000);
    assert.ok(hasText(w.draw(), '没用提示'));
  });

  it('登机口由关卡号算出来：字母加数字，同一关不变', () => {
    assert.equal(gate(1), 'B8');
    assert.equal(gate(1), gate(1));
    assert.match(gate(123), /^[A-F]\d{1,2}$/);
    for (let n = 1; n <= 200; n++) assert.match(gate(n), /^[A-F]([1-9]|[12]\d|30)$/);
  });
});

describe('过关画面：点击', () => {
  it('登机牌出来之前，点一下直接跳到最后，但不会进下一关', () => {
    const w = overlay();
    w.step(300);
    assert.equal(w.o.isReady, false);
    w.o.tap(10, 10);
    assert.equal(w.o.isReady, true);
    assert.equal(w.nexts(), 0);
    const calls = w.draw();
    assert.ok(hasText(calls, '登机牌  BOARDING PASS') && hasText(calls, '已装箱') && lidCalls(calls).length > 0);
  });

  it('登机牌出来之后：点在"下一站"上进下一关，点在别处没反应', () => {
    const w = overlay();
    w.step(3000);
    assert.equal(w.o.isReady, true);
    const calls = w.draw();
    const button = textPos(calls, NEXT_LABEL);
    assert.ok(button);
    w.o.tap(5, 5);
    w.o.tap(button[0], button[1] - 80);
    assert.equal(w.nexts(), 0);
    w.o.tap(...button);
    assert.equal(w.nexts(), 1);
  });

  it('下一站只触发一次，连点也一样', () => {
    const w = overlay();
    w.step(3000);
    const button = textPos(w.draw(), NEXT_LABEL);
    assert.ok(button);
    w.o.tap(...button);
    w.o.tap(...button);
    w.o.tap(...button);
    assert.equal(w.nexts(), 1);
  });

  it('按钮在登机牌里面，各种屏幕上都在屏幕里面', () => {
    for (const size of [[375, 667], [390, 844], [1280, 800], [320, 568]] as [number, number][]) {
      const w = overlay(5, size);
      w.step(3000);
      const calls = w.draw();
      const [x, y] = textPos(calls, NEXT_LABEL) ?? [-1, -1];
      assert.ok(x > 0 && x < size[0] && y > 0 && y < size[1], `${size.join('×')}：按钮在 (${x}, ${y})`);
      const [bx, by] = textPos(calls, '登机牌  BOARDING PASS') ?? [-1, -1];
      assert.ok(bx >= 0 && by >= 0 && by < y, `${size.join('×')}：顶部色带在 (${bx}, ${by})`);
    }
  });
});

describe('过关画面：和整局配合', () => {
  it('过关期间拖动、点按物品都不起作用', () => {
    const s = setupSession({ level: 1, hints: 99 });
    assert.ok(s.session.winOverlay);
    const before = JSON.stringify(s.session.current.game.snapshot());
    const { grid, cell } = s.session.current.layout.board;
    const [x, y] = [grid.x + 0.5 * cell, grid.y + 0.5 * cell];
    s.p.touch.drag([[x, y], [x + 20, y], [x + 40, y + 200]]);
    s.p.advance(3000);
    s.p.touch.drag([[x, y], [x + 20, y], [x + 40, y + 200]]);
    s.p.touch.tap(x, y);
    assert.equal(JSON.stringify(s.session.current.game.snapshot()), before);
  });

  it('过关画面盖在箱子上面：箱盖盖住所有物品之后才画印章', () => {
    const s = setupSession({ level: 1, hints: 99 });
    s.p.advance(3000);
    const calls = frame(s.p);
    const lid = calls.findIndex((c) => c.op === 'fillRect' && c.style.fillStyle === theme.lid);
    const lastPieceText = calls.map((c, i) => (c.op === 'fillText' && ['📚', '🧢', '🥾'].includes(c.args[0] as string) ? i : -1)).filter((i) => i >= 0).at(-1);
    assert.ok(lid > (lastPieceText ?? 0), '箱盖应该画在所有物品之后');
    assert.ok(calls.findIndex((c) => c.op === 'fillText' && c.args[0] === '已装箱') > lid);
  });
});
