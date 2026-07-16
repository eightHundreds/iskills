import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  makeContext,
  makeSkill,
  run,
  type JsonSkill,
} from './helpers.js';
import {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
} from '../src/ui/browser-state.js';
import {
  browserFrameDimensions,
  detailFrameDimensions,
} from '../src/ui/browser.js';

test('browser state stores are isolated between screens', () => {
  const first = createBrowserStore({
    tab: 'collection',
    query: 'alpha',
    cursor: 1,
    selected: ['alpha'],
    agent: 'codex',
    focus: 'list',
  });
  const second = createBrowserStore({
    tab: 'project',
    query: 'beta',
    cursor: 0,
    selected: ['beta'],
    agent: 'claude',
    focus: 'tabs',
  });

  first.set(browserSelectionAtom, new Set(['alpha', 'gamma']));
  first.set(browserNavigationAtom, {
    ...first.get(browserNavigationAtom),
    query: 'updated',
  });

  assert.deepEqual([...first.get(browserSelectionAtom)], ['alpha', 'gamma']);
  assert.deepEqual([...second.get(browserSelectionAtom)], ['beta']);
  assert.equal(first.get(browserNavigationAtom).query, 'updated');
  assert.equal(second.get(browserNavigationAtom).query, 'beta');
});

test('browser and detail frames preserve the same dimensions', () => {
  const browserFrame = browserFrameDimensions({
    rows: 30,
    columns: 100,
    projectRows: 7,
    globalRows: 28,
    collectionRows: 56,
    hasProjectAgents: true,
    hasGlobalAgents: true,
  });
  assert.deepEqual(browserFrame, {
    frameHeight: 24,
    frameWidth: 100,
    listViewportHeight: 20,
  });
  assert.deepEqual(
    detailFrameDimensions(browserFrame.frameHeight, browserFrame.frameWidth, 30),
    { height: 24, width: 100 }
  );
  assert.deepEqual(detailFrameDimensions(7, 40, 10), { height: 6, width: 40 });
});

test('imports through an existing Agent symlink without losing its canonical directory', async () => {
  const context = await makeContext();
  const canonical = join(context.home, '.agents/skills/linked-skill');
  const agentPath = join(context.home, '.codex/skills/linked-skill');
  await makeSkill(canonical, 'linked-skill');
  await mkdir(dirname(agentPath), { recursive: true });
  await symlink(canonical, agentPath);

  try {
    await run(context, ['import', agentPath, '--all', '--yes']);
    const collected = join(context.collection, 'skills/linked-skill');
    assert.equal((await lstat(collected)).isDirectory(), true);
    assert.equal((await lstat(canonical)).isSymbolicLink(), true);
    assert.equal((await lstat(agentPath)).isSymbolicLink(), true);
    assert.equal(await readFile(join(agentPath, 'asset.txt'), 'utf8'), 'keep me\n');

    await run(context, ['remove', 'linked-skill', '-g', '--yes']);
    assert.equal((await lstat(canonical)).isDirectory(), true);
    assert.equal((await lstat(agentPath)).isSymbolicLink(), true);
    assert.equal(await readFile(join(agentPath, 'asset.txt'), 'utf8'), 'keep me\n');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('adds one collected Skill to multiple detected Agent targets', async () => {
  const context = await makeContext();
  const source = join(context.project, 'multi-agent-skill');
  await makeSkill(source, 'multi-agent-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await run(context, [
      'add',
      'multi-agent-skill',
      '--agent',
      'codex',
      '--agent',
      'claude',
    ]);
    assert.equal(
      (await lstat(join(context.project, '.agents/skills/multi-agent-skill'))).isSymbolicLink(),
      true
    );
    assert.equal(
      (await lstat(join(context.project, '.claude/skills/multi-agent-skill'))).isSymbolicLink(),
      true
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('edits detail metadata non-interactively and searches it from both list tabs', async () => {
  const context = await makeContext();
  const source = join(context.project, 'metadata-skill');
  await makeSkill(source, 'metadata-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await run(context, ['add', 'metadata-skill', '--to', join(context.project, '.agents/skills')]);
    await run(context, [
      'list',
      'metadata-skill',
      '--note',
      'important frontend helper',
      '--tags',
      'frontend,design',
      '--json',
    ]);

    const result = JSON.parse((await run(context, ['list', 'important', '--json'])).stdout);
    assert.deepEqual(result.collection.map((skill: JsonSkill) => skill.name), ['metadata-skill']);
    assert.deepEqual(result.project.map((skill: JsonSkill) => skill.name), ['metadata-skill']);
    assert.deepEqual(result.collection[0].tags, ['frontend', 'design']);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('tag editor accepts new tags non-interactively', async () => {
  const context = await makeContext();
  const root = join(context.project, 'tag-editor-skills');
  await makeSkill(join(root, 'alpha'), 'alpha');
  await makeSkill(join(root, 'beta'), 'beta');

  try {
    await run(context, ['import', root, '--all', '--yes']);
    await run(context, ['list', 'alpha', '--tags', 'frontend,shared', '--json']);
    await run(context, ['list', 'beta', '--tags', 'frontend,custom', '--json']);

    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/beta.json'), 'utf8')
    );
    assert.deepEqual(metadata.tags, ['frontend', 'custom']);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('list note updates collection metadata non-interactively', async () => {
  const context = await makeContext();
  const source = join(context.project, 'interactive-skill');
  await makeSkill(source, 'interactive-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await run(context, ['list', 'interactive-skill', '--note', 'written from tty', '--json']);

    const result = JSON.parse((await run(context, ['list', 'written', '--json'])).stdout);
    assert.deepEqual(result.collection.map((skill: JsonSkill) => skill.name), ['interactive-skill']);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/interactive-skill.json'), 'utf8')
    );
    assert.equal(metadata.note, 'written from tty');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('entry adds selected skills from collection browser', async () => {
  const context = await makeContext();
  const source = join(context.project, 'browser-add-skill');
  await makeSkill(source, 'browser-add-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await run(context, ['add', 'browser-add-skill']);
    assert.match(result.stdout, /已添加 1 个技能/);
    assert.equal(
      (await lstat(join(context.project, '.agents/skills/browser-add-skill'))).isSymbolicLink(),
      true
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('collection browser adds selected skills to multiple global Agents', async () => {
  const context = await makeContext();
  const source = join(context.project, 'global-browser-skill');
  await makeSkill(source, 'global-browser-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await run(context, [
      'add',
      'global-browser-skill',
      '-g',
      '--agent',
      'codex',
      '--agent',
      'claude',
      '--yes',
    ]);
    assert.match(result.stdout, /已添加 1 个技能到 2 个目录/);
    assert.equal(
      (await lstat(join(context.home, '.codex/skills/global-browser-skill'))).isSymbolicLink(),
      true
    );
    assert.equal(
      (await lstat(join(context.home, '.claude/skills/global-browser-skill'))).isSymbolicLink(),
      true
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('global skill groups discover and import local skills', async () => {
  const context = await makeContext();
  const skill = join(context.home, '.codex/skills/local-global');
  await makeSkill(skill, 'local-global');

  try {
    await run(context, ['import', '-g', '--agent', 'codex', '--all', '--yes']);
    assert.equal((await lstat(skill)).isSymbolicLink(), true);
    assert.equal(
      await readFile(join(context.collection, 'skills/local-global/SKILL.md'), 'utf8').then(Boolean),
      true
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
