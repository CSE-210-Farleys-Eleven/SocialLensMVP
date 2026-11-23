#!/usr/bin/env node
/**
 * Module boundary check. Rules (see AGENTS.md):
 *   - A file in src/<A>/ may import at runtime only from src/<A>/ and src/shared/.
 *   - From any other module it may only `import type` from that module's `contract`.
 *   - Test files follow the same rules.
 * Exits 1 and lists violations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'src');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) files.push(p);
  }
})(root);

const moduleOf = (abs) => relative(root, abs).split(sep)[0];
// import/export ... from '...'  |  import '...'  |  import('...')
const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const problems = [];
for (const file of files) {
  const own = moduleOf(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(re)) {
    const spec = m[3] ?? m[4];
    const typeOnly = Boolean(m[2]);
    if (!spec || !spec.startsWith('.')) continue; // packages are fine
    const target = resolve(dirname(file), spec);
    const rel = relative(root, target);
    if (rel.startsWith('..')) {
      problems.push(`${relative(process.cwd(), file)}: imports outside src/ (${spec})`);
      continue;
    }
    const other = rel.split(sep)[0];
    if (other === own || other === 'shared') continue;
    const isContract = /(^|[\\/])contract$/.test(rel) || /(^|[\\/])contract\.ts$/.test(rel);
    if (!typeOnly || !isContract) {
      problems.push(
        `${relative(process.cwd(), file)}: "${spec}" crosses into module "${other}" (only \`import type\` from its contract is allowed)`,
      );
    }
  }
}

if (problems.length) {
  console.error(`Module boundary violations (${problems.length}):\n` + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`Module boundaries OK (${files.length} files checked).`);
