import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { generateLevel } from '../src/core/levels.ts';
import { PlayScene } from '../src/game/PlayScene.ts';
import { FakePlatform } from './fake-platform.ts';

function draw(n: number, hints = 0, size: [number, number] = [375, 667]) {
  const p = new FakePlatform({ width: size[0], height: size[1] });
  const game = new Game(generateLevel(n));
  for (let i = 0; i < hints; i++) game.hint();
  const scene = new PlayScene(p, game);
  scene.render();
  return { p, game, scene };
}

const texts = (p: FakePlatform): unknown[] => p.ctx.of('fillText').map((c) => c.args[0]);

describe('PlayScene：静态画面', () => {
  it('行李牌上有目的地三字码、城市和关卡号', () => {
    const { p, game } = draw(1);
    assert.ok(texts(p).includes(game.level.dest.code));
    assert.ok(texts(p).includes(game.level.dest.city));
    assert.ok(texts(p).includes('第 1 关'));
  });

  it('三个按钮都在，提示和跳关带"广告"角标，重来没有', () => {
    const { p } = draw(1);
    for (const label of ['重来', '提示', '跳关']) assert.ok(texts(p).includes(label), `缺少 ${label}`);
    assert.equal(texts(p).filter((t) => t === '广告').length, 2);
  });

  it('有教学提示的关卡画出提示语，没有的不画', () => {
    const one = draw(1);
    assert.ok(texts(one.p).includes(one.game.level.tip));
    const three = draw(3);
    assert.equal(three.game.level.tip, null);
  });

  it('开局物品都在托盘里：每件物品的 emoji 画一次', () => {
    const { p, game } = draw(5);
    const emojis = game.pieces.map((x) => x.item.emoji).sort();
    const drawn = texts(p).filter((t) => emojis.includes(t as string)).sort();
    assert.deepEqual(drawn, emojis);
  });

  it('摆进箱子的物品画在箱子里，托盘里留虚线框；总共画出的 emoji 数不变', () => {
    const empty = draw(5);
    const placed = draw(5, 3);
    const count = (s: ReturnType<typeof draw>) =>
      texts(s.p).filter((t) => s.game.pieces.some((x) => x.item.emoji === t)).length;
    assert.equal(count(placed), count(empty));
    assert.equal(placed.game.remaining, placed.game.pieces.length - 3);
    // 3 件被摆进箱子，托盘里就有 3 个虚线框
    assert.equal(placed.p.ctx.of('setLineDash').length, 3);
    assert.equal(empty.p.ctx.of('setLineDash').length, 0);
  });

  it('箱子里的物品画在箱子格子区域里', () => {
    const { p, scene } = draw(5, 4);
    const { grid } = scene.layout.board;
    const inGrid = p.ctx
      .of('fillText')
      .filter((c) => scene.game.pieces.some((x) => x.pos && x.item.emoji === c.args[0]))
      .filter((c) => {
        const [, x, y] = c.args as [string, number, number];
        return x >= grid.x && x <= grid.x + grid.w && y >= grid.y && y <= grid.y + grid.h;
      });
    assert.ok(inGrid.length >= 4);
  });

  it('只用 Canvas2D 子集里的方法画，save 和 restore 配对', () => {
    const { p } = draw(10, 2);
    assert.equal(p.ctx.saveDepth, 0);
    assert.equal(p.ctx.count('roundRect'), 0);
  });

  it('前 30 关在几种屏幕上都能画出来，不抛错、save 和 restore 配对', () => {
    for (const size of [[375, 667], [390, 844], [1280, 800], [320, 568]] as [number, number][]) {
      for (let n = 1; n <= 30; n++) {
        const { p } = draw(n, n % 4, size);
        assert.equal(p.ctx.saveDepth, 0, `第 ${n} 关 ${size.join('×')}`);
      }
    }
  });

  it('拉杆槽的格子画成灰色，不是空格子的颜色', () => {
    const { p, game } = draw(6);
    assert.ok(game.level.blocked.length > 0);
    const fills = new Set(p.ctx.of('fill').map((c) => c.style.fillStyle));
    assert.ok(fills.has('#66727f'), '没有画出拉杆槽');
  });

  it('同一状态画两次，绘制调用完全一样（画面只由状态决定）', () => {
    const a = draw(8, 2);
    const b = draw(8, 2);
    assert.deepEqual(
      a.p.ctx.calls.map((c) => [c.op, c.args]),
      b.p.ctx.calls.map((c) => [c.op, c.args]),
    );
  });
});
