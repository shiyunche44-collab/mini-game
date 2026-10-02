import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SAVE_KEY, newProgress } from '../src/core/progress.ts';
import { startGame } from '../src/game/start.ts';
import { FakePlatform } from './fake-platform.ts';

const FRAME = FakePlatform.FRAME_MS;

describe('startGame：启动', () => {
  it('每帧先用渐变铺满整个屏幕，再画别的', () => {
    const p = new FakePlatform({ width: 390, height: 844 });
    startGame(p, { level: 1 });
    p.advance(FRAME);

    const first = p.ctx.calls.find((c) => c.op === 'fillRect');
    assert.deepEqual(first?.args, [0, 0, 390, 844]);
    assert.equal(first?.style.fillStyle, '[gradient]');
    assert.deepEqual(p.ctx.of('createLinearGradient')[0]?.args, [0, 0, 0, 844]);
  });

  it('没有存档从第 1 关开始，有存档就读存档里的关卡', () => {
    const fresh = new FakePlatform();
    startGame(fresh);
    fresh.advance(FRAME);
    assert.ok(fresh.ctx.of('fillText').some((c) => c.args[0] === '第 1 关'));

    const saved = new FakePlatform();
    saved.storage.set(SAVE_KEY, { ...newProgress(), level: 7 });
    startGame(saved);
    saved.advance(FRAME);
    assert.ok(saved.ctx.of('fillText').some((c) => c.args[0] === '第 7 关'));
  });

  it('level 参数优先于存档；hints 参数先摆好几件', () => {
    const p = new FakePlatform();
    p.storage.set(SAVE_KEY, { ...newProgress(), level: 7 });
    startGame(p, { level: 2, hints: 0 });
    p.advance(FRAME);
    assert.ok(p.ctx.of('fillText').some((c) => c.args[0] === '第 2 关'));
  });

  it('切到后台不再画，回到前台接着画', () => {
    const p = new FakePlatform();
    startGame(p, { level: 1 });
    p.advance(FRAME);
    p.hide();
    p.ctx.clearCalls();
    p.advance(1000);
    assert.equal(p.ctx.calls.length, 0);
    p.show();
    p.advance(FRAME);
    assert.ok(p.ctx.calls.length > 0);
  });

  it('返回的 Loop 可以停下', () => {
    const p = new FakePlatform();
    const loop = startGame(p, { level: 1 });
    loop.stop();
    p.advance(1000);
    assert.equal(p.ctx.calls.length, 0);
  });
});
