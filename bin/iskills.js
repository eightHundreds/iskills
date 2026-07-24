#!/usr/bin/env node

import { main } from '../dist/src/cli.js';

import { InterruptError } from '../dist/src/contracts/terminal.js';

main().catch((error) => {
  if (
    error instanceof InterruptError ||
    (error instanceof Error && error.name === 'InterruptError')
  ) {
    process.exitCode = 130;
    return;
  }
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
