import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Game } from '../src/core/game.ts';
import { generateLevel } from '../src/core/levels.ts';
import { Icons, ICON_DIR, iconPath, type ItemIcons } from '../src/game/icons.ts';
import { drawPiece, drawPieceGhost } from '../src/game/pieceView.ts';
import { PlayScene } from '../src/game/PlayScene.ts';
import { FakeCanvas2D, FakePlatform } from './fake-platform.ts';
import { flush, frame, setupSession } from './play-helpers.ts';

// 第 1 关托盘：0 登山靴  1 帽子  2 登山靴  3 书（2×2，图标画大一号）
const BOOT = 0;
const CAP = 1;
const BOOKS = 3;

const piece = (id: number) => {
  const p = new Game(generateLevel(1)).pieces[id];
  assert.ok(p);
  return p;
};
const icon = { width: 192, height: 192 };
const only = (id: string): ItemIcons => ({ get: (x) => (x === id ? icon : null) });
const images = (c: FakeCanvas2D) => c.of('drawImage');
const emoji = (c: FakeCanvas2D, e: string) => c.calls.filter((x) => x.op === 'fillText' && x.args[0] === e);

describe('Icons：读图标', () => {
  it('路径是 assets/icons/<物品 id>.png', () => {
    assert.equal(ICON_DIR, 'assets/icons');
    assert.equal(iconPath('boot'), 'assets/icons/boot.png');
  });

  it('只请求传进来的物品：没传就一个请求都没有', async () => {
    const p = new FakePlatform();
    new Icons(p, []);
    assert.deepEqual(p.imageRequests, []);
    new Icons(p, ['boot', 'cap']);
    assert.deepEqual(p.imageRequests, ['assets/icons/boot.png', 'assets/icons/cap.png']);
  });

  it('读完才有图；读不到（文件不存在）就一直是 null，不影响别的', async () => {
    const p = new FakePlatform();
    p.imageFiles.add(iconPath('boot'));
    p.holdImages = true;
    const icons = new Icons(p, ['boot', 'cap']);
    assert.equal(icons.get('boot'), null, '还没读完');
    p.releaseImages();
    await flush();
    assert.equal(icons.get('boot'), p.images.get(iconPath('boot')));
    assert.equal(icons.get('cap'), null, '没有这个文件');
    assert.equal(icons.get('teddy'), null, '没请求过');
  });

  it('平台违约抛了异常：当作没读到，不会冒出未处理的异常', async () => {
    const p = new FakePlatform();
    p.loadImage = () => Promise.reject(new Error('违约'));
    const icons = new Icons(p, ['boot']);
    await flush();
    assert.equal(icons.get('boot'), null);
  });
});

describe('画物品：有图标就画图标，没有就画 emoji', () => {
  it('有图标：画图标，不画 emoji；图标画在 emoji 原来的位置（物品的标签点）', () => {
    const c = new FakeCanvas2D();
    const p = piece(CAP); // 帽子：1×2，标签在其中一格的中心
    const o = p.item.orients[p.oi];
    assert.ok(o);
    drawPiece(c, p, 100, 200, 40, 0, only('cap'));
    assert.equal(images(c).length, 1);
    assert.equal(emoji(c, '🧢').length, 0);
    const [img, x, y, w, h] = images(c)[0]?.args ?? [];
    assert.equal(img, icon);
    assert.equal(w, 40, '小物品里图标一格大');
    assert.equal(h, 40);
    assert.equal((x as number) + 20, 100 + o.label.x * 40);
    assert.equal((y as number) + 20, 200 + o.label.y * 40);
  });

  it('2×2 以上的实心块里图标画大一号（1.6 格）', () => {
    const c = new FakeCanvas2D();
    drawPiece(c, piece(BOOKS), 0, 0, 50, 0, only('books'));
    assert.equal(images(c)[0]?.args[3], 80);
    assert.equal(images(c)[0]?.args[4], 80);
  });

  it('没有这件物品的图标：画 emoji，和以前一样', () => {
    const c = new FakeCanvas2D();
    drawPiece(c, piece(CAP), 0, 0, 40, 0, only('boot'));
    assert.equal(images(c).length, 0);
    assert.equal(emoji(c, '🧢').length, 1);
  });

  it('没传图标（旧调用方式）：画 emoji', () => {
    const c = new FakeCanvas2D();
    drawPiece(c, piece(CAP), 0, 0, 40);
    assert.equal(emoji(c, '🧢').length, 1);
  });

  it('预览（半透明）里也是图标，并且是半透明画的', () => {
    const c = new FakeCanvas2D();
    drawPieceGhost(c, piece(CAP), 0, 0, 40, 0.5, only('cap'));
    assert.equal(images(c).length, 1);
    assert.equal(images(c)[0]?.style.globalAlpha, 0.5);
    assert.equal(emoji(c, '🧢').length, 0);
  });

  it('画完恢复状态：save 和 restore 配对', () => {
    const c = new FakeCanvas2D();
    drawPiece(c, piece(CAP), 0, 0, 40, 6, only('cap'));
    assert.equal(c.saveDepth, 0);
  });
});

describe('场景里的图标：托盘、箱子、拖动、飞行都用上', () => {
  const sceneWith = (icons: ItemIcons) => {
    const p = new FakePlatform();
    const scene = new PlayScene(p, new Game(generateLevel(1)), undefined, null, icons);
    return { p, scene };
  };

  it('托盘里每件物品一张图标；有图标的物品不再画 emoji', () => {
    const { p, scene } = sceneWith({ get: () => icon });
    scene.render();
    assert.equal(images(p.ctx).length, 4);
    assert.equal(emoji(p.ctx, '🥾').length, 0);
    assert.equal(emoji(p.ctx, '🧢').length, 0);
    assert.equal(emoji(p.ctx, '📚').length, 0);
  });

  it('只有一部分有图标：有的画图标，没有的画 emoji，混着用', () => {
    const { p, scene } = sceneWith(only('books'));
    scene.render();
    assert.equal(images(p.ctx).length, 1);
    assert.equal(emoji(p.ctx, '📚').length, 0);
    assert.equal(emoji(p.ctx, '🧢').length, 1);
    assert.equal(emoji(p.ctx, '🥾').length, 2);
  });

  it('没有图标来源：和以前完全一样，全是 emoji', () => {
    const p = new FakePlatform();
    const scene = new PlayScene(p, new Game(generateLevel(1)));
    scene.render();
    assert.equal(images(p.ctx).length, 0);
    assert.equal(emoji(p.ctx, '📚').length, 1);
  });
});

describe('Session：启动时读图', () => {
  it('入口传了哪些物品有图，就请求哪些，只请求一次', () => {
    const p = new FakePlatform();
    setupSession({ icons: ['boot', 'books'] }, p);
    assert.deepEqual(p.imageRequests, ['assets/icons/boot.png', 'assets/icons/books.png']);
  });

  it('没传（没有素材）：不发任何请求', () => {
    const p = new FakePlatform();
    setupSession({}, p);
    assert.deepEqual(p.imageRequests, []);
  });

  it('图读完之后，画面从 emoji 换成图标；换关之后还在用', async () => {
    const p = new FakePlatform();
    p.imageFiles.add(iconPath('books'));
    p.holdImages = true;
    const s = setupSession({ icons: ['books'] }, p);
    assert.equal(emoji(p.ctx, '📚').length, 1);
    p.releaseImages();
    await flush();
    const calls = frame(p);
    assert.equal(calls.filter((c) => c.op === 'drawImage').length, 1);
    assert.equal(calls.filter((c) => c.op === 'fillText' && c.args[0] === '📚').length, 0);
    assert.ok(s.session.current.game.pieces.length > 0);
  });

  it('图读失败（文件不在）：一直画 emoji，游戏照常能玩', async () => {
    const p = new FakePlatform(); // imageFiles 是空的：所有图都读不到
    setupSession({ icons: ['books', 'cap'] }, p);
    await flush();
    const calls = frame(p);
    assert.equal(calls.filter((c) => c.op === 'drawImage').length, 0);
    assert.equal(calls.filter((c) => c.op === 'fillText' && c.args[0] === '📚').length, 1);
  });
});
