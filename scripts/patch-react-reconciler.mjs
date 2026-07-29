/**
 * OpenTUI imports `react-reconciler/constants` without `.js`.
 * Node ESM needs an exports map; patch every installed copy under node_modules.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const exportsMap = {
  '.': {
    require: './index.js',
    default: './index.js',
  },
  './constants': {
    require: './constants.js',
    default: './constants.js',
  },
  './constants.js': './constants.js',
  './reflection': {
    require: './reflection.js',
    default: './reflection.js',
  },
  './reflection.js': './reflection.js',
  './package.json': './package.json',
};

function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'react-reconciler') {
        out.push(join(full, 'package.json'));
      } else if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === '.pnpm') {
        walk(full, out, depth + 1);
      } else if (depth < 4) {
        walk(full, out, depth + 1);
      }
    }
  }
}

const targets = [];
walk(join(root, 'node_modules'), targets);

let patched = 0;
for (const pkgPath of targets) {
  try {
    if (!statSync(pkgPath).isFile()) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== 'react-reconciler') continue;
    if (JSON.stringify(pkg.exports) === JSON.stringify(exportsMap)) continue;
    pkg.exports = exportsMap;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    patched += 1;
  } catch {
    // ignore unreadable copies
  }
}

if (patched > 0) {
  console.log(`[patch-react-reconciler] patched ${patched} package.json file(s)`);
}
