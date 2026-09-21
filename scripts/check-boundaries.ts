/**
 * Boundary check beyond dependency-cruiser:
 *  - A module's repository (*.repository.ts) may only be imported from within
 *    the same module directory. Repositories are private implementation detail.
 *  - common/ config/ database/ layers must not import feature modules.
 *
 * Import-string matching (no full AST) is sufficient: cross-module repository
 * imports necessarily reference the target module path in the import string.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Invoked from the repository root (npm run boundaries).
const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/(\.ts|\.tsx)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
      yield full;
    }
  }
}

function moduleOf(file: string): string | null {
  const rel = relative(SRC, file);
  const match = /^modules\/([^/]+)\//.exec(rel);
  return match?.[1] ?? null;
}

const errors: string[] = [];

for (const file of walk(SRC)) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(SRC, file);
  const ownModule = moduleOf(file);

  for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const imp = match[1] ?? '';
    if (imp.startsWith('.')) continue;

    const targetModule = /modules\/([^/]+)\//.exec(imp)?.[1];
    if (targetModule && imp.endsWith('.repository')) {
      if (ownModule !== targetModule) {
        errors.push(
          `${rel}: imports repository from foreign module '${targetModule}': ${imp}`,
        );
      }
    }

    if (/^@app\/(common|config|database)\//.test(imp)) continue;
    if (imp.includes('/modules/') && !ownModule) {
      const fromLayer =
        /^@app\/(common|config|database)\//.exec(imp) ??
        /^(\.|@app\/)/.exec(imp);
      if (fromLayer) {
        errors.push(`${rel}: ${imp} — shared/layer code must not import modules`);
      }
    }
  }
}

if (!existsSync(SRC)) {
  console.error('src/ not found; nothing to check');
  process.exit(0);
}

if (errors.length > 0) {
  console.error('Boundary violations:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('Boundary check passed.');