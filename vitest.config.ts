import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'parallel',
          include: [
            'test/browser.test.ts',
            'test/browser-ui.test.tsx',
            'test/cli.test.ts',
            'test/library.test.ts',
            'test/mouse.test.ts',
            'test/ui.test.tsx',
            'test/footer-resolve.test.ts',
          ],
          maxWorkers: 3,
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
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
          name: 'git-sync',
          include: ['test/git-sync.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'git-write',
          include: ['test/git-write.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'git-async',
          include: ['test/git-async.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'tty',
          include: ['test/tty.test.ts'],
          fileParallelism: false,
          maxConcurrency: 4,
          sequence: { groupOrder: 2 },
          testTimeout: 30_000,
        },
      },
    ],
  },
});
