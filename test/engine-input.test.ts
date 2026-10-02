import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGestureRecognizer, TAP_MAX_MOVE_PX, TAP_MAX_MS } from '../src/engine/input.ts';
import { FakePlatform } from './fake-platform.ts';

function setup() {
  const p = new FakePlatform();
  const log: string[] = [];
  p.onPointer(
    createGestureRecognizer(() => p.now(), {
      tap: (x, y) => log.push(`tap ${x},${y}`),
      dragStart: (e) => log.push(`dragStart ${e.startX},${e.startY}->${e.x},${e.y}`),
      dragMove: (e) => log.push(`dragMove ${e.x},${e.y}`),
      dragEnd: (e) => log.push(`dragEnd ${e.startX},${e.startY}->${e.x},${e.y}`),
      dragCancel: () => log.push('dragCancel'),
    }),
  );
  return { p, log };
}

describe('点击', () => {
  it('按下后原地抬起是点击', () => {
    const { p, log } = setup();
    p.touch.tap(50, 60);
    assert.deepEqual(log, ['tap 50,60']);
  });

  it('按下时抖了一点（不到阈值）仍然是点击，位置取按下的点', () => {
    const { p, log } = setup();
    p.touch.down(50, 60);
    p.touch.move(50 + TAP_MAX_MOVE_PX - 1, 60);
    p.touch.up(50 + TAP_MAX_MOVE_PX - 1, 60);
    assert.deepEqual(log, ['tap 50,60']);
  });

  it('按住时间正好到上限仍是点击，超过就什么都不触发', () => {
    const { p, log } = setup();
    p.touch.down(1, 2);
    p.advance(TAP_MAX_MS);
    p.touch.up(1, 2);
    assert.deepEqual(log, ['tap 1,2']);

    log.length = 0;
    p.touch.down(1, 2);
    p.advance(TAP_MAX_MS + 1);
    p.touch.up(1, 2);
    assert.deepEqual(log, []);
  });
});

describe('拖动', () => {
  it('位移达到阈值时触发 dragStart，之后每次移动触发 dragMove，抬起触发 dragEnd', () => {
    const { p, log } = setup();
    p.touch.drag([
      [10, 10],
      [20, 10],
      [30, 10],
      [40, 10],
    ]);
    assert.deepEqual(log, ['dragStart 10,10->20,10', 'dragMove 30,10', 'dragMove 40,10', 'dragEnd 10,10->40,10']);
  });

  it('开始拖动之后，手指绕回起点附近也不会变成点击', () => {
    const { p, log } = setup();
    p.touch.drag([
      [10, 10],
      [40, 10],
      [11, 10],
    ]);
    assert.deepEqual(log, ['dragStart 10,10->40,10', 'dragMove 11,10', 'dragEnd 10,10->11,10']);
  });

  it('拖动不受按住时间限制', () => {
    const { p, log } = setup();
    p.touch.down(0, 0);
    p.advance(TAP_MAX_MS * 4);
    p.touch.move(30, 0);
    p.touch.up(30, 0);
    assert.deepEqual(log, ['dragStart 0,0->30,0', 'dragEnd 0,0->30,0']);
  });

  it('拖动结束后可以立刻开始下一次点击', () => {
    const { p, log } = setup();
    p.touch.drag([
      [0, 0],
      [50, 0],
    ]);
    log.length = 0;
    p.touch.tap(5, 5);
    assert.deepEqual(log, ['tap 5,5']);
  });
});

describe('取消和多指', () => {
  it('拖动中被系统取消，触发 dragCancel，之后的抬起不再有事件', () => {
    const { p, log } = setup();
    p.touch.down(0, 0);
    p.touch.move(30, 0);
    p.touch.cancel(30, 0);
    p.touch.up(30, 0);
    assert.deepEqual(log, ['dragStart 0,0->30,0', 'dragCancel']);
  });

  it('还没开始拖动就被取消，什么都不触发', () => {
    const { p, log } = setup();
    p.touch.down(0, 0);
    p.touch.cancel(0, 0);
    p.touch.up(0, 0);
    assert.deepEqual(log, []);
  });

  it('第二根手指的事件全部忽略，不干扰第一根的拖动', () => {
    const { p, log } = setup();
    p.touch.down(0, 0, 1);
    p.touch.down(200, 200, 2);
    p.touch.move(30, 0, 1);
    p.touch.move(300, 300, 2);
    p.touch.up(300, 300, 2);
    p.touch.move(40, 0, 1);
    p.touch.up(40, 0, 1);
    assert.deepEqual(log, ['dragStart 0,0->30,0', 'dragMove 40,0', 'dragEnd 0,0->40,0']);
  });

  it('第二根手指取消，也不会打断第一根', () => {
    const { p, log } = setup();
    p.touch.down(0, 0, 1);
    p.touch.move(30, 0, 1);
    p.touch.down(5, 5, 2);
    p.touch.cancel(5, 5, 2);
    p.touch.up(30, 0, 1);
    assert.deepEqual(log, ['dragStart 0,0->30,0', 'dragEnd 0,0->30,0']);
  });

  it('第一根手指抬起后，第二根可以重新开始', () => {
    const { p, log } = setup();
    p.touch.tap(1, 1, 1);
    p.touch.tap(2, 2, 2);
    assert.deepEqual(log, ['tap 1,1', 'tap 2,2']);
  });

  it('同一根手指漏了抬起又按下：先收掉上一段拖动，再重新开始', () => {
    const { p, log } = setup();
    p.touch.down(0, 0);
    p.touch.move(30, 0);
    p.touch.down(100, 100);
    p.touch.up(100, 100);
    assert.deepEqual(log, ['dragStart 0,0->30,0', 'dragCancel', 'tap 100,100']);
  });

  it('没有按下就收到移动或抬起，忽略', () => {
    const { p, log } = setup();
    p.touch.move(1, 1);
    p.touch.up(1, 1);
    assert.deepEqual(log, []);
  });
});
