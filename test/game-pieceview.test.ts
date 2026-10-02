import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { generateLevel } from '../src/core/levels.ts';
import { drawPiece, drawPieceGhost } from '../src/game/pieceView.ts';
import { FakeCanvas2D } from './fake-platform.ts';

// 第 1 关的 0 号是登山靴（3 格 L 形），3 号是书（2×2）
const game = new Game(generateLevel(1));
const boot = game.pieces[0];
const books = game.pieces[3];
assert.ok(boot && books);

describe('drawPiece：画一件物品', () => {
  it('每个格子一块，emoji 画一次，save 和 restore 配对', () => {
    const ctx = new FakeCanvas2D();
    drawPiece(ctx, boot, 10, 20, 40);
    assert.equal(ctx.saveDepth, 0);
    assert.equal(ctx.of('fillText').length, 1);
    assert.equal(ctx.of('fillText')[0]?.args[0], boot.item.emoji);
    // 两层，每层 3 个格子
    assert.equal(ctx.of('fill').length, 6);
  });

  it('不拿起来时不投影子', () => {
    const ctx = new FakeCanvas2D();
    drawPiece(ctx, boot, 0, 0, 40);
    assert.ok(ctx.calls.every((c) => c.style.shadowBlur === 0));
  });

  it('拿起来时影子只投一次：整件物品拼成一条路径一次填充，否则格子之间会出现深色的缝', () => {
    const ctx = new FakeCanvas2D();
    drawPiece(ctx, books, 0, 0, 40, 12);
    const shadowed = ctx.of('fill').filter((c) => c.style.shadowBlur > 0);
    assert.equal(shadowed.length, 1);
    // 影子先画，在色块下面
    assert.equal(ctx.of('fill')[0]?.style.shadowBlur, 18);
    // 之后的色块和 emoji 都不带影子
    assert.ok(ctx.calls.filter((c) => c.op === 'fillText').every((c) => c.style.shadowBlur === 0));
    assert.equal(ctx.saveDepth, 0);
  });

  it('画完不留下影子设置，不会影响后面画的东西', () => {
    const ctx = new FakeCanvas2D();
    drawPiece(ctx, books, 0, 0, 40, 12);
    assert.equal(ctx.shadowBlur, 0);
    assert.equal(ctx.shadowOffsetY, 0);
  });

  it('2×2 的物品 emoji 画得比单格的大，画在中间', () => {
    const big = new FakeCanvas2D();
    drawPiece(big, books, 100, 200, 50);
    const small = new FakeCanvas2D();
    drawPiece(small, boot, 100, 200, 50);
    const size = (c: FakeCanvas2D) => Number(/(\d+)px/.exec(c.of('fillText')[0]?.style.font ?? '')?.[1]);
    assert.ok(size(big) > size(small));
    assert.deepEqual(big.of('fillText')[0]?.args.slice(1, 3), [150, 250]);
  });

  it('朝向不存在时什么都不画', () => {
    const ctx = new FakeCanvas2D();
    drawPiece(ctx, { ...books, oi: 99 }, 0, 0, 40);
    assert.equal(ctx.calls.length, 0);
  });

  it('预览是半透明的，整件物品只填充一次：分层画再叠半透明，格子之间会透出条纹', () => {
    const ctx = new FakeCanvas2D();
    drawPieceGhost(ctx, boot, 0, 0, 40, 0.5);
    assert.equal(ctx.of('fill').length, 1);
    assert.equal(ctx.of('fill')[0]?.style.globalAlpha, 0.5);
    assert.equal(ctx.of('fill')[0]?.style.fillStyle, boot.item.color);
    assert.equal(ctx.of('fillText')[0]?.style.globalAlpha, 0.5);
    assert.equal(ctx.globalAlpha, 1); // 画完恢复
    assert.equal(ctx.saveDepth, 0);
  });
});
