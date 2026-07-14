import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  ensureCollection,
  isGitSource,
  materializeSkillReferences,
  parseGitSource,
  readState,
  writeState,
} from '../src/core.js';
import {
  makeContext,
  makeSkill,
  run,
  type JsonLink,
  type JsonSkill,
} from './helpers.js';

async function withCollectionEnvironment<T>(
  context: Awaited<ReturnType<typeof makeContext>>,
  action: () => Promise<T>
): Promise<T> {
  const previousHome = process.env.HOME;
  const previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.HOME = context.home;
  process.env.XDG_CONFIG_HOME = context.config;
  try {
    await ensureCollection();
    return await action();
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfig;
  }
}

test('explicit relative paths are not GitHub shorthand', () => {
  assert.equal(isGitSource('./skill'), false);
  assert.equal(isGitSource('../skill'), false);
  assert.equal(isGitSource('owner/repo'), true);
  assert.deepEqual(parseGitSource('./skill'), { url: './skill' });
});

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

test('materializes an arbitrary local Skill reference without changing its source', async () => {
  const context = await makeContext();
  const source = join(context.root, 'source', 'referenced-skill');
  const reference = join(context.project, '.agents/skills/referenced-skill');
  await makeSkill(source, 'referenced-skill');
  await mkdir(join(source, 'docs'), { recursive: true });
  await writeFile(join(source, '.hidden'), 'hidden\n', 'utf8');
  await symlink('../asset.txt', join(source, 'docs/current'));
  await mkdir(dirname(reference), { recursive: true });
  await symlink(source, reference);

  try {
    await withCollectionEnvironment(context, async () => {
      await materializeSkillReferences([
        { name: 'referenced-skill', description: 'Demo skill', path: reference },
      ]);
      assert.equal((await lstat(reference)).isDirectory(), true);
      assert.equal((await lstat(reference)).isSymbolicLink(), false);
      assert.equal((await lstat(join(reference, 'docs/current'))).isSymbolicLink(), false);
      assert.equal(await readFile(join(reference, 'docs/current'), 'utf8'), 'keep me\n');
      assert.equal(await readFile(join(reference, '.hidden'), 'utf8'), 'hidden\n');
      assert.equal((await lstat(source)).isDirectory(), true);
      assert.equal((await lstat(join(source, 'docs/current'))).isSymbolicLink(), true);
      assert.deepEqual((await readState()).links, []);
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('rejects an escaping nested symlink without materializing any selected reference', async () => {
  const context = await makeContext();
  const alphaSource = join(context.root, 'sources/alpha');
  const betaSource = join(context.root, 'sources/beta');
  const alpha = join(context.project, '.agents/skills/alpha');
  const beta = join(context.project, '.agents/skills/beta');
  await makeSkill(alphaSource, 'alpha');
  await makeSkill(betaSource, 'beta');
  await writeFile(join(context.root, 'outside.txt'), 'outside\n', 'utf8');
  await symlink(join(context.root, 'outside.txt'), join(betaSource, 'escape'));
  await mkdir(dirname(alpha), { recursive: true });
  await symlink(alphaSource, alpha);
  await symlink(betaSource, beta);

  try {
    await withCollectionEnvironment(context, async () => {
      await assert.rejects(
        materializeSkillReferences([
          { name: 'alpha', description: 'Demo skill', path: alpha },
          { name: 'beta', description: 'Demo skill', path: beta },
        ]),
        /技能包含指向目录外的软链/
      );
      assert.equal((await lstat(alpha)).isSymbolicLink(), true);
      assert.equal((await lstat(beta)).isSymbolicLink(), true);
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('materializing a collection origin removes dependent state but retains usage links', async () => {
  const context = await makeContext();
  const collected = join(context.collection, 'skills/managed-skill');
  const origin = join(context.project, '.agents/skills/managed-skill');
  const dependent = join(context.project, '.claude/skills/managed-skill');
  const usage = join(context.project, '.codex/skills/managed-skill');

  try {
    await withCollectionEnvironment(context, async () => {
      await makeSkill(collected, 'managed-skill');
      await mkdir(dirname(origin), { recursive: true });
      await mkdir(dirname(dependent), { recursive: true });
      await mkdir(dirname(usage), { recursive: true });
      await symlink(collected, origin);
      await symlink(origin, dependent);
      await symlink(collected, usage);
      await writeState({
        links: [
          { skill: 'managed-skill', path: origin, kind: 'origin' },
          { skill: 'managed-skill', path: dependent, kind: 'dependent' },
          { skill: 'managed-skill', path: usage, kind: 'usage' },
        ],
        conflicts: [],
      });

      await materializeSkillReferences([
        { name: 'managed-skill', description: 'Demo skill', path: origin },
      ]);

      assert.equal((await lstat(origin)).isDirectory(), true);
      assert.equal((await lstat(dependent)).isSymbolicLink(), true);
      const state = await readState();
      assert.deepEqual(state.links, [
        { skill: 'managed-skill', path: usage, kind: 'usage' },
      ]);
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('materializing a collection usage removes only that usage state', async () => {
  const context = await makeContext();
  const collected = join(context.collection, 'skills/usage-skill');
  const converted = join(context.project, '.agents/skills/usage-skill');
  const retained = join(context.project, '.claude/skills/usage-skill');

  try {
    await withCollectionEnvironment(context, async () => {
      await makeSkill(collected, 'usage-skill');
      await mkdir(dirname(converted), { recursive: true });
      await mkdir(dirname(retained), { recursive: true });
      await symlink(collected, converted);
      await symlink(collected, retained);
      await writeState({
        links: [
          { skill: 'usage-skill', path: converted, kind: 'usage' },
          { skill: 'usage-skill', path: retained, kind: 'usage' },
        ],
        conflicts: [],
      });

      await materializeSkillReferences([
        { name: 'usage-skill', description: 'Demo skill', path: converted },
      ]);

      assert.deepEqual((await readState()).links, [
        { skill: 'usage-skill', path: retained, kind: 'usage' },
      ]);
      assert.equal((await lstat(converted)).isDirectory(), true);
      assert.equal((await lstat(retained)).isSymbolicLink(), true);
    });
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

test('existing relative paths take precedence over GitHub shorthand during import', async () => {
  const context = await makeContext();
  const direct = join(context.project, 'direct-skill');
  const nested = join(context.project, 'local-owner', 'nested-skill');
  await makeSkill(direct, 'direct-skill');
  await makeSkill(nested, 'nested-skill');

  try {
    await run(context, ['import', './direct-skill', '--all', '--yes']);
    await run(context, ['import', 'local-owner/nested-skill', '--all', '--yes']);

    assert.equal((await lstat(direct)).isSymbolicLink(), true);
    assert.equal((await lstat(nested)).isSymbolicLink(), true);
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
