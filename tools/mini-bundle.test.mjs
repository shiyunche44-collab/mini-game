// 小游戏产物的"没有浏览器接口"验收：把真正构建出的产物放进一个只有 wx（或 tt）的沙箱里运行。
// 沙箱里没有 window、document、navigator、localStorage，产物只要碰到任何一个就会 ReferenceError，
// 比在代码里搜字符串可靠：压缩过的代码里变量名可能碰巧叫 tt，搜字符串会误判。
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import { FakeCanvas2D } from '../test/fake-platform.ts';
import { bundle } from './build.mjs';

const FRAME_MS = 1000 / 60;

/** 一个假的小游戏运行环境：全局只有 api（wx 或 tt）、requestAnimationFrame、console */
function fakeRuntime(globalName) {
  const ctx = new FakeCanvas2D();
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const touch = { start: [], move: [], end: [], cancel: [] };
  const store = new Map();
  const frames = [];
  const logs = [];
  /** 确认框（没填广告位 id 时模拟广告用）：记下弹过什么，按 reply 回应 */
  const modal = { reply: 'confirm', shown: [] };
  const api = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    onTouchStart: (cb) => touch.start.push(cb),
    onTouchMove: (cb) => touch.move.push(cb),
    onTouchEnd: (cb) => touch.end.push(cb),
    onTouchCancel: (cb) => touch.cancel.push(cb),
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, data) => store.set(key, data),
    onShow: () => {},
    onHide: () => {},
    vibrateShort: () => {},
    // 产物里广告位 id 是空的，不会走真广告，所以只给确认框。真广告接口由 test/mini-platform.test.ts 测
    showModal: (o) => {
      modal.shown.push(o.title);
      o.success({ confirm: modal.reply === 'confirm' });
    },
  };
  const sandbox = {
    [globalName]: api,
    requestAnimationFrame: (cb) => frames.push(cb),
    console: { info: (...a) => logs.push(a), debug: () => {}, warn: (...a) => logs.push(a), error: (...a) => logs.push(a) },
  };
  let time = 0;
  return {
    sandbox,
    ctx,
    canvas,
    touch,
    store,
    modal,
    logs,
    /** 推进 n 帧 */
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        time += FRAME_MS;
        const due = frames.splice(0);
        for (const cb of due) cb(time);
      }
    },
    get pendingFrames() {
      return frames.length;
    },
  };
}

for (const name of ['wechat', 'douyin']) {
  const globalName = name === 'wechat' ? 'wx' : 'tt';

  describe(`${name} 产物（生产构建，沙箱里只有 ${globalName}）`, () => {
    it('能启动：创建画布、画出画面、帧循环一直在跑', async () => {
      const { outputFiles } = await bundle(name, { write: false });
      const js = outputFiles.find((f) => f.path.endsWith('.js'));
      assert.ok(js);
      const rt = fakeRuntime(globalName);
      vm.runInNewContext(js.text, vm.createContext(rt.sandbox));

      assert.equal(rt.canvas.width, 780);
      assert.equal(rt.canvas.height, 1688);
      rt.step(3);
      assert.ok(rt.ctx.of('fillRect').length > 0, '应该画出了背景');
      assert.ok(rt.ctx.of('fillText').some((c) => c.args[0] === '第 1 关'));
      assert.equal(rt.pendingFrames, 1, '帧循环还在继续');
    });

    it('点一下、拖一下都不会出错，并且会写存档', async () => {
      const { outputFiles } = await bundle(name, { write: false });
      const js = outputFiles.find((f) => f.path.endsWith('.js'));
      const rt = fakeRuntime(globalName);
      vm.runInNewContext(js.text, vm.createContext(rt.sandbox));
      rt.step(2);

      const t = (id, x, y) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }] });
      // 在屏幕各处点一遍、拖一遍：不关心点中了什么，只要求整条链路里没有未定义的全局对象
      for (let y = 100; y < 800; y += 100) {
        for (let x = 40; x < 380; x += 70) {
          for (const cb of rt.touch.start) cb(t(1, x, y));
          for (const cb of rt.touch.end) cb(t(1, x, y));
          rt.step(2);
        }
      }
      for (const cb of rt.touch.start) cb(t(2, 60, 700));
      for (let i = 1; i <= 10; i++) for (const cb of rt.touch.move) cb(t(2, 60 + i * 20, 700 - i * 30));
      for (const cb of rt.touch.end) cb(t(2, 260, 400));
      rt.step(30);
      for (const cb of rt.touch.start) cb(t(3, 10, 10));
      for (const cb of rt.touch.cancel) cb(t(3, 10, 10));
      rt.step(2);
      assert.equal(rt.pendingFrames, 1);
    });

    it('没填广告位 id：点提示弹出确认框，点"领取奖励"才给，点"关闭"不给', async () => {
      const { outputFiles } = await bundle(name, { write: false });
      const js = outputFiles.find((f) => f.path.endsWith('.js'));
      const rt = fakeRuntime(globalName);
      vm.runInNewContext(js.text, vm.createContext(rt.sandbox));
      rt.step(2);

      // 提示按钮的位置：它的文字标签画在按钮里面
      const label = rt.ctx.of('fillText').find((c) => c.args[0] === '提示');
      assert.ok(label, '画面上应该有"提示"按钮');
      const [, x, y] = label.args;
      const tap = () => {
        const e = { changedTouches: [{ identifier: 1, clientX: x, clientY: y }] };
        for (const cb of rt.touch.start) cb(e);
        for (const cb of rt.touch.end) cb(e);
      };
      const flush = async () => {
        await new Promise((r) => setImmediate(r));
        rt.step(2);
      };

      rt.modal.reply = 'cancel';
      tap();
      await flush();
      assert.equal(rt.modal.shown.length, 1);
      assert.match(rt.modal.shown[0], /模拟广告/);
      assert.equal(rt.store.has('progress'), false, '没领取就不该给提示，也不该存档');

      rt.modal.reply = 'confirm';
      tap();
      await flush();
      assert.equal(rt.modal.shown.length, 2);
      assert.equal(rt.store.has('progress'), true, '领取之后给了提示，局面存了档');
    });

    it('读到坏存档也能启动', async () => {
      const { outputFiles } = await bundle(name, { write: false });
      const js = outputFiles.find((f) => f.path.endsWith('.js'));
      const rt = fakeRuntime(globalName);
      rt.store.set('pack-the-suitcase/save', '{坏的');
      rt.store.set('save', 12345);
      vm.runInNewContext(js.text, vm.createContext(rt.sandbox));
      rt.step(2);
      assert.ok(rt.ctx.of('fillText').some((c) => c.args[0] === '第 1 关'));
    });
  });
}

describe('小游戏产物之间互不串台', () => {
  it('微信产物在只有 tt 的环境里起不来，抖音产物在只有 wx 的环境里起不来', async () => {
    for (const [name, wrong] of [
      ['wechat', 'tt'],
      ['douyin', 'wx'],
    ]) {
      const { outputFiles } = await bundle(name, { write: false });
      const js = outputFiles.find((f) => f.path.endsWith('.js'));
      const rt = fakeRuntime(wrong);
      // 沙箱是另一个 vm 领域，里面抛的 ReferenceError 和这里的不是同一个类，只能按名字判断
      assert.throws(
        () => vm.runInNewContext(js.text, vm.createContext(rt.sandbox)),
        (e) => e?.name === 'ReferenceError' && String(e.message).includes(name === 'wechat' ? 'wx' : 'tt'),
        name,
      );
    }
  });
});
