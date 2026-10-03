import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { bundle, iconIds, TARGETS } from './build.mjs';
import { LIMIT_BYTES, measure } from './check-size.mjs';

describe('构建', () => {
  it('web 产物是一个自包含的脚本：没有 import、require，也没有 node 内置模块', async () => {
    const { outputFiles } = await bundle('web', { write: false });
    const js = outputFiles.filter((f) => f.path.endsWith('.js'));
    assert.equal(js.length, 1);
    const text = js[0]?.text ?? '';
    assert.doesNotMatch(text, /\brequire\(|\bimport\s*[({"']|node:/);
    assert.ok(text.startsWith('(()=>{'), '应该是 IIFE');
  });

  it('生产构建会清空输出目录：之前留下的旧文件（比如开发时的 sourcemap）不会混进产物', async () => {
    const root = join(fileURLToPath(import.meta.url), '..', '..');
    const stale = join(root, TARGETS.web.outdir, 'game.js.map');
    mkdirSync(join(root, TARGETS.web.outdir), { recursive: true });
    writeFileSync(stale, 'old');
    await bundle('web');
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(join(root, TARGETS.web.outdir, 'game.js')), true);
    assert.equal(existsSync(join(root, TARGETS.web.outdir, 'index.html')), true);
  });

  it('不认识的平台报错，并列出现有的', async () => {
    await assert.rejects(() => bundle('nope'), /没有这个平台.*web/);
  });
});

describe('包体检查', () => {
  it('每个平台都在上限以内', async () => {
    const sizes = await measure();
    assert.ok(Object.keys(sizes).length > 0);
    for (const [name, bytes] of Object.entries(sizes)) assert.ok(bytes > 0 && bytes <= LIMIT_BYTES, `${name} 的产物 ${bytes} 字节`);
  });

  it('扫描素材目录：只认 .png，文件名去掉扩展名，排好序（保证每次构建一样）；目录不存在就是空', () => {
    assert.deepEqual(iconIds(join(tmpdir(), '不存在的目录')), []);
    const dir = mkdtempSync(join(tmpdir(), 'icons-'));
    try {
      for (const f of ['teddy.png', 'boot.png', '.gitkeep', 'notes.txt', 'cap.jpg']) writeFileSync(join(dir, f), 'x');
      assert.deepEqual(iconIds(dir), ['boot', 'teddy']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('扫描结果作为常量编进产物：现在没有素材，是空数组', async () => {
    const { outputFiles } = await bundle('web', { write: false });
    const text = outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
    assert.doesNotMatch(text, /__ICON_IDS__/, '常量应该已经被替换掉了');
  });
});
