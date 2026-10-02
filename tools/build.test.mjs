import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { bundle, TARGETS } from './build.mjs';
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
});
