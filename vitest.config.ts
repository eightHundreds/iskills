import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const opentuiRegister = fileURLToPath(
  new URL('./bin/opentui-register.mjs', import.meta.url)
);

const i18nSetup = ['test/helpers/setup-i18n.ts'];

export default defineConfig({
  test: {
    pool: 'forks',
    execArgv: [`--import=${opentuiRegister}`],
    projects: [
      {
        test: {
          setupFiles: i18nSetup,
          name: 'parallel',
          include: [
            'test/domain/**/*.test.ts',
            'test/i18n/**/*.test.ts',
            'test/commands/**/*.test.ts',
            'test/ui/**/*.{test.ts,test.tsx}',
            'test/bin/**/*.test.ts',
          ],
          exclude: ['test/domain/git/**'],
          maxWorkers: 3,
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: i18nSetup,
          name: 'git',
          include: ['test/domain/git/git.test.ts'],
          fileParallelism: false,
          maxConcurrency: 2,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: i18nSetup,
          name: 'git-sync',
          include: ['test/domain/git/git-sync.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: i18nSetup,
          name: 'git-write',
          include: ['test/domain/git/git-write.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: i18nSetup,
          name: 'git-async',
          include: ['test/domain/git/git-async.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          setupFiles: i18nSetup,
          name: 'tty',
          // PTY sessions are process/CPU heavy; serialize to avoid CI flakes
          // (OpenTUI paints + multi-session key timing races).
          include: ['test/tty/tty.test.ts'],
          fileParallelism: false,
          maxConcurrency: 1,
          sequence: { groupOrder: 2 },
          testTimeout: 60_000,
        },
      },
    ],
  },
});
