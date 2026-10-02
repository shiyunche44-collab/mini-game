import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startGame } from '../src/game/start.ts';
import { FakePlatform } from './fake-platform.ts';

describe('startGame：只画背景', () => {
  it('每帧用渐变铺满整个屏幕', () => {
    const p = new FakePlatform({ width: 390, height: 844 });
    startGame(p);
    p.advance(FakePlatform.FRAME_MS);

    const fills = p.ctx.of('fillRect');
    assert.equal(fills.length, 1);
    assert.deepEqual(fills[0]?.args, [0, 0, 390, 844]);
    assert.equal(fills[0]?.style.fillStyle, '[gradient]');
    assert.deepEqual(p.ctx.of('createLinearGradient')[0]?.args, [0, 0, 0, 844]);
  });

  it('切到后台不再画，回到前台接着画', () => {
    const p = new FakePlatform();
    startGame(p);
    p.advance(FakePlatform.FRAME_MS);
    p.hide();
    p.ctx.clearCalls();
    p.advance(1000);
    assert.equal(p.ctx.count('fillRect'), 0);
    p.show();
    p.advance(FakePlatform.FRAME_MS);
    assert.equal(p.ctx.count('fillRect'), 1);
  });

  it('返回的 Loop 可以停下', () => {
    const p = new FakePlatform();
    const loop = startGame(p);
    loop.stop();
    p.advance(1000);
    assert.equal(p.ctx.count('fillRect'), 0);
  });
});
