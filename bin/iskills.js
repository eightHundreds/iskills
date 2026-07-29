#!/usr/bin/env node

/**
 * Public entry: prefer a runtime that can load OpenTUI's native Zig core.
 *
 * - Bun: full CLI + interactive TUI
 * - Node with node:ffi: full CLI + interactive TUI (when available)
 * - Node without FFI: non-interactive CLI still works; re-exec under Bun when
 *   `bun` is on PATH so interactive browser/search/prompts match interactive TUI UX
 *
 * Set ISKILLS_FORCE_NODE=1 to skip Bun re-exec (tests / debugging).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const FORCE_NODE = process.env.ISKILLS_FORCE_NODE === '1';
const ALREADY_REEXEC = process.env.ISKILLS_RUNTIME === '1';

function isBunRuntime() {
  return Boolean(process.versions.bun) || typeof globalThis.Bun !== 'undefined';
}

function nodeHasFfi() {
  try {
    createRequire(import.meta.url)('node:ffi');
    return true;
  } catch {
    return false;
  }
}

function findBun() {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(whichCmd, ['bun'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) return undefined;
  const first = (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (first && existsSync(first)) return first;
  return undefined;
}

function shouldReexecToBun() {
  if (FORCE_NODE || ALREADY_REEXEC || isBunRuntime()) return false;
  if (nodeHasFfi()) return false;
  return Boolean(findBun());
}

if (shouldReexecToBun()) {
  const bun = findBun();
  if (bun) {
    const self = fileURLToPath(import.meta.url);
    const result = spawnSync(bun, [self, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ISKILLS_RUNTIME: '1',
      },
    });
    if (result.error) {
      console.error(`错误：无法启动 Bun 运行时：${result.error.message}`);
      process.exitCode = 1;
    } else {
      process.exit(result.status ?? 1);
    }
  }
}

// OpenTUI + react-reconciler need an ESM resolve hook under Node (extensionless subpaths).
// Bun resolves those without the hook; registering is harmless.
await import('./opentui-register.mjs');

const { main } = await import('../dist/src/cli.js');
const { InterruptError } = await import('../dist/src/ui/shell/terminal.js');

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
