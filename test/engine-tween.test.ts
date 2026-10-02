import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { easing, Tweens, wave } from '../src/engine/tween.ts';

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} 应该约等于 ${expected}`);
}

describe('easing：缓动函数', () => {
  for (const [name, fn] of Object.entries(easing)) {
    it(`${name}：起点是 0，终点是 1`, () => {
      near(fn(0), 0);
      assert.equal(fn(1), 1);
    });
  }

  it('easeOutQuad 先快后慢，easeInQuad 先慢后快', () => {
    assert.ok(easing.easeOutQuad(0.5) > 0.5);
    assert.ok(easing.easeInQuad(0.5) < 0.5);
    near(easing.easeInOutQuad(0.5), 0.5);
  });

  it('easeOutBack 中途会冲过 1 再回来', () => {
    assert.ok(easing.easeOutBack(0.7) > 1);
  });
});

describe('wave：来回摆动的三角波', () => {
  it('起点和终点都是 0，每个来回先到 1 再到 -1', () => {
    near(wave(0, 3), 0);
    near(wave(1, 3), 0);
    near(wave(1 / 12, 3), 1); // 3 个来回，每个 1/3，四分之一处是波峰
    near(wave(3 / 12, 3), -1);
    near(wave(0.5, 1), 0);
    near(wave(0.25, 1), 1);
    near(wave(0.75, 1), -1);
  });

  it('一直在 -1～1 之间，是连续的折线', () => {
    let prev = wave(0, 3);
    for (let i = 1; i <= 1000; i++) {
      const v = wave(i / 1000, 3);
      assert.ok(v >= -1 - 1e-9 && v <= 1 + 1e-9);
      assert.ok(Math.abs(v - prev) < 0.05, `第 ${i} 步跳变了 ${Math.abs(v - prev)}`);
      prev = v;
    }
  });
});

describe('Tweens：补间', () => {
  it('按时间推进进度，到点时一定恰好是 1，并只调用一次 onComplete', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    let completed = 0;
    tw.add({ duration: 100, onUpdate: (p) => seen.push(p), onComplete: () => completed++ });

    tw.update(25);
    tw.update(25);
    assert.deepEqual(seen, [0.25, 0.5]);
    assert.equal(completed, 0);

    tw.update(60); // 超过终点也只给 1
    assert.deepEqual(seen, [0.25, 0.5, 1]);
    assert.equal(completed, 1);
    assert.equal(tw.count, 0);

    tw.update(16);
    assert.equal(seen.length, 3);
  });

  it('缓动函数作用在进度上', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    tw.add({ duration: 100, ease: easing.easeInQuad, onUpdate: (p) => seen.push(p) });
    tw.update(50);
    assert.deepEqual(seen, [0.25]);
  });

  it('delay 期间不更新，多出来的时间算进补间', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    tw.add({ duration: 100, delay: 50, onUpdate: (p) => seen.push(p) });
    tw.update(30);
    assert.deepEqual(seen, []);
    tw.update(40); // delay 剩 20，补间已走 20
    assert.deepEqual(seen, [0.2]);
  });

  it('duration 为 0：下一次 update 就结束', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    let completed = false;
    tw.add({ duration: 0, onUpdate: (p) => seen.push(p), onComplete: () => (completed = true) });
    tw.update(0);
    assert.deepEqual(seen, [1]);
    assert.equal(completed, true);
  });

  it('cancel 之后不再更新，也不调用 onComplete', () => {
    const tw = new Tweens();
    let updates = 0;
    let completed = false;
    const h = tw.add({ duration: 100, onUpdate: () => updates++, onComplete: () => (completed = true) });
    tw.update(10);
    assert.equal(h.active, true);
    h.cancel();
    assert.equal(h.active, false);
    tw.update(200);
    assert.equal(updates, 1);
    assert.equal(completed, false);
    assert.equal(tw.count, 0);
  });

  it('cancelAll 取消全部', () => {
    const tw = new Tweens();
    let updates = 0;
    tw.add({ duration: 100, onUpdate: () => updates++ });
    tw.add({ duration: 100, onUpdate: () => updates++ });
    tw.cancelAll();
    tw.update(10);
    assert.equal(updates, 0);
    assert.equal(tw.count, 0);
  });

  it('回调里取消同一帧里后面的补间，后面的不会再更新', () => {
    const tw = new Tweens();
    let secondUpdates = 0;
    const second = { h: null as ReturnType<Tweens['add']> | null };
    tw.add({ duration: 100, onUpdate: () => second.h?.cancel() });
    second.h = tw.add({ duration: 100, onUpdate: () => secondUpdates++ });
    tw.update(10);
    assert.equal(secondUpdates, 0);
  });

  it('onComplete 里再加的补间，从下一次 update 才开始计时', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    tw.add({
      duration: 10,
      onUpdate: () => {},
      onComplete: () => {
        tw.add({ duration: 100, onUpdate: (p) => seen.push(p) });
      },
    });
    tw.update(20);
    assert.deepEqual(seen, []);
    assert.equal(tw.count, 1);
    tw.update(50);
    assert.deepEqual(seen, [0.5]);
  });

  it('可以用补间串起一段接力动画', () => {
    const tw = new Tweens();
    const box = { x: 0 };
    tw.animate(box, { x: 10 }, { duration: 100, onComplete: () => void tw.animate(box, { x: 0 }, { duration: 100 }) });
    tw.update(100);
    assert.equal(box.x, 10);
    tw.update(50);
    assert.equal(box.x, 5);
    tw.update(50);
    assert.equal(box.x, 0);
  });
});

describe('Tweens.animate：渐变对象的数值属性', () => {
  it('从当前值渐变到目标值，其他属性不动', () => {
    const tw = new Tweens();
    const piece = { x: 10, y: 20, name: 'shirt' };
    tw.animate(piece, { x: 110, y: 0 }, { duration: 100 });
    tw.update(50);
    assert.deepEqual(piece, { x: 60, y: 10, name: 'shirt' });
    tw.update(50);
    assert.deepEqual(piece, { x: 110, y: 0, name: 'shirt' });
  });

  it('起点在 delay 结束后才取：delay 期间别处改了值，以改后的为起点', () => {
    const tw = new Tweens();
    const piece = { x: 0 };
    tw.animate(piece, { x: 100 }, { duration: 100, delay: 100 });
    piece.x = 50;
    tw.update(150);
    assert.equal(piece.x, 75);
  });

  it('也会触发 onUpdate 和 onComplete', () => {
    const tw = new Tweens();
    const piece = { x: 0 };
    const seen: number[] = [];
    let completed = false;
    tw.animate(piece, { x: 1 }, { duration: 10, onUpdate: (p) => seen.push(p), onComplete: () => (completed = true) });
    tw.update(10);
    assert.deepEqual(seen, [1]);
    assert.equal(completed, true);
  });
});
