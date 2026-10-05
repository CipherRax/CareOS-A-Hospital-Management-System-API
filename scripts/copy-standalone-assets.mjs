/**
 * Copies the static assets Next.js leaves out of the standalone bundle.
 *
 * `output: 'standalone'` emits a self-contained server with its own minimal
 * node_modules, but it deliberately does NOT copy `.next/static` or `public/`.
 * Without this step the server starts, returns HTML with 404s for every stylesheet
 * and script, and the page renders unstyled and non-interactive.
 *
 * That failure mode is nasty because it looks healthy: a 200 response, valid
 * markup, correct server-rendered theme attributes. It only shows up in a browser,
 * which is why it belongs in `postbuild` rather than in a deployment checklist.
 */
import { cp, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const standalone = resolve(root, '.next/standalone');

const targets = [
  { from: resolve(root, '.next/static'), to: resolve(standalone, '.next/static') },
  { from: resolve(root, 'public'), to: resolve(standalone, 'public') },
];

await access(standalone).catch(() => {
  throw new Error('.next/standalone not found. This script must run after `next build`.');
});

let copied = 0;
for (const { from, to } of targets) {
  try {
    await access(from);
  } catch {
    // `public/` is optional; a project with no static files has no such directory.
    console.log(`postbuild  skipped ${from} (not present)`);
    continue;
  }
  await cp(from, to, { recursive: true });
  copied += 1;
  console.log(`postbuild  copied ${from.replace(`${root}/`, '')} -> .next/standalone/`);
}

console.log(`postbuild  standalone bundle is runnable (${copied} asset tree(s) copied).`);
