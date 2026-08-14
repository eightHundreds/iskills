import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const opentuiRegister = fileURLToPath(
  new URL('./bin/opentui-register.mjs', import.meta.url)
);

export default defineConfig({
  test: {
    pool: 'forks',
    execArgv: [`--import=${opentuiRegister}`],
    projects: [
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'parallel',
          include: [
            'test/agents.test.ts',
            'test/browser.test.ts',
            'test/browser-ui.test.tsx',
            'test/cli.test.ts',
            'test/create.test.ts',
            'test/library.test.ts',
            'test/collection-match.test.ts',
            'test/mouse.test.ts',
            'test/ui.test.tsx',
            'test/text-input-ctrl-c.test.ts',
            'test/footer-resolve.test.ts',
            'test/opentui-runtime.test.ts',
            'test/overlay-bridge.test.ts',
            'test/bin-runtime.test.ts',
            'test/i18n.test.ts',
            'test/user-config.test.ts',
          ],
          maxWorkers: 3,
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'git',
          include: ['test/git.test.ts'],
          fileParallelism: false,
          maxConcurrency: 2,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'git-sync',
          include: ['test/git-sync.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'git-write',
          include: ['test/git-write.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'git-async',
          include: ['test/git-async.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: ['test/setup-i18n.ts'],
          name: 'tty',
          // PTY sessions are process/CPU heavy; serialize to avoid CI flakes
          // (OpenTUI paints + multi-session key timing races).
          include: ['test/tty.test.ts'],
          fileParallelism: false,
          maxConcurrency: 1,
          sequence: { groupOrder: 2 },
          testTimeout: 60_000,
        },
      },
    ],
  },
});
