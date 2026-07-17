import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chmod, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeContext, makeSkill, run } from './helpers.js';

test('replacement keeps collection writes when the following Git sync fails', async () => {
  const context = await makeContext();
  context.env.SK_NO_BACKGROUND_SYNC = '1';
  const first = join(context.project, 'first/rollback-skill');
  const second = join(context.project, 'second/rollback-skill');
  const usage = join(context.project, '.agents/skills');
  await makeSkill(first, 'rollback-skill');
  await makeSkill(second, 'rollback-skill');
  await writeFile(join(first, 'version.txt'), 'first\n', 'utf8');
  await writeFile(join(second, 'version.txt'), 'second\n', 'utf8');

  try {
    await run(context, ['init']);
    await run(context, ['import', first, '--all', '--yes']);
    await run(context, ['add', 'rollback-skill', '--to', usage]);
    await run(context, ['list', 'rollback-skill', '--note', 'preserved']);
    const hook = join(context.collection, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n', 'utf8');
    await chmod(hook, 0o755);

    const replacement = await run(context, ['import', second, '--all', '--yes', '--replace']);
    assert.match(replacement.stderr, /收藏夹 Git 提交失败/);
    assert.equal(await readFile(join(first, 'version.txt'), 'utf8'), 'first\n');
    assert.equal((await lstat(first)).isDirectory(), true);
    assert.equal((await lstat(second)).isSymbolicLink(), true);
    assert.equal(
      await readFile(join(context.collection, 'skills/rollback-skill/version.txt'), 'utf8'),
      'second\n'
    );
    assert.equal(
      await readFile(join(usage, 'rollback-skill/version.txt'), 'utf8'),
      'second\n'
    );
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/rollback-skill.json'), 'utf8')
    );
    assert.equal(metadata.note, '');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
