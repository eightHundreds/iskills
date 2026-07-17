import { test } from 'vitest';
import assert from 'node:assert/strict';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec, makeContext, makeSkill, run } from './helpers.js';

test('background collection sync merges clean remote changes without blocking the active tree', async () => {
  const context = await makeContext();
  context.env.SK_NO_BACKGROUND_SYNC = '1';
  const collection = context.collection;
  const remote = join(context.root, 'collection.git');
  const other = join(context.root, 'other');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });

    const first = join(context.project, 'first-local');
    await makeSkill(first, 'first-local');
    await run(context, ['import', first, '--all', '--yes']);
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd: collection });

    await exec('git', ['clone', remote, other]);
    await makeSkill(join(other, 'skills/remote-only'), 'remote-only');
    await writeFile(
      join(other, 'metadata/remote-only.json'),
      '{"name":"remote-only","description":"Demo skill","tags":[],"note":"","source":{"type":"unknown"}}\n',
      'utf8'
    );
    await exec('git', ['add', '.'], { cwd: other });
    await exec('git', ['commit', '-m', 'remote-only'], { cwd: other });
    await exec('git', ['push'], { cwd: other });

    const second = join(context.project, 'second-local');
    await makeSkill(second, 'second-local');
    await run(context, ['import', second, '--all', '--yes']);
    await run(context, ['sync', '--background']);

    assert.equal((await lstat(join(collection, 'skills/remote-only'))).isDirectory(), true);
    const remoteSkill = await exec(
      'git',
      ['--git-dir', remote, 'show', 'main:skills/second-local/SKILL.md'],
      { encoding: 'utf8' }
    );
    assert.match(remoteSkill.stdout, /name: second-local/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('background collection sync records divergence without writing conflict markers into the collection', async () => {
  const context = await makeContext();
  context.env.SK_NO_BACKGROUND_SYNC = '1';
  const collection = context.collection;
  const remote = join(context.root, 'collection-conflict.git');
  const other = join(context.root, 'other-conflict');
  const source = join(context.project, 'conflict-skill');
  await makeSkill(source, 'conflict-skill');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });
    await run(context, ['import', source, '--all', '--yes']);
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd: collection });

    await exec('git', ['clone', remote, other]);
    const remoteMetadata = join(other, 'metadata/conflict-skill.json');
    const remoteValue = JSON.parse(await readFile(remoteMetadata, 'utf8'));
    remoteValue.note = 'remote note';
    await writeFile(remoteMetadata, `${JSON.stringify(remoteValue, null, 2)}\n`, 'utf8');
    await exec('git', ['add', '.'], { cwd: other });
    await exec('git', ['commit', '-m', 'remote note'], { cwd: other });
    await exec('git', ['push'], { cwd: other });

    const localMetadata = join(collection, 'metadata/conflict-skill.json');
    const localValue = JSON.parse(await readFile(localMetadata, 'utf8'));
    localValue.note = 'local note';
    await writeFile(localMetadata, `${JSON.stringify(localValue, null, 2)}\n`, 'utf8');
    await run(context, ['list', '--json']);
    await run(context, ['sync', '--background']);

    const conflictPath = join(collection, '.local/collection-conflict.json');
    const state = JSON.parse(await readFile(conflictPath, 'utf8'));
    assert.equal(state.type, 'collection');
    assert.equal(JSON.parse(await readFile(localMetadata, 'utf8')).note, 'local note');
    assert.doesNotMatch(await readFile(localMetadata, 'utf8'), /<{7}|={7}|>{7}/);

    await run(context, ['list', '--json']);
    const nextRunState = JSON.parse(await readFile(conflictPath, 'utf8'));
    assert.equal(nextRunState.type, 'collection');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
