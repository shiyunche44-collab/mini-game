// npm run check 的总入口：依次跑所有检查。某一项失败也会把后面的跑完，最后汇总，一次看到全部问题。
// 以后加新的检查（比如包体检查），在 STEPS 里加一行。
import { spawnSync } from 'node:child_process';

const STEPS = [
  ['架构检查', 'check:arch'],
  ['类型检查', 'typecheck'],
  ['包体检查', 'check:size'],
  ['素材检查', 'check:assets'],
  ['单元测试', 'test'],
];

const results = STEPS.map(([name, script]) => {
  console.log(`\n=== ${name}（npm run ${script}）===`);
  const r = spawnSync('npm', ['run', '--silent', script], { stdio: 'inherit', shell: process.platform === 'win32' });
  return [name, script, r.status === 0];
});

console.log('\n=== 汇总 ===');
for (const [name, script, ok] of results) console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `（单独重跑：npm run ${script}）`}`);
process.exit(results.every(([, , ok]) => ok) ? 0 : 1);
