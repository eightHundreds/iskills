import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'parallel',
          include: [
            'test/browser.test.ts',
            'test/cli.test.ts',
            'test/library.test.ts',
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
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'tty',
          include: ['test/tty.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
          testTimeout: 30_000,
        },
      },
    ],
  },
});
