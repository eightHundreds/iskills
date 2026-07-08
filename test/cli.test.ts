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
import { join } from 'node:path';
import {
  makeContext,
  makeSkill,
  run,
  type JsonSkill,
} from './helpers.js';

test('subcommand --help and -h print command-specific help', async () => {
  const context = await makeContext();
  try {
    const cases: Array<{ command: string; patterns: RegExp[] }> = [
      {
        command: 'search',
        patterns: [/iskills search \[关键词\]/, /skills\.sh/, /保存到收藏夹/],
      },
      {
        command: 'add',
        patterns: [/iskills add \[技能/, /--copy/, /--to <目录>/],
      },
      {
        command: 'import',
        patterns: [/iskills import \[路径或 Git URL\]/, /--replace/, /--all/],
      },
      {
        command: 'list',
        patterns: [/iskills list \[关键词\]/, /--json/, /--note <文本>/],
      },
      {
        command: 'remove',
        patterns: [/iskills remove <技能>/, /--from <目录>/, /-g, --global/],
      },
      {
        command: 'update',
        patterns: [/iskills update \[技能/, /--all/, /-y, --yes/],
      },
      {
        command: 'sync',
        patterns: [/iskills sync/, /--background/],
      },
      {
        command: 'init',
        patterns: [/iskills init/, /初始化收藏夹 Git/, /--remote <Git URL>/],
      },
    ];
    for (const { command, patterns } of cases) {
      await Promise.all([
        [command, '--help'],
        [command, '-h'],
        ['help', command],
        ['--help', command],
        ['-h', command],
      ].map(async (args) => {
        const result = await run(context, args);
        for (const pattern of patterns) {
          assert.match(result.stdout, pattern, `${args.join(' ')} should match ${pattern}`);
        }
        assert.equal(result.stderr, '', `${args.join(' ')} should not write stderr`);
      }));
    }
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('search requires a TTY unless a non-interactive mode is selected', async () => {
  const context = await makeContext();
  try {
    await assert.rejects(run(context, ['search', 'react']), /stdin 和 stdout TTY/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('rejects Skill symlinks that escape the imported directory', async () => {
  const context = await makeContext();
  const source = join(context.project, 'unsafe-skill');
  const secret = join(context.project, 'secret.txt');
  await makeSkill(source, 'unsafe-skill');
  await writeFile(secret, 'secret\n', 'utf8');
  await symlink(secret, join(source, 'escape'));

  try {
    await assert.rejects(run(context, ['import', source, '--all', '--yes']));
    assert.equal((await lstat(source)).isDirectory(), true);
    await assert.rejects(lstat(join(context.collection, 'skills/unsafe-skill')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('scans a selected common global Agent directory with import -g', async () => {
  const context = await makeContext();
  const globalSkill = join(context.home, '.codex/skills/global-skill');
  await makeSkill(globalSkill, 'global-skill');
  await mkdir(join(context.home, '.agents'), { recursive: true });
  await writeFile(
    join(context.home, '.agents/.skill-lock.json'),
    `${JSON.stringify({
      version: 3,
      skills: {
        'global-skill': {
          source: 'example/skills',
          sourceType: 'github',
          sourceUrl: 'https://github.com/example/skills/tree/main/skills/global-skill',
          ref: 'main',
          skillPath: 'skills/global-skill/SKILL.md',
        },
      },
    })}\n`,
    'utf8'
  );

  try {
    await run(context, ['import', '-g', '--agent', 'codex', '--all', '--yes']);
    assert.equal((await lstat(globalSkill)).isSymbolicLink(), true);
    assert.equal(
      (await readlink(globalSkill)),
      join(context.collection, 'skills/global-skill')
    );
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/global-skill.json'), 'utf8')
    );
    assert.equal(metadata.source.url, 'https://github.com/example/skills');
    assert.equal(metadata.source.path, 'skills/global-skill');
    assert.equal(metadata.source.importedFromLock, true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('indexes a multiline YAML description without a YAML runtime dependency', async () => {
  const context = await makeContext();
  const source = join(context.project, 'multiline-skill');
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: multiline-skill\ndescription: >\n  Finds obscure frontend\n  accessibility problems\n---\n',
    'utf8'
  );

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const listed = JSON.parse((await run(context, ['list', 'accessibility', '--json'])).stdout);
    assert.deepEqual(listed.collection.map((skill: JsonSkill) => skill.name), ['multiline-skill']);
    assert.equal(
      listed.collection[0].description,
      'Finds obscure frontend accessibility problems'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('rejects a provenance lock path that escapes the source repository', async () => {
  const context = await makeContext();
  const source = join(context.project, '.agents/skills/unsafe-lock');
  await makeSkill(source, 'unsafe-lock');
  await writeFile(
    join(context.project, 'skills-lock.json'),
    `${JSON.stringify({
      version: 1,
      skills: {
        'unsafe-lock': {
          source: 'file:///tmp/example.git',
          sourceType: 'git',
          ref: 'main',
          skillPath: '../../secret/SKILL.md',
        },
      },
    })}\n`,
    'utf8'
  );

  try {
    await assert.rejects(run(context, ['import', source, '--all', '--yes']));
    assert.equal((await lstat(source)).isDirectory(), true);
    await assert.rejects(lstat(join(context.collection, 'skills/unsafe-lock')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
