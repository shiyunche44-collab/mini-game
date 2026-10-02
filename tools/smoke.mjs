// 浏览器冒烟测试：真的在 Chromium 里把 Web 版玩一遍，防止"单测都过了，页面却打不开 / 摸不动"。
//
// 单测跑在假平台上，碰不到真正的浏览器：画布缩放、触摸事件、localStorage、广告弹层这些只能在这里测。
// 它需要浏览器，所以不在 npm run check 里；CI 里单独跑（.github/workflows/check.yml 的 smoke 任务）。
//
// 用法：npm run smoke（第一次要有 Chromium：npx playwright install chromium）
// 玩法的细节（拖得对不对、存档对不对）单测都测过了，这里只走一条主线，并且只看画布的像素和 localStorage。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';
import { generateLevel } from '../src/core/levels.ts';
import { LIFT_CELLS } from '../src/game/PlayScene.ts';
import { computeLayout } from '../src/game/layout.ts';
import { winButtonRect } from '../src/game/WinOverlay.ts';
import { bundle } from './build.mjs';

const VIEW = { width: 375, height: 667 };
const DPR = 2;
const SCREEN = { ...VIEW, dpr: DPR, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
// 颜色（见 src/game/theme.ts 和 src/core/items.ts）
const EMPTY_CELL = [233, 241, 248]; // 箱子里的空格子
const BOOK = [123, 211, 137]; // 书 #7BD389
const BACKGROUND_TOP = [255, 246, 229];
const PASS_BAND = [232, 96, 76]; // 登机牌的色带

let server;
let browser;
let base;

before(async () => {
  // 用和发布一样的生产构建，在内存里打好包，起一个只认 / 和 /game.js 的小服务器
  const { outputFiles } = await bundle('web', { write: false });
  const js = outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
  const html = readFileSync(new URL('../platforms/web/index.html', import.meta.url), 'utf8');
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    else if (path === '/game.js') res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(js);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** 手机上的页面。收集控制台错误，测试结束时检查 */
async function open(path = '/', { touch = true } = {}) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + path);
  await page.waitForTimeout(300);
  const client = touch ? await context.newCDPSession(page) : null;
  return { context, page, errors, client };
}

/** 画布上某一点（CSS 像素）的颜色 */
const pixel = (page, x, y) =>
  page.evaluate(
    ([x, y, dpr]) => Array.from(document.getElementById('game').getContext('2d').getImageData(x * dpr, y * dpr, 1, 1).data).slice(0, 3),
    [x, y, DPR],
  );
/** 这一点的颜色是不是接近 rgb（容差 6，抗锯齿和半透明会有一点偏差） */
const isColor = (c, rgb) => c.every((v, i) => Math.abs(v - rgb[i]) <= 6);
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('progress') ?? 'null'));
/** 数画布上接近某种颜色的像素有多少 */
const countColor = (page, rgb) =>
  page.evaluate(
    ([rgb, dpr]) => {
      const c = document.getElementById('game');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 6 && Math.abs(d[i + 1] - rgb[1]) < 6 && Math.abs(d[i + 2] - rgb[2]) < 6) n++;
      return n / (dpr * dpr);
    },
    [rgb, DPR],
  );

/** 第 n 关里物品 id 的拖动路线：从托盘里它那一格的中心，拖到它答案位置的手指落点 */
function route(n, id) {
  const level = generateLevel(n);
  const layout = computeLayout(SCREEN, level);
  const piece = level.pieces[id];
  const o = piece.item.orients[piece.startOi];
  const slot = layout.tray.slots[id];
  const t = layout.tray.cell;
  const origin = { x: slot.x + (slot.w - o.w * t) / 2, y: slot.y + (slot.h - o.h * t) / 2 };
  // 按在外框正中，拿起后外框按箱子的格子放大，抓的那一点还在手指下面
  const from = [origin.x + (o.w * t) / 2, origin.y + (o.h * t) / 2];
  const { grid, cell } = layout.board;
  const to = [grid.x + (piece.solution.c + o.w / 2) * cell, grid.y + (piece.solution.r + o.h / 2) * cell + LIFT_CELLS * cell];
  return { from, to, solution: piece.solution, layout };
}

/** 用真实的触摸事件拖：CDP 直接发 touchStart / touchMove / touchEnd，浏览器据此生成 pointer 事件 */
async function touchDrag(client, from, to) {
  const send = (type, p) => client.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p[0], y: p[1] }] : [] });
  await send('touchStart', from);
  for (let i = 1; i <= 10; i++) {
    await send('touchMove', [from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10]);
  }
  await send('touchEnd');
}

describe('Web 版冒烟测试', () => {
  it('页面能打开：没有报错，画布铺满窗口，背景和第 1 关画出来了', async () => {
    const { page, errors, context } = await open();
    const size = await page.evaluate(() => {
      const c = document.getElementById('game');
      return { w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
    });
    assert.deepEqual(size, { w: VIEW.width * DPR, h: VIEW.height * DPR, cssW: '375px', cssH: '667px', scroll: [375, 667] });
    assert.ok(isColor(await pixel(page, 2, 2), BACKGROUND_TOP), '左上角应该是背景的颜色');
    const { board } = computeLayout(SCREEN, generateLevel(1));
    assert.ok(isColor(await pixel(page, board.grid.x + 28, board.grid.y + 28), EMPTY_CELL), '箱子的第一个格子应该是空的');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('触摸拖动：把书拖进箱子，落下后格子变成书的颜色，进度已存档', async () => {
    const { page, client, errors, context } = await open();
    const r = route(1, 3); // 第 1 关：3 号是 2×2 的书
    assert.deepEqual(r.solution, { oi: 0, r: 0, c: 0 });
    await touchDrag(client, r.from, r.to);
    await page.waitForTimeout(400);
    const { grid, cell } = r.layout.board;
    assert.ok(isColor(await pixel(page, grid.x + 10, grid.y + 10), BOOK), '书应该落在箱子左上角');
    const saved = await save(page);
    assert.deepEqual(saved.game.snapshot.pieces[3], [0, 0, 0]);
    assert.equal(saved.level, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('鼠标拖动也行（桌面浏览器）', async () => {
    const { page, errors, context } = await open('/', { touch: false });
    const r = route(1, 3);
    await page.mouse.move(...r.from);
    await page.mouse.down();
    await page.mouse.move(r.from[0] + 20, r.from[1], { steps: 3 });
    await page.mouse.move(...r.to, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const { grid } = r.layout.board;
    assert.ok(isColor(await pixel(page, grid.x + 10, grid.y + 10), BOOK));
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('刷新页面：接着上次的局面，摆好的书还在', async () => {
    const { page, client, context } = await open();
    const r = route(1, 3);
    await touchDrag(client, r.from, r.to);
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(300);
    const { grid } = r.layout.board;
    assert.ok(isColor(await pixel(page, grid.x + 10, grid.y + 10), BOOK));
    await context.close();
  });

  it('提示：提前关闭拿不到，等倒计时领取才给', async () => {
    const { page, errors, context } = await open();
    const { layout } = route(1, 3);
    const { grid } = layout.board;
    const hint = [layout.buttons.hint.x + layout.buttons.hint.w / 2, layout.buttons.hint.y + layout.buttons.hint.h / 2];

    await page.touchscreen.tap(...hint);
    await page.waitForSelector('[data-mock-ad]');
    assert.equal(await page.locator('[data-action=claim]').isDisabled(), true, '倒计时没完不能领');
    await page.locator('[data-action=close]').click();
    await page.waitForTimeout(450);
    assert.equal(await page.locator('[data-mock-ad]').count(), 0);
    assert.ok(isColor(await pixel(page, grid.x + 10, grid.y + 10), EMPTY_CELL), '提前关闭不该给提示');
    assert.equal(await save(page), null);

    await page.touchscreen.tap(...hint);
    await page.waitForSelector('[data-mock-ad]');
    await page.waitForFunction(() => !document.querySelector('[data-action=claim]').disabled, null, { timeout: 6000 });
    await page.locator('[data-action=claim]').click();
    await page.waitForTimeout(500);
    assert.ok(isColor(await pixel(page, grid.x + 10, grid.y + 10), BOOK), '领取之后书应该被摆好');
    assert.equal((await save(page)).game.snapshot.hints, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('通关第 1 关：登机牌出现，存档是第 2 关；点"下一站"进入第 2 关', async () => {
    const { page, client, errors, context } = await open();
    for (let id = 0; id < 4; id++) {
      const r = route(1, id);
      await touchDrag(client, r.from, r.to);
      await page.waitForTimeout(350);
    }
    assert.deepEqual(await save(page), { version: 1, level: 2, game: null, lastInterstitialAt: null });
    await page.waitForTimeout(2200); // 合盖、盖章、登机牌
    assert.ok((await countColor(page, PASS_BAND)) > 3000, '应该看到登机牌上的红色色带');

    const button = winButtonRect(computeLayout(SCREEN, generateLevel(1)), VIEW.height);
    await page.touchscreen.tap(button.x + button.w / 2, button.y + button.h / 2);
    await page.waitForTimeout(400);
    // 第 2 关是 4×4：第 4 行第 4 列的格子只有第 2 关才有
    const l2 = computeLayout(SCREEN, generateLevel(2));
    const { grid, cell } = l2.board;
    assert.ok(isColor(await pixel(page, grid.x + 3.5 * cell, grid.y + 3.5 * cell), EMPTY_CELL), '应该已经是第 2 关的箱子了');
    assert.equal((await save(page)).level, 2);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('跳关：提前关闭不跳，看完才跳；不弹过关画面', async () => {
    const { page, errors, context } = await open();
    const { layout } = route(1, 3);
    const skip = [layout.buttons.skip.x + layout.buttons.skip.w / 2, layout.buttons.skip.y + layout.buttons.skip.h / 2];
    await page.touchscreen.tap(...skip);
    await page.waitForSelector('[data-mock-ad]');
    await page.locator('[data-action=close]').click();
    await page.waitForTimeout(300);
    assert.equal(await save(page), null);

    await page.touchscreen.tap(...skip);
    await page.waitForSelector('[data-mock-ad]');
    await page.waitForFunction(() => !document.querySelector('[data-action=claim]').disabled, null, { timeout: 6000 });
    await page.locator('[data-action=claim]').click();
    await page.waitForTimeout(400);
    assert.deepEqual(await save(page), { version: 1, level: 2, game: null, lastInterstitialAt: null });
    assert.equal(await countColor(page, PASS_BAND) < 3000, true, '跳关不该出现登机牌');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('转屏（宽度变了）会刷新页面重新排版；只有高度变（地址栏收起）不刷新', async () => {
    const { page, context } = await open();
    await page.evaluate(() => (window.__alive = true));
    await page.setViewportSize({ width: 375, height: 600 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__alive === true), true, '只变高度不该刷新');

    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__alive === true), false, '宽度变了应该刷新');
    const width = await page.evaluate(() => document.getElementById('game').width);
    assert.equal(width, 667 * DPR, '刷新之后画布按新宽度排版');
    await context.close();
  });
});
