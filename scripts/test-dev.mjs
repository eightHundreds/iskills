#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const register = fileURLToPath(new URL('../bin/opentui-register.mjs', import.meta.url));
const running = new Set();

function hasBun() {
  const result = spawnSync('bun', ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function runVitest(project) {
  console.log(`\n[test:dev] vitest --project ${project}`);
  // OpenTUI native core needs Bun (or Node with node:ffi). Prefer Bun for UI tests.
  const useBun = hasBun();
  const cmd = useBun ? 'bun' : process.execPath;
  const args = useBun
    ? [vitest, 'run', '--project', project]
    : ['--import', register, vitest, 'run', '--project', project];
  if (!useBun) {
    console.warn('[test:dev] bun not found; UI tests that need OpenTUI native may fail under Node without node:ffi');
  }
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: process.env,
  });
  running.add(child);
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      running.delete(child);
      resolve({ project, code, signal });
    });
  });
}

function stopChildren() {
  for (const child of running) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

const fast = await runVitest('parallel');
if (fast.code !== 0) {
  process.exit(fast.code ?? 1);
}

for (const project of ['git', 'git-sync', 'git-write', 'git-async', 'tty']) {
  const result = await runVitest(project);
  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
}

console.log('\n[test:dev] all projects passed');
