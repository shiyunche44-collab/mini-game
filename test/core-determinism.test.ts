// ADR 0003：关卡生成在所有设备上结果必须一致。
// core 里不能出现结果允许因引擎而异、或者依赖时间的写法。这里用 TypeScript 的解析器查语法树，
// 注释和字符串里提到这些名字不算。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 规范允许各引擎给出近似结果的 Math 函数，加上随机数。sqrt、floor、imul、min、max、abs 这些结果确定，可以用。
const BANNED_MATH = new Set([
  'pow', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'cbrt', 'hypot', 'random',
]);
// 读时间、读本地语言设置，都会让结果随设备变化
const BANNED_GLOBALS = new Set(['Date', 'performance', 'Intl']);

const CORE_DIR = new URL('../src/core/', import.meta.url);

/** 返回违规写法的描述，格式：文件:行 说明 */
export function findNondeterminism(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const add = (node: ts.Node, what: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push(`${file}:${line + 1} ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math') {
      if (BANNED_MATH.has(node.name.text)) add(node, `Math.${node.name.text}`);
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math') {
      add(node, 'Math[...]（看不出用的是哪个函数）');
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AsteriskAsteriskToken || op === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
        add(node, '** 幂运算（和 Math.pow 一样允许近似）');
      }
    } else if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      const p = node.parent;
      const nameOnly =
        (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node);
      if (!nameOnly) add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('core 里没有跨设备结果可能不一致的写法', () => {
  it('能检查出这些写法（检查本身没坏）', () => {
    const bad = [
      'export const a = Math.pow(2, 0.5);',
      'export const b = 2 ** 0.5;',
      'export let c = 2; c **= 0.5;',
      'export const d = Math.sin(1) + Math.exp(1) + Math.log(2) + Math.cbrt(8) + Math.hypot(3, 4);',
      'export const e = Math.random();',
      'export const f = Date.now();',
      'export const g = new Date();',
      'export const h = performance.now();',
      'export const i = Math["pow"](2, 3);',
    ];
    for (const src of bad) assert.ok(findNondeterminism('x.ts', src).length > 0, src);
  });

  it('结果确定的写法、注释和字符串里的名字、同名的属性不算', () => {
    const good = [
      'export const a = Math.floor(1.5) + Math.imul(3, 4) + Math.sqrt(2) + Math.min(1, 2) + Math.max(1, 2) + Math.abs(-1);',
      '// 不用 Math.pow、Date.now()、2 ** 3',
      'export const s = "Math.random() and Date.now()";',
      'export const o = { Date: 1, performance: 2 };',
      'export const t = o.Date + o.performance;',
    ];
    for (const src of good) assert.deepEqual(findNondeterminism('x.ts', src), [], src);
  });

  it('src/core 下所有文件都没有', () => {
    const files = readdirSync(CORE_DIR, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    assert.ok(files.length > 0);
    const found = files.flatMap((f) =>
      findNondeterminism(`src/core/${f}`, readFileSync(fileURLToPath(new URL(f, CORE_DIR)), 'utf8')),
    );
    assert.deepEqual(found, []);
  });
});
