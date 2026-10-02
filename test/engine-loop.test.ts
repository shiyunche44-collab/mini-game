import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Loop, MAX_DT_MS } from '../src/engine/loop.ts';
import { FakePlatform } from './fake-platform.ts';

const FRAME = FakePlatform.FRAME_MS;

function setup() {
  const p = new FakePlatform();
  const log: string[] = [];
  const dts: number[] = [];
  const loop = new Loop(p, {
    update: (dt) => {
      dts.push(dt);
      log.push('update');
    },
    render: () => log.push('render'),
  });
  return { p, loop, log, dts };
}

describe('Loop：主循环', () => {
  it('start 之前不跑，start 之后每帧先 update 再 render', () => {
    const { p, loop, log } = setup();
    p.advance(100);
    assert.deepEqual(log, []);

    loop.start();
    p.advance(FRAME * 2);
    assert.deepEqual(log, ['update', 'render', 'update', 'render']);
  });

  it('第一帧 dt 为 0，之后是帧间隔', () => {
    const { p, loop, dts } = setup();
    loop.start();
    p.advance(FRAME * 3);
    assert.equal(dts[0], 0);
    assert.ok(Math.abs((dts[1] ?? 0) - FRAME) < 1e-9);
    assert.ok(Math.abs((dts[2] ?? 0) - FRAME) < 1e-9);
  });

  it('stop 之后不再跑，也不会留下新的帧回调', () => {
    const { p, loop, log } = setup();
    loop.start();
    p.advance(FRAME);
    loop.stop();
    log.length = 0;
    p.advance(FRAME * 5);
    assert.deepEqual(log, []);
    assert.equal(p.pendingFrames, 0);
    assert.equal(loop.running, false);
  });

  it('start 多次、stop 后马上再 start，都只有一条循环在跑', () => {
    const { p, loop, log } = setup();
    loop.start();
    loop.start();
    p.advance(FRAME);
    loop.stop();
    loop.start(); // 旧的帧回调还挂着，不能让它也跑起来
    log.length = 0;
    p.advance(FRAME * 2);
    assert.deepEqual(log, ['update', 'render', 'update', 'render']);
  });

  it('切到后台就停，回到前台接着跑，并且停下的时间不算进 dt', () => {
    const { p, loop, dts } = setup();
    loop.start();
    p.advance(FRAME * 2);
    p.hide();
    const before = dts.length;
    p.advance(60_000);
    assert.equal(dts.length, before);
    assert.equal(loop.running, false);

    p.show();
    assert.equal(loop.running, true);
    p.advance(FRAME * 2);
    assert.equal(dts[before], 0);
    assert.ok(Math.abs((dts[before + 1] ?? 0) - FRAME) < 1e-9);
  });

  it('没 start 过的循环，回到前台也不会自己跑起来；stop 过的同理', () => {
    const { p, loop, log } = setup();
    p.hide();
    p.show();
    p.advance(100);
    assert.deepEqual(log, []);

    loop.start();
    loop.stop();
    p.hide();
    p.show();
    p.advance(100);
    assert.deepEqual(log, []);
  });

  it('后台期间调用 start，要等回到前台才开始跑', () => {
    const { p, loop, log } = setup();
    p.hide();
    loop.start();
    p.advance(100);
    assert.deepEqual(log, []);
    p.show();
    p.advance(FRAME);
    assert.deepEqual(log, ['update', 'render']);
  });

  it('dt 不会超过上限（帧间隔异常大时）', () => {
    // 直接用一个只会给出大间隔的平台，模拟卡顿
    const frameCbs: ((t: number) => void)[] = [];
    const dts: number[] = [];
    const loop = new Loop(
      { requestFrame: (cb) => frameCbs.push(cb), onShow: () => {}, onHide: () => {} },
      { update: (dt) => dts.push(dt), render: () => {} },
    );
    loop.start();
    frameCbs.shift()?.(1000);
    frameCbs.shift()?.(6000); // 隔了 5 秒
    frameCbs.shift()?.(5000); // 时钟倒退
    assert.deepEqual(dts, [0, MAX_DT_MS, 0]);
  });

  it('update 里调用 stop，这一帧不再 render，之后也不再跑', () => {
    const p = new FakePlatform();
    const log: string[] = [];
    const loop: Loop = new Loop(p, {
      update: () => {
        log.push('update');
        loop.stop();
      },
      render: () => log.push('render'),
    });
    loop.start();
    p.advance(FRAME * 3);
    assert.deepEqual(log, ['update']);
  });

  it('某一帧的逻辑抛了异常，下一帧仍然会跑', () => {
    const p = new FakePlatform();
    let calls = 0;
    const loop = new Loop(p, {
      update: () => {
        calls++;
        if (calls === 1) throw new Error('boom');
      },
      render: () => {},
    });
    loop.start();
    assert.throws(() => p.advance(FRAME), /boom/);
    p.advance(FRAME);
    assert.equal(calls, 2);
  });
});
