import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Platform, PointerPoint } from '../src/platform/types.ts';
import { FakePlatform } from './fake-platform.ts';

// 这一行只在类型检查时起作用：假平台必须满足 Platform 接口
const asPlatform: Platform = new FakePlatform();
void asPlatform;

describe('FakePlatform：画布', () => {
  it('记录每次调用，并带上当时的样式', () => {
    const p = new FakePlatform();
    p.ctx.fillStyle = '#ff0000';
    p.ctx.globalAlpha = 0.5;
    p.ctx.fillRect(1, 2, 3, 4);
    p.ctx.fillStyle = '#00ff00';
    p.ctx.fillText('你好', 10, 20);

    assert.equal(p.ctx.calls.length, 2);
    assert.deepEqual(p.ctx.calls[0]?.args, [1, 2, 3, 4]);
    assert.equal(p.ctx.calls[0]?.style.fillStyle, '#ff0000');
    assert.equal(p.ctx.calls[0]?.style.globalAlpha, 0.5);
    assert.equal(p.ctx.calls[1]?.op, 'fillText');
    assert.equal(p.ctx.calls[1]?.style.fillStyle, '#00ff00');
    assert.equal(p.ctx.count('fillRect'), 1);
    assert.equal(p.ctx.of('fillText')[0]?.args[0], '你好');
  });

  it('save / restore 会恢复样式，并跟踪层数', () => {
    const p = new FakePlatform();
    p.ctx.fillStyle = '#111111';
    p.ctx.save();
    p.ctx.fillStyle = '#222222';
    p.ctx.lineWidth = 9;
    assert.equal(p.ctx.saveDepth, 1);
    p.ctx.restore();
    assert.equal(p.ctx.saveDepth, 0);
    assert.equal(p.ctx.fillStyle, '#111111');
    assert.equal(p.ctx.lineWidth, 1);
  });

  it('多余的 restore 不会让层数变成负数', () => {
    const p = new FakePlatform();
    p.ctx.restore();
    assert.equal(p.ctx.saveDepth, 0);
  });

  it('渐变记录为 [gradient]，measureText 全角比半角宽', () => {
    const p = new FakePlatform();
    p.ctx.fillStyle = p.ctx.createLinearGradient(0, 0, 0, 10);
    p.ctx.fillRect(0, 0, 1, 1);
    assert.equal(p.ctx.of('fillRect')[0]?.style.fillStyle, '[gradient]');

    p.ctx.font = '20px sans-serif';
    assert.equal(p.ctx.measureText('ab').width, 20);
    assert.equal(p.ctx.measureText('行李').width, 40);
  });

  it('clearCalls 清空记录', () => {
    const p = new FakePlatform();
    p.ctx.fillRect(0, 0, 1, 1);
    p.ctx.clearCalls();
    assert.equal(p.ctx.calls.length, 0);
  });
});

describe('FakePlatform：触摸', () => {
  function listen(p: FakePlatform) {
    const log: string[] = [];
    const fmt = (kind: string, e: PointerPoint) => log.push(`${kind}:${e.id}:${e.x},${e.y}`);
    p.onPointer({
      down: (e) => fmt('down', e),
      move: (e) => fmt('move', e),
      up: (e) => fmt('up', e),
      cancel: (e) => fmt('cancel', e),
    });
    return log;
  }

  it('tap 是按下再抬起', () => {
    const p = new FakePlatform();
    const log = listen(p);
    p.touch.tap(5, 6);
    assert.deepEqual(log, ['down:0:5,6', 'up:0:5,6']);
  });

  it('drag 按路径逐点移动，在最后一点抬起', () => {
    const p = new FakePlatform();
    const log = listen(p);
    p.touch.drag([[0, 0], [10, 0], [20, 5]]);
    assert.deepEqual(log, ['down:0:0,0', 'move:0:10,0', 'move:0:20,5', 'up:0:20,5']);
  });

  it('支持多根手指和取消', () => {
    const p = new FakePlatform();
    const log = listen(p);
    p.touch.down(1, 1, 7);
    p.touch.cancel(2, 2, 7);
    assert.deepEqual(log, ['down:7:1,1', 'cancel:7:2,2']);
  });

  it('游戏没有监听时给出明确的错误；drag 路径太短也报错', () => {
    const p = new FakePlatform();
    assert.throws(() => p.touch.tap(0, 0), /onPointer/);
    listen(p);
    assert.throws(() => p.touch.drag([[0, 0]]), /至少要有两个点/);
  });
});

describe('FakePlatform：存储', () => {
  it('没有的 key 返回 fallback', () => {
    const p = new FakePlatform();
    assert.deepEqual(p.storage.get('save', { level: 1 }), { level: 1 });
  });

  it('读出来的是副本，改它不会影响存储', () => {
    const p = new FakePlatform();
    p.storage.set('save', { level: 3, tags: ['a'] });
    const a = p.storage.get<{ level: number; tags: string[] }>('save', { level: 0, tags: [] });
    a.tags.push('b');
    const b = p.storage.get<{ level: number; tags: string[] }>('save', { level: 0, tags: [] });
    assert.deepEqual(b, { level: 3, tags: ['a'] });
  });

  it('数据损坏时返回 fallback', () => {
    const p = new FakePlatform();
    p.setRawStorage('save', '{坏掉的');
    assert.equal(p.storage.get('save', 42), 42);
  });

  it('不能序列化的值会报错', () => {
    const p = new FakePlatform();
    assert.throws(() => p.storage.set('x', undefined), /JSON/);
  });
});

describe('FakePlatform：广告', () => {
  it('激励视频默认看完，并记录广告位', async () => {
    const p = new FakePlatform();
    assert.equal(await p.ads.rewarded('hint'), true);
    assert.deepEqual(p.adLog, [{ kind: 'rewarded', placement: 'hint' }]);
  });

  it('可以按顺序指定结果，用完恢复默认', async () => {
    const p = new FakePlatform();
    p.queueRewardedResults(false, true, false);
    assert.equal(await p.ads.rewarded('hint'), false);
    assert.equal(await p.ads.rewarded('hint'), true);
    assert.equal(await p.ads.rewarded('skip'), false);
    assert.equal(await p.ads.rewarded('skip'), true);
  });

  it('插屏会被记录', async () => {
    const p = new FakePlatform();
    await p.ads.interstitial('between_levels');
    assert.deepEqual(p.adLog, [{ kind: 'interstitial', placement: 'between_levels' }]);
  });
});

describe('FakePlatform：其他能力', () => {
  it('分享、震动、埋点都被记录', () => {
    const p = new FakePlatform();
    p.share({ title: '来整理行李', query: 'level=3' });
    p.vibrate('light');
    p.track('level_start', { level: 1 });
    p.track('hint_click');
    assert.deepEqual(p.shared, [{ title: '来整理行李', query: 'level=3' }]);
    assert.deepEqual(p.vibrations, ['light']);
    assert.deepEqual(p.tracked, [{ event: 'level_start', params: { level: 1 } }, { event: 'hint_click' }]);
  });

  it('前后台回调可以注册多个，由测试触发', () => {
    const p = new FakePlatform();
    const log: string[] = [];
    p.onShow(() => log.push('show1'));
    p.onShow(() => log.push('show2'));
    p.onHide(() => log.push('hide'));
    p.hide();
    p.show();
    assert.deepEqual(log, ['hide', 'show1', 'show2']);
  });

  it('屏幕参数可配置，默认 375×667、dpr 2、没有安全区', () => {
    const d = new FakePlatform();
    assert.deepEqual(d.screen, { width: 375, height: 667, dpr: 2, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
    const c = new FakePlatform({ name: 'douyin', width: 390, height: 844, dpr: 3, safeArea: { top: 47 } });
    assert.equal(c.name, 'douyin');
    assert.equal(c.screen.safeArea.top, 47);
    assert.equal(c.screen.safeArea.bottom, 0);
  });

  it('没有录屏和侧边栏能力', () => {
    const p: Platform = new FakePlatform();
    assert.equal(p.recorder, undefined);
    assert.equal(p.sidebar, undefined);
  });
});
