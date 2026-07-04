#!/usr/bin/env node

import { main } from '../dist/src/cli.js';

main().catch((error) => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
