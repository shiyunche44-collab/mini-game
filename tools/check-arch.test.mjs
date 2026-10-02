// check-arch 的自测：确认违规写法确实会被拦下，合法写法不会误报。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile, layerOf } from './check-arch.mjs';

const SCRIPT = fileURLToPath(new URL('./check-arch.mjs', import.meta.url));

/** 只看违反了哪些规则 */
const rules = (path, text) => checkFile(path, text).map((v) => v.rule);

describe('check-arch：分层归属', () => {
  it('按目录归层，platform/types.ts 单独一层', () => {
    assert.equal(layerOf('src/core/rng.ts'), 'core');
    assert.equal(layerOf('src/engine/loop.ts'), 'engine');
    assert.equal(layerOf('src/game/scenes/PlayScene.ts'), 'game');
    assert.equal(layerOf('src/platform/types.ts'), 'platform/types');
    assert.equal(layerOf('src/platform/types'), 'platform/types');
    assert.equal(layerOf('src/platform/wechat.ts'), 'platform');
    assert.equal(layerOf('src/platform/tt.d.ts'), 'platform');
    assert.equal(layerOf('src/entry/web.ts'), 'entry');
    assert.equal(layerOf('src/core'), 'core'); // 指向目录的 import
  });

  it('src 根目录、未知目录、src 以外都不属于任何层', () => {
    assert.equal(layerOf('src/main.ts'), null);
    assert.equal(layerOf('src/utils/a.ts'), null);
    assert.equal(layerOf('test/fake-platform.ts'), null);
  });
});

describe('check-arch：import 方向', () => {
  const allowed = [
    ['src/core/levels.ts', './rng.ts'],
    ['src/engine/loop.ts', '../core/game.ts'],
    ['src/engine/draw.ts', '../platform/types.ts'],
    ['src/engine/input.ts', './tween.ts'],
    ['src/game/PlayScene.ts', '../core/game.ts'],
    ['src/game/PlayScene.ts', '../engine/loop.ts'],
    ['src/game/PlayScene.ts', '../platform/types.ts'],
    ['src/game/PlayScene.ts', './layout.ts'],
    ['src/platform/web.ts', './types.ts'],
    ['src/platform/canvas-compat.check.ts', './types.ts'],
    ['src/entry/wechat.ts', '../core/progress.ts'],
    ['src/entry/wechat.ts', '../engine/loop.ts'],
    ['src/entry/wechat.ts', '../game/start.ts'],
    ['src/entry/wechat.ts', '../platform/wechat.ts'],
    ['src/entry/wechat.ts', '../platform/types.ts'],
  ];
  for (const [file, spec] of allowed) {
    it(`允许：${file} → ${spec}`, () => {
      assert.deepEqual(rules(file, `import { x } from '${spec}';`), []);
    });
  }

  const forbidden = [
    ['src/core/levels.ts', '../game/PlayScene.ts'],
    ['src/core/levels.ts', '../engine/loop.ts'],
    ['src/core/levels.ts', '../platform/types.ts'],
    ['src/core/levels.ts', '../entry/web.ts'],
    ['src/engine/loop.ts', '../game/PlayScene.ts'],
    ['src/engine/loop.ts', '../platform/web.ts'],
    ['src/game/PlayScene.ts', '../platform/wechat.ts'],
    ['src/game/PlayScene.ts', '../entry/web.ts'],
    ['src/platform/types.ts', '../core/rng.ts'],
    ['src/platform/types.ts', './web.ts'],
    ['src/platform/web.ts', '../core/rng.ts'],
    ['src/platform/douyin.ts', '../game/PlayScene.ts'],
    ['src/platform/wechat.ts', './web.ts'],
    ['src/entry/web.ts', './wechat.ts'],
  ];
  for (const [file, spec] of forbidden) {
    it(`拦下：${file} → ${spec}`, () => {
      assert.deepEqual(rules(file, `import { x } from '${spec}';`), ['layer']);
    });
  }

  it('报错写明哪一层不能引用哪一层、能引用什么、怎么改，并带行列号', () => {
    const [v, ...rest] = checkFile('src/core/levels.ts', `// 第一行\nimport { draw } from '../game/PlayScene.ts';\n`);
    assert.equal(rest.length, 0);
    assert.equal(v?.file, 'src/core/levels.ts');
    assert.equal(v?.line, 2);
    assert.equal(v?.col, 22);
    assert.match(v?.message ?? '', /core 不能引用 game（'..\/game\/PlayScene.ts'）/);
    assert.match(v?.message ?? '', /core 只能引用本层文件/);
    assert.match(v?.hint ?? '', /core 是纯规则/);
  });

  it('import type、export from、import()、typeof import()、require 都会检查', () => {
    const src = [
      `import type { A } from '../game/a.ts';`,
      `export { B } from '../game/b.ts';`,
      `export * from '../game/c.ts';`,
      `const m = await import('../game/d.ts');`,
      `type E = typeof import('../game/e.ts');`,
      `type F = import('../game/f.ts').F;`,
      `const g = require('../game/g.ts');`,
    ].join('\n');
    const vs = checkFile('src/core/x.ts', src);
    assert.deepEqual(
      vs.map((v) => [v.line, v.rule]),
      [1, 2, 3, 4, 5, 6, 7].map((l) => [l, 'layer']),
    );
  });

  it('动态引用的路径不是字面量时报错', () => {
    assert.deepEqual(rules('src/game/a.ts', `const name = 'x';\nawait import('./' + name);`), ['dynamic-import']);
  });

  it('注释和字符串里的 import 不算', () => {
    const src = [
      `// import { a } from '../game/a.ts';`,
      `/* export * from '../game/b.ts'; */`,
      `const s = "import x from '../game/c.ts'";`,
      'const t = `require("../game/d.ts")`;',
    ].join('\n');
    assert.deepEqual(rules('src/core/x.ts', src), []);
  });

  it('npm 包和 node 内置模块被拦下，entry 也一样', () => {
    assert.deepEqual(rules('src/core/a.ts', `import lodash from 'lodash';`), ['package']);
    assert.deepEqual(rules('src/game/a.ts', `import fs from 'node:fs';`), ['package']);
    assert.deepEqual(rules('src/entry/web.ts', `import 'some-polyfill';`), ['package']);
  });

  it('引用 src 以外的文件被拦下', () => {
    assert.deepEqual(rules('src/game/a.ts', `import { FakePlatform } from '../../test/fake-platform.ts';`), [
      'outside-src',
    ]);
    assert.deepEqual(rules('src/core/a.ts', `import '../../drafts/rng.js';`), ['outside-src']);
    assert.deepEqual(rules('src/entry/web.ts', `import '/abs/path.ts';`), ['outside-src']);
  });

  it('引用不在任何分层里的文件被拦下', () => {
    assert.deepEqual(rules('src/game/a.ts', `import '../utils/x.ts';`), ['layer']);
    assert.deepEqual(rules('src/game/a.ts', `import '../main.ts';`), ['layer']);
  });
});

describe('check-arch：全局对象', () => {
  const names = ['wx', 'tt', 'GameGlobal', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'globalThis'];
  for (const name of names) {
    it(`业务层不能用 ${name}`, () => {
      for (const file of ['src/core/a.ts', 'src/engine/a.ts', 'src/game/a.ts', 'src/platform/types.ts']) {
        assert.deepEqual(rules(file, `export const v = ${name}.x;`), ['global'], file);
      }
    });
  }

  it('各种写法都能拦下', () => {
    const src = [
      `declare const wx: any;`,
      `(globalThis as any).tt.vibrateShort();`,
      `const w = window['innerWidth'];`,
      `export const o = { document };`,
      `export type T = typeof wx;`,
      'const s = `${navigator.userAgent}`;',
    ].join('\n');
    const vs = checkFile('src/game/a.ts', src);
    assert.deepEqual(
      vs.map((v) => [v.line, v.rule]),
      [
        [1, 'global'],
        [2, 'global'],
        [3, 'global'],
        [4, 'global'],
        [5, 'global'],
        [6, 'global'],
      ],
    );
    assert.match(vs[0]?.message ?? '', /game 不能使用 wx（微信的全局对象）/);
    assert.match(vs[0]?.hint ?? '', /Platform 接口/);
  });

  it('属性名、对象的键、类型成员、注释、字符串不算', () => {
    const src = [
      `// wx.login()`,
      `const a = 'window.innerWidth';`,
      `export const b = { wx: 1, tt: 2, 'document': 3 };`,
      `export interface C { window: number; tt(): void }`,
      `export const d = (o: { navigator: number }) => o.navigator;`,
      `export const { globalThis: e } = { globalThis: 1 };`,
      `export class F { wx = 1; get tt() { return 1; } }`,
      `export function g(this: { window: number }) { return this.window; }`,
    ].join('\n');
    assert.deepEqual(rules('src/game/a.ts', src), []);
  });

  it('平台实现和 entry 可以用', () => {
    assert.deepEqual(rules('src/platform/wechat.ts', `export const c = wx.createCanvas();`), []);
    assert.deepEqual(rules('src/platform/web.ts', `export const w = window.innerWidth;`), []);
    assert.deepEqual(rules('src/entry/douyin.ts', `tt.onShow(() => {});`), []);
  });
});

describe('check-arch：/// <reference> 指令', () => {
  for (const d of ['<reference lib="dom" />', '<reference types="minigame-api-typings" />', '<reference path="../platform/tt.d.ts" />']) {
    it(`业务层不能用 /// ${d}`, () => {
      assert.deepEqual(rules('src/core/a.ts', `/// ${d}\nexport const x = 1;`), ['reference']);
      assert.deepEqual(rules('src/platform/types.ts', `/// ${d}\nexport type X = 1;`), ['reference']);
    });
  }

  it('平台实现可以用', () => {
    assert.deepEqual(rules('src/platform/douyin.ts', `/// <reference path="./tt.d.ts" />\nexport {};`), []);
  });
});

describe('check-arch：文件位置', () => {
  it('src 根目录和未知目录里的文件被拦下', () => {
    assert.deepEqual(rules('src/main.ts', 'export {};'), ['unknown-layer']);
    assert.deepEqual(rules('src/utils/a.ts', 'export {};'), ['unknown-layer']);
  });

  it('src 里只能写 .ts，其他脚本被拦下', () => {
    for (const f of ['src/core/a.js', 'src/game/b.mjs', 'src/engine/c.tsx', 'src/core/d.mts']) {
      assert.deepEqual(rules(f, 'export {};'), ['ts-only'], f);
    }
  });

  it('src 以外的文件和非代码文件不检查', () => {
    assert.deepEqual(rules('test/a.test.ts', `import { x } from '../src/game/a.ts'; window.x;`), []);
    assert.deepEqual(rules('src/core/tsconfig.json', '{ "window": 1 }'), []);
  });
});

// 当前仓库有没有违规由 npm run check 里的架构检查那一步负责，这里不重复检查。
describe('check-arch：命令行', () => {
  it('有违规时打印规则和改法，退出码为 1；修好后退出码为 0', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-arch-'));
    try {
      const write = (rel, text) => {
        mkdirSync(dirname(join(tmp, rel)), { recursive: true });
        writeFileSync(join(tmp, rel), text);
      };
      write('src/game/PlayScene.ts', 'export const scene = 1;\n');
      write('src/core/rng.ts', `import { scene } from '../game/PlayScene.ts';\nexport const w = window.innerWidth + scene;\n`);

      const bad = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stdout, /src\/core\/rng\.ts:1:23 {2}core 不能引用 game/);
      assert.match(bad.stdout, /src\/core\/rng\.ts:2:18 {2}core 不能使用 window/);
      assert.match(bad.stdout, /改法：/);
      assert.match(bad.stdout, /发现 2 处违规（共检查 2 个文件）/);

      write('src/core/rng.ts', 'export const seed = 1;\n');
      const good = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /架构检查通过（2 个文件）/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
