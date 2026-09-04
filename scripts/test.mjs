import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Use the repository's pinned compiler; no new test runtime dependencies.
const sources = ['lib/billing/quipu.ts', 'lib/billing/stripe.ts', 'lib/billing/config.ts',
  'lib/billing/service.ts', 'lib/billing/store.ts', 'app/api/cron/billing-run/route.ts'];
for (const source of sources) {
  const output = `.test-build/${source.replace(/\.ts$/, '.js')}`;
  await mkdir(output.slice(0, output.lastIndexOf('/')), { recursive: true });
  await writeFile(output, ts.transpileModule(await readFile(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText);
}
await writeFile('.test-build/package.json', '{"type":"commonjs"}');
const result = spawnSync(process.execPath, ['--test', 'scripts/tests/billing.cjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
