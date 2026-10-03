import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { findAssetProblems, ICON_SIZE, MAX_ICON_BYTES, MAX_TOTAL_BYTES, readPng } from './check-assets.mjs';

/** 造一个最小的 PNG：颜色类型 colorType，可选 tRNS 块，pad 是在后面补的字节数（模拟文件大） */
function png({ w = ICON_SIZE, h = ICON_SIZE, colorType = 6, trns = false, pad = 0 } = {}) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (colorType === 3) parts.push(chunk('PLTE', Buffer.from([0, 0, 0])));
  if (trns) parts.push(chunk('tRNS', Buffer.from([0])));
  parts.push(chunk('IDAT', deflateSync(Buffer.from([0]))), chunk('IEND', Buffer.alloc(0)));
  if (pad > 0) parts.push(Buffer.alloc(pad));
  return Buffer.concat(parts);
}

const dirs = [];
function dirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'icons-'));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
  return dir;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const IDS = ['boot', 'cap', 'books'];
const problems = (files) => findAssetProblems(dirWith(files), IDS);

describe('素材检查：物品图标', () => {
  it('没有目录、空目录、只有 .gitkeep：没问题（还没出图，游戏画 emoji）', () => {
    assert.deepEqual(findAssetProblems(join(tmpdir(), '不存在的目录'), IDS), []);
    assert.deepEqual(problems({}), []);
    assert.deepEqual(problems({ '.gitkeep': '' }), []);
  });

  it('符合规格的图：没问题（带透明通道的 RGBA，或带 tRNS 的调色板图）', () => {
    assert.deepEqual(problems({ 'boot.png': png() }), []);
    assert.deepEqual(problems({ 'boot.png': png({ colorType: 3, trns: true }), 'cap.png': png({ colorType: 4 }) }), []);
  });

  it('文件名不是物品 id', () => {
    const p = problems({ 'shoe.png': png() });
    assert.equal(p.length, 1);
    assert.match(p[0], /shoe\.png.*没有叫 shoe 的物品/);
  });

  it('大小不对', () => {
    const p = problems({ 'boot.png': png({ w: 128, h: 128 }) });
    assert.match(p.join(), /boot\.png：128×128，必须是 192×192/);
  });

  it('没有透明：RGB（类型 2）、灰度（0）、没有 tRNS 的调色板图（3）都不行', () => {
    for (const colorType of [0, 2, 3]) {
      assert.match(problems({ 'boot.png': png({ colorType }) }).join(), /没有透明通道/, `类型 ${colorType}`);
    }
  });

  it('不是 PNG：扩展名不对，或者内容不是 PNG', () => {
    assert.match(problems({ 'boot.jpg': 'x' }).join(), /boot\.jpg：不是 \.png 文件/);
    assert.match(problems({ 'boot.png': 'GIF89a 假装是 png' }).join(), /boot\.png：不是有效的 PNG/);
  });

  it('单张太大：提示去压缩', () => {
    const p = problems({ 'boot.png': png({ pad: MAX_ICON_BYTES }) });
    assert.match(p.join(), /boot\.png：.*KB，超过 60KB，请压缩/);
  });

  it('总量太大', () => {
    const IDS_MANY = Array.from({ length: 20 }, (_, i) => `item${i}`);
    const files = Object.fromEntries(IDS_MANY.map((id) => [`${id}.png`, png({ pad: MAX_ICON_BYTES - 500 })]));
    const p = findAssetProblems(dirWith(files), IDS_MANY);
    assert.ok(20 * (MAX_ICON_BYTES - 500) > MAX_TOTAL_BYTES);
    assert.match(p.join(), /图标总共 .*KB，超过 1024KB/);
  });

  it('多个问题一次全报出来', () => {
    const p = problems({ 'boot.png': png({ w: 10, h: 10, colorType: 2 }), 'x.png': png() });
    assert.equal(p.length, 3);
  });
});

describe('readPng', () => {
  it('读出宽高、颜色类型、有没有 tRNS', () => {
    assert.deepEqual(readPng(png({ w: 5, h: 7, colorType: 3, trns: true })), { width: 5, height: 7, colorType: 3, hasTrns: true });
    assert.equal(readPng(png({ colorType: 3 })).hasTrns, false);
  });
  it('不是 PNG 返回 null：太短、签名不对', () => {
    assert.equal(readPng(Buffer.alloc(10)), null);
    assert.equal(readPng(Buffer.from('x'.repeat(100))), null);
  });
});
