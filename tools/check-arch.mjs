// 架构检查：按分层规则检查 src/ 里每个文件引用了谁、用了哪些全局对象。
// 规则的说明见 docs/architecture.md，来由见 docs/adr/0002-layering.md。改规则要先写 ADR，三处一起改。
// 分层 tsconfig 拦的是"用了不该有的类型库"，这里拦的是"绕开分层"：
//   - import 方向（含 import type、export from、import()、typeof import()、require）
//   - 引用 npm 包、node 内置模块、src 以外的文件
//   - 业务层直接用 wx / tt / window 等全局对象（tsconfig 拦不住 globalThis 和 declare const wx）
//   - 业务层用 /// <reference> 把类型库带进来
// 用 TypeScript 的解析器读语法树，注释和字符串里的内容不会被误判。
//
// 用法：node tools/check-arch.mjs [--root <目录>]
// 有违规时逐条打印位置、违反的规则和改法，退出码为 1。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// 规则
// ---------------------------------------------------------------------------

/**
 * 分层规则。键是层名：src 下的一级目录，platform 目录再细分成 platform/types（接口）和 platform（各平台实现）。
 * - allow：除本层以外，可以引用哪些层
 * - sameLayer：本层文件之间能否互相引用
 * - business：业务层，不能碰任何运行环境的全局对象，也不能用 /// <reference>
 */
export const LAYERS = {
  core: {
    label: 'core',
    allow: [],
    sameLayer: true,
    business: true,
    hint: 'core 是纯规则，不依赖画面、引擎和平台。把要用的逻辑挪进 core，或者改成由上层调用 core。',
  },
  engine: {
    label: 'engine',
    allow: ['core', 'platform/types'],
    sameLayer: true,
    business: true,
    hint: 'engine 不认识具体的游戏，也不认识具体的平台。平台能力通过 Platform 接口拿，由 entry 传进来。',
  },
  game: {
    label: 'game',
    allow: ['core', 'engine', 'platform/types'],
    sameLayer: true,
    business: true,
    hint: 'game 只能通过 Platform 接口使用平台能力，不能直接引用平台实现。接口不够用时先写 ADR，再扩展 platform/types.ts。',
  },
  'platform/types': {
    label: 'platform/types.ts',
    allow: [],
    sameLayer: false,
    business: true,
    hint: 'platform/types.ts 只放接口声明，用到的类型都在文件里自己声明。',
  },
  platform: {
    label: '平台实现（platform/web、wechat、douyin）',
    allow: ['platform/types'],
    sameLayer: false,
    business: false,
    hint: '平台实现只把平台 API 翻译成 Platform 接口，不含游戏逻辑，平台实现之间也不互相引用。',
  },
  entry: {
    label: 'entry',
    allow: ['core', 'engine', 'game', 'platform/types', 'platform'],
    sameLayer: false,
    business: false,
    hint: '每个入口单独打包成一个平台的产物，入口之间不能互相引用。共用的启动逻辑放进 game。',
  },
};

/** 业务层不能直接使用的全局对象，值是报错时的说明。 */
export const BANNED_GLOBALS = {
  wx: '微信的全局对象',
  tt: '抖音的全局对象',
  GameGlobal: '微信小游戏的全局对象',
  window: '浏览器的全局对象',
  document: '浏览器的全局对象',
  navigator: '浏览器的全局对象',
  localStorage: '浏览器存储，存档改用 platform.storage',
  sessionStorage: '浏览器存储，存档改用 platform.storage',
  globalThis: '全局对象，通过它能绕开平台接口',
};

const CODE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const UNKNOWN_LAYER_HINT = 'src 下只有 core、engine、game、platform、entry 五层，文件要放进其中一层。新增分层要先写 ADR。';

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

/**
 * 路径属于哪一层。rel 是相对仓库根目录、用 / 分隔的路径，可以是文件，也可以是 import 指向的目录。
 * 不在任何层里返回 null。
 */
export function layerOf(rel) {
  const parts = rel.split('/');
  if (parts[0] !== 'src' || parts.length < 2) return null;
  const top = parts[1];
  if (parts.length === 2 && CODE_EXT.test(top)) return null; // src 根目录下的文件
  if (top === 'platform') {
    const noExt = parts.slice(1).join('/').replace(/(?:\.d)?\.(?:[cm]?[jt]s)$/, '');
    return noExt === 'platform/types' ? 'platform/types' : 'platform';
  }
  return Object.hasOwn(LAYERS, top) ? top : null;
}

function describeAllow(layer) {
  const rule = LAYERS[layer];
  const others = rule.allow.map((l) => LAYERS[l].label);
  if (others.length === 0) return rule.sameLayer ? `${rule.label} 只能引用本层文件` : `${rule.label} 不能引用任何文件`;
  return `${rule.label} 只能引用${rule.sameLayer ? '本层和 ' : ' '}${others.join('、')}`;
}

/** 这个标识符是不是属性名、对象的键这类"只是个名字"的位置。 */
function isNameOnly(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p)) return p.name === id;
  if (ts.isQualifiedName(p)) return p.right === id;
  if (
    ts.isPropertyAssignment(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isEnumMember(p)
  ) {
    return p.name === id;
  }
  if (ts.isBindingElement(p) || ts.isImportSpecifier(p)) return p.propertyName === id;
  if (ts.isExportSpecifier(p)) return p.propertyName !== undefined && p.name === id;
  return ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p);
}

/**
 * 检查一个文件。path 是相对仓库根目录、用 / 分隔的路径，text 是文件内容。
 * 返回违规列表，每条是 { file, line, col, rule, message, hint }。src 以外的文件和非代码文件直接返回空列表。
 */
export function checkFile(path, text) {
  if (!path.startsWith('src/') || !CODE_EXT.test(path)) return [];
  const out = [];
  let sf = null;
  const add = (pos, rule, message, hint) => {
    const { line, character } = sf ? sf.getLineAndCharacterOfPosition(pos) : { line: 0, character: 0 };
    out.push({ file: path, line: line + 1, col: character + 1, rule, message, hint });
  };

  if (!path.endsWith('.ts')) {
    add(0, 'ts-only', 'src 里只能写 .ts 文件', '其他脚本不经过类型检查，也绕开了分层 tsconfig。改成 .ts。');
    return out;
  }
  const layer = layerOf(path);
  if (!layer) {
    add(0, 'unknown-layer', '这个文件不在任何分层里', UNKNOWN_LAYER_HINT);
    return out;
  }
  const rule = LAYERS[layer];
  sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const checkSpecifier = (spec, node) => {
    const pos = node.getStart(sf);
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      add(
        pos,
        'package',
        `src 里不能引用 npm 包或 node 内置模块（'${spec}'）`,
        '游戏代码要能直接跑在微信和抖音里，还要控制包体。确实需要第三方库时先写 ADR。',
      );
      return;
    }
    const target = spec.startsWith('/') ? spec : posix.normalize(posix.join(posix.dirname(path), spec));
    if (!target.startsWith('src/')) {
      add(
        pos,
        'outside-src',
        `不能引用 src 以外的文件（'${spec}'）`,
        'src 里的代码会被打包进游戏，test、tools、drafts 里的代码不能进包。',
      );
      return;
    }
    const to = layerOf(target);
    if (!to) {
      add(pos, 'layer', `引用了不在任何分层里的文件（'${spec}'）`, UNKNOWN_LAYER_HINT);
      return;
    }
    const ok = to === layer ? rule.sameLayer : rule.allow.includes(to);
    if (!ok) {
      add(pos, 'layer', `${rule.label} 不能引用 ${LAYERS[to].label}（'${spec}'）。${describeAllow(layer)}`, rule.hint);
    }
  };

  if (rule.business) {
    const directives = [...sf.referencedFiles, ...sf.typeReferenceDirectives, ...sf.libReferenceDirectives];
    for (const d of directives) {
      add(
        d.pos,
        'reference',
        `${rule.label} 不能用 /// <reference> 指令（${d.fileName}）`,
        '它会绕开分层 tsconfig，把浏览器或平台的类型带进来。需要的类型在 platform/types.ts 里声明。',
      );
    }
  }

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) checkSpecifier(expr.text, expr);
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) checkSpecifier(arg.literal.text, arg.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        checkSpecifier(arg.text, arg);
      } else {
        add(
          node.getStart(sf),
          'dynamic-import',
          '动态引用的路径必须是字符串字面量',
          '路径是算出来的就没法检查分层，改成写死的路径。',
        );
      }
    } else if (
      rule.business &&
      ts.isIdentifier(node) &&
      Object.hasOwn(BANNED_GLOBALS, node.text) &&
      !isNameOnly(node)
    ) {
      add(
        node.getStart(sf),
        'global',
        `${rule.label} 不能使用 ${node.text}（${BANNED_GLOBALS[node.text]}）`,
        '平台能力都要经过 Platform 接口，由 entry 传进来。如果只是局部变量重名，换个名字。',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** 检查 root 下整个 src 目录。返回 { files: 检查过的代码文件, violations }。 */
export function checkProject(root) {
  const srcDir = join(root, 'src');
  if (!existsSync(srcDir)) return { files: [], violations: [] };
  const files = listFiles(srcDir)
    .map((abs) => relative(root, abs).split(sep).join('/'))
    .filter((f) => CODE_EXT.test(f))
    .sort();
  const violations = files.flatMap((f) => checkFile(f, readFileSync(join(root, f), 'utf8')));
  return { files, violations };
}

export function format(v) {
  return `✗ ${v.file}:${v.line}:${v.col}  ${v.message}\n    改法：${v.hint}`;
}

// ---------------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--root');
  const root = i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fileURLToPath(new URL('..', import.meta.url));
  const { files, violations } = checkProject(root);
  if (violations.length === 0) {
    console.log(`✓ 架构检查通过（${files.length} 个文件）`);
  } else {
    for (const v of violations) console.log(format(v));
    console.log(`\n架构检查发现 ${violations.length} 处违规（共检查 ${files.length} 个文件）`);
    process.exitCode = 1;
  }
}
