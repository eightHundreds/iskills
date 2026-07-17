import { test } from 'vitest';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { exec, makeContext, makeSkill, run } from './helpers.js';

test('a mutating command returns while its detached Git sync pushes in the background', async () => {
  const context = await makeContext();
  const collection = context.collection;
  const remote = join(context.root, 'async-sync.git');
  const source = join(context.project, 'async-skill');
  await makeSkill(source, 'async-skill');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });
    await exec('git', ['add', '.gitignore'], { cwd: collection });
    await exec('git', ['commit', '-m', 'initial'], { cwd: collection });
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd: collection });

    await run(context, ['import', source, '--all', '--yes']);
    let pushed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await exec('git', [
          '--git-dir',
          remote,
          'cat-file',
          '-e',
          'main:skills/async-skill/SKILL.md',
        ]);
        pushed = true;
        break;
      } catch {
        await delay(50);
      }
    }
    assert.equal(pushed, true, 'background process did not push within five seconds');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
