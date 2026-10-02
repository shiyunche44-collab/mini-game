import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fillRoundRect, mixColor, roundRectPath, strokeRoundRect } from '../src/engine/draw.ts';
import { FakeCanvas2D } from './fake-platform.ts';

describe('roundRectPath：用 arcTo 画圆角矩形', () => {
  it('从左上角圆弧之后开始，顺时针四个角各一次 arcTo，最后闭合', () => {
    const ctx = new FakeCanvas2D();
    roundRectPath(ctx, 10, 20, 100, 50, 8);
    assert.deepEqual(
      ctx.calls.map((c) => c.op),
      ['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath'],
    );
    assert.deepEqual(ctx.of('moveTo')[0]?.args, [18, 20]);
    assert.deepEqual(
      ctx.of('arcTo').map((c) => c.args),
      [
        [110, 20, 110, 70, 8],
        [110, 70, 10, 70, 8],
        [10, 70, 10, 20, 8],
        [10, 20, 110, 20, 8],
      ],
    );
  });

  it('半径超过短边的一半时按一半算（正好画成胶囊），负数当 0', () => {
    const ctx = new FakeCanvas2D();
    roundRectPath(ctx, 0, 0, 100, 20, 999);
    assert.ok(ctx.of('arcTo').every((c) => c.args[4] === 10));
    ctx.clearCalls();
    roundRectPath(ctx, 0, 0, 100, 20, -5);
    assert.ok(ctx.of('arcTo').every((c) => c.args[4] === 0));
  });

  it('不碰 roundRect：fake 的 Canvas2D 根本没有这个方法', () => {
    assert.equal('roundRect' in new FakeCanvas2D(), false);
  });
});

describe('fillRoundRect、strokeRoundRect', () => {
  it('填充调用发生时，fillStyle 已经是给的颜色', () => {
    const ctx = new FakeCanvas2D();
    fillRoundRect(ctx, 0, 0, 10, 10, 2, '#123456');
    assert.equal(ctx.of('fill')[0]?.style.fillStyle, '#123456');
  });

  it('描边用给的颜色和线宽', () => {
    const ctx = new FakeCanvas2D();
    strokeRoundRect(ctx, 0, 0, 10, 10, 2, '#abcdef', 3);
    assert.equal(ctx.of('stroke')[0]?.style.strokeStyle, '#abcdef');
    assert.equal(ctx.of('stroke')[0]?.style.lineWidth, 3);
  });
});

describe('mixColor：颜色混合', () => {
  it('t 为 0 是第一个颜色，为 1 是第二个，中间按比例', () => {
    assert.equal(mixColor('#000000', '#ffffff', 0), '#000000');
    assert.equal(mixColor('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(mixColor('#ff0000', '#0000ff', 0.5), '#800080');
  });

  it('补零：小的分量也是两位', () => {
    assert.equal(mixColor('#010203', '#010203', 0.3), '#010203');
  });

  it('不是 #rrggbb 就报错', () => {
    assert.throws(() => mixColor('red', '#000000', 0.5), /#rrggbb/);
    assert.throws(() => mixColor('#fff', '#000000', 0.5), /#rrggbb/);
  });
});
