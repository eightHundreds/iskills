#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const running = new Set();

function runVitest(project) {
  console.log(`\n[test:dev] vitest --project ${project}`);
  const child = spawn(process.execPath, [vitest, 'run', '--project', project], {
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
  console.error(`[test:dev] ${fast.project} failed`);
  process.exitCode = fast.code ?? 1;
} else {
  console.log('\n[test:dev] running git and tty in parallel');
  const results = await Promise.all([
    runVitest('git'),
    runVitest('tty'),
  ]);
  const failed = results.find((result) => result.code !== 0 || result.signal);
  if (failed) {
    console.error(`[test:dev] ${failed.project} failed`);
    process.exitCode = failed.code ?? 1;
  }
}
