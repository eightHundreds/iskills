import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  makeContext,
  makeSkill,
  run,
  type JsonLink,
  type JsonSkill,
} from './helpers.js';

test('local import, add, list, project remove and collection restore form one complete flow', async () => {
  const context = await makeContext();
  const source = join(context.project, 'source', 'demo-skill');
  const target = join(context.project, '.agents/skills');
  await makeSkill(source);

  try {
    await run(context, ['import', source, '--all', '--yes']);
    assert.equal((await lstat(source)).isSymbolicLink(), true);
    assert.equal(
      resolve(dirname(source), await readlink(source)),
      join(context.collection, 'skills/demo-skill')
    );
    assert.equal(
      await readFile(join(context.collection, 'skills/demo-skill/asset.txt'), 'utf8'),
      'keep me\n'
    );

    await run(context, ['add', 'demo-skill', '--to', target]);
    const installed = join(target, 'demo-skill');
    assert.equal((await lstat(installed)).isSymbolicLink(), true);

    const listed = JSON.parse((await run(context, ['list', '--json'])).stdout);
    assert.deepEqual(listed.collection.map((skill: JsonSkill) => skill.name), ['demo-skill']);
    assert.deepEqual(listed.project.map((skill: JsonSkill) => skill.name), ['demo-skill']);

    await run(context, ['remove', 'demo-skill', '--from', target]);
    await assert.rejects(lstat(installed), { code: 'ENOENT' });
    assert.equal((await lstat(join(context.collection, 'skills/demo-skill'))).isDirectory(), true);

    await run(context, ['remove', 'demo-skill', '-g', '--yes']);
    assert.equal((await lstat(source)).isDirectory(), true);
    assert.equal((await lstat(source)).isSymbolicLink(), false);
    await assert.rejects(lstat(join(context.collection, 'skills/demo-skill')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('copy leaves collection management immediately', async () => {
  const context = await makeContext();
  const source = join(context.project, 'source', 'demo-skill');
  const target = join(context.project, 'copies');
  await makeSkill(source);

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await run(context, ['add', 'demo-skill', '--to', target, '--copy']);
    const copied = join(target, 'demo-skill');
    assert.equal((await lstat(copied)).isDirectory(), true);
    assert.equal((await lstat(copied)).isSymbolicLink(), false);

    const state = JSON.parse(await readFile(join(context.collection, '.local/state.json'), 'utf8'));
    assert.equal(state.links.some((link: JsonLink) => link.path === copied), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('collection removal refuses to overwrite a changed origin path', async () => {
  const context = await makeContext();
  const source = join(context.project, 'source', 'demo-skill');
  await makeSkill(source);

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await rm(source);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'foreign.txt'), 'do not overwrite\n', 'utf8');

    await assert.rejects(run(context, ['remove', 'demo-skill', '-g', '--yes']));
    assert.equal(await readFile(join(source, 'foreign.txt'), 'utf8'), 'do not overwrite\n');
    assert.equal((await lstat(join(context.collection, 'skills/demo-skill'))).isDirectory(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('imports multiple Skills from one directory with --all', async () => {
  const context = await makeContext();
  const root = join(context.project, 'skill-set');
  await makeSkill(join(root, 'alpha'), 'alpha');
  await makeSkill(join(root, 'beta'), 'beta');

  try {
    await run(context, ['import', root, '--all', '--yes']);
    assert.equal((await lstat(join(root, 'alpha'))).isSymbolicLink(), true);
    assert.equal((await lstat(join(root, 'beta'))).isSymbolicLink(), true);
    const listed = JSON.parse((await run(context, ['list', '--json'])).stdout);
    assert.deepEqual(
      listed.collection.map((skill: JsonSkill) => skill.name),
      ['alpha', 'beta']
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('same-name import requires explicit replacement and restores the previous origin first', async () => {
  const context = await makeContext();
  const first = join(context.project, 'first/duplicate');
  const second = join(context.project, 'second/duplicate');
  const usage = join(context.project, '.agents/skills');
  await makeSkill(first, 'duplicate');
  await makeSkill(second, 'duplicate');
  await writeFile(join(first, 'version.txt'), 'first\n', 'utf8');
  await writeFile(join(second, 'version.txt'), 'second\n', 'utf8');

  try {
    await run(context, ['import', first, '--all', '--yes']);
    await run(context, ['add', 'duplicate', '--to', usage]);
    await assert.rejects(run(context, ['import', second, '--all', '--yes']));
    assert.equal((await lstat(second)).isDirectory(), true);

    await run(context, ['import', second, '--all', '--yes', '--replace']);
    assert.equal((await lstat(first)).isDirectory(), true);
    assert.equal(await readFile(join(first, 'version.txt'), 'utf8'), 'first\n');
    assert.equal((await lstat(second)).isSymbolicLink(), true);
    assert.equal(
      await readFile(join(context.collection, 'skills/duplicate/version.txt'), 'utf8'),
      'second\n'
    );
    assert.equal(
      await readFile(join(usage, 'duplicate/version.txt'), 'utf8'),
      'second\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
