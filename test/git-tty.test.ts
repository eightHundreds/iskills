import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  cp,
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  exec,
  errorMessage,
  makeContext,
  makeGitSkillRepo,
  makeSkill,
  run,
  runInteractive,
  type JsonLink,
  type JsonSkill,
} from './helpers.js';

test('imports a Git source with repository provenance and no origin link', async () => {
  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context);

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    const imported = join(context.collection, 'skills/remote-skill');
    assert.equal((await lstat(imported)).isDirectory(), true);

    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/remote-skill.json'), 'utf8')
    );
    assert.equal(metadata.source.type, 'git');
    assert.equal(metadata.source.url, `file://${repository}`);
    assert.equal(metadata.source.ref, 'main');
    assert.equal(metadata.source.refType, 'branch');
    assert.equal(metadata.source.path, 'skills/remote-skill');

    const state = JSON.parse(await readFile(join(context.collection, '.local/state.json'), 'utf8'));
    assert.equal(state.links.some((link: JsonLink) => link.skill === 'remote-skill'), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('updates a branch source through a three-way Git merge', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await writeFile(join(skill, 'asset.txt'), 'upstream update\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'update asset'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill']);
    assert.match(result.stdout, /remote-skill: updated/);
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'upstream update\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('keeps an active Skill valid while a source conflict is resolved manually', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);
  const activeAsset = join(context.collection, 'skills/remote-skill/asset.txt');

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await writeFile(activeAsset, 'local change\n', 'utf8');
    await writeFile(join(skill, 'asset.txt'), 'remote change\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'conflicting update'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill']);
    assert.match(result.stdout, /remote-skill: conflict/);
    assert.equal(await readFile(activeAsset, 'utf8'), 'local change\n');

    const statePath = join(context.collection, '.local/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.conflicts.length, 1);
    const workspace = state.conflicts[0].path;
    await writeFile(join(workspace, 'asset.txt'), 'resolved change\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: workspace });
    await exec('git', ['commit', '-m', 'resolve'], { cwd: workspace });

    await run(context, ['list', '--json']);
    assert.equal(await readFile(activeAsset, 'utf8'), 'resolved change\n');
    const resolvedState = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(resolvedState.conflicts.length, 0);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('recovers provenance from skills-lock.json and uses the imported files as update baseline', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);
  const installed = join(context.project, '.agents/skills/remote-skill');
  await mkdir(dirname(installed), { recursive: true });
  await cp(skill, installed, { recursive: true });
  await writeFile(
    join(context.project, 'skills-lock.json'),
    `${JSON.stringify(
      {
        version: 1,
        skills: {
          'remote-skill': {
            source: `file://${repository}`,
            sourceType: 'git',
            ref: 'main',
            skillPath: 'skills/remote-skill/SKILL.md',
            computedHash: 'unused',
          },
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  try {
    await run(context, ['import', installed, '--all', '--yes']);
    const metadataPath = join(context.collection, 'metadata/remote-skill.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(metadata.source.type, 'git');
    assert.equal(metadata.source.url, `file://${repository}`);
    assert.equal(metadata.source.path, 'skills/remote-skill');
    assert.equal(metadata.source.commit, undefined);

    await writeFile(join(skill, 'asset.txt'), 'new upstream version\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'new upstream version'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill']);
    assert.match(result.stdout, /remote-skill: updated/);
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'new upstream version\n'
    );
    const updatedMetadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.match(updatedMetadata.source.commit, /^[0-9a-f]{40}$/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('initializes the collection Git repository with a local fallback identity', async () => {
  const context = await makeContext();
  context.env.GIT_CONFIG_NOSYSTEM = '1';
  context.env.GIT_CONFIG_GLOBAL = join(context.root, 'missing-gitconfig');
  const source = join(context.project, 'init-skill');
  await makeSkill(source, 'init-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await run(context, ['init']);
    assert.match(result.stdout, /已初始化收藏夹 Git/);
    assert.equal(result.stderr, '');

    const branch = await exec('git', ['branch', '--show-current'], { cwd: context.collection });
    assert.equal(branch.stdout.trim(), 'main');
    const tracked = await exec('git', ['ls-files'], { cwd: context.collection });
    assert.match(tracked.stdout, /^\.gitignore$/m);
    assert.match(tracked.stdout, /^metadata\/init-skill\.json$/m);
    assert.match(tracked.stdout, /^skills\/init-skill\/SKILL\.md$/m);
    assert.doesNotMatch(tracked.stdout, /^\.local\//m);
    const name = await exec('git', ['config', '--get', 'user.name'], { cwd: context.collection });
    const email = await exec('git', ['config', '--get', 'user.email'], {
      cwd: context.collection,
    });
    assert.equal(name.stdout.trim(), 'Skill Collection');
    assert.equal(email.stdout.trim(), 'iskills@localhost');

    const repeated = await run(context, ['init']);
    assert.match(repeated.stdout, /收藏夹 Git 已初始化/);
    const commits = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: context.collection });
    assert.equal(commits.stdout.trim(), '1');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY search selects a skills.sh result and saves its Git source to the collection', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context, 'search-skill');
  const { repository: replacementRepository } = await makeGitSkillRepo(
    context,
    'search-skill',
    'replacement-remote'
  );
  let requestedQuery = '';
  let remoteSource = 'search-owner/search-repo';
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    requestedQuery = url.searchParams.get('q') || '';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      skills: [{
        id: `${remoteSource}/search-skill`,
        name: 'search-skill',
        source: remoteSource,
        installs: 1234,
      }],
    }));
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address() as AddressInfo;
  context.env.SKILLS_API_URL = `http://127.0.0.1:${address.port}`;
  context.env.GIT_CONFIG_COUNT = '2';
  context.env.GIT_CONFIG_KEY_0 = `url.file://${repository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_0 = 'https://github.com/search-owner/search-repo';
  context.env.GIT_CONFIG_KEY_1 = `url.file://${replacementRepository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_1 = 'https://github.com/search-owner/replacement-repo';

  try {
    const result = await runInteractive(context, ['search', 'search'], [
      { wait: 'search-skill', send: '', delayAfter: 300 },
    ]);
    assert.match(result.stdout, /已收藏 search-skill/);
    assert.equal(requestedQuery, 'search');
    assert.equal(
      await readFile(join(context.collection, 'skills/search-skill/asset.txt'), 'utf8'),
      'keep me\n'
    );
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/search-skill.json'), 'utf8')
    );
    assert.equal(metadata.source.url, 'https://github.com/search-owner/search-repo');
    assert.equal(metadata.source.path, 'skills/search-skill');

    const declined = await runInteractive(context, ['search', 'search'], [
      { wait: '已收藏同名技能', send: '', delayAfter: 300 },
    ]);
    assert.doesNotMatch(declined.stdout, /错误：/);
    assert.match(declined.stdout, /已收藏自同一来源/);
    assert.doesNotMatch(declined.stdout, /\(y\/N\)/);

    remoteSource = 'search-owner/replacement-repo';
    const conflict = await runInteractive(context, ['search', 'search'], [
      { wait: '已收藏同名技能', send: '', delayAfter: 300 },
      { wait: 'replacement-repo/skills/search-skill', send: 'n', delayAfter: 300 },
    ]);
    assert.match(conflict.stdout, /search-repo\/skills\/search-skill/);
    assert.match(conflict.stdout, /\(y\/N\)/);

    const replaced = await runInteractive(context, ['search', 'search'], [
      { wait: '已收藏同名技能', send: '', delayAfter: 300 },
      { wait: 'replacement-repo/skills/search-skill', send: 'y', delayAfter: 300 },
    ]);
    assert.match(replaced.stdout, /已收藏 search-skill/);
    const replacedMetadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/search-skill.json'), 'utf8')
    );
    assert.equal(replacedMetadata.source.url, 'https://github.com/search-owner/replacement-repo');
  } finally {
    await new Promise<void>((resolveServer, rejectServer) => {
      server.close((error) => error ? rejectServer(error) : resolveServer());
    });
    await rm(context.root, { recursive: true, force: true });
  }
});

test('search exposes ordered JSON and collects by stable result ID', async () => {
  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context, 'relevant');
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      skills: [
        { id: 'owner/repo/relevant', name: 'relevant', source: 'owner/repo', installs: 1 },
        { id: 'owner/repo/popular', name: 'popular', source: 'owner/repo', installs: 999999 },
      ],
    }));
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address() as AddressInfo;
  context.env.SKILLS_API_URL = `http://127.0.0.1:${address.port}`;
  context.env.GIT_CONFIG_COUNT = '1';
  context.env.GIT_CONFIG_KEY_0 = `url.file://${repository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_0 = 'https://github.com/owner/repo';

  try {
    const result = await run(context, ['search', 'relevant', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.results.map((skill: { resultId: string }) => skill.resultId), [
      'owner/repo/relevant',
      'owner/repo/popular',
    ]);
    assert.equal(result.stderr, '');
    await assert.rejects(lstat(context.collection), { code: 'ENOENT' });

    const collected = await run(context, ['search', '--collect', 'owner/repo/relevant']);
    assert.match(collected.stdout, /已收藏 relevant/);
    assert.equal(
      await readFile(join(context.collection, 'skills/relevant/asset.txt'), 'utf8'),
      'keep me\n'
    );
  } finally {
    await new Promise<void>((resolveServer, rejectServer) => {
      server.close((error) => error ? rejectServer(error) : resolveServer());
    });
    await rm(context.root, { recursive: true, force: true });
  }
});

test('noninteractive search rejects source conflicts and treats default Git ports as equivalent', async () => {
  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context, 'search-skill');
  const { repository: replacementRepository } = await makeGitSkillRepo(
    context,
    'search-skill',
    'replacement-remote'
  );
  let remoteSource = 'owner/repo';
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      skills: [{
        id: `${remoteSource}/search-skill`,
        name: 'search-skill',
        source: remoteSource,
        installs: 1,
      }],
    }));
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address() as AddressInfo;
  context.env.SKILLS_API_URL = `http://127.0.0.1:${address.port}`;
  context.env.GIT_CONFIG_COUNT = '2';
  context.env.GIT_CONFIG_KEY_0 = `url.file://${repository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_0 = 'https://github.com/owner/repo';
  context.env.GIT_CONFIG_KEY_1 = `url.file://${replacementRepository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_1 = 'https://github.com/owner/replacement';

  try {
    await run(context, ['search', '--collect', 'owner/repo/search-skill']);
    const metadataPath = join(context.collection, 'metadata/search-skill.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    metadata.source.url = 'ssh://git@github.com:22/owner/repo';
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    const unchanged = await run(context, ['search', '--collect', 'owner/repo/search-skill']);
    assert.match(unchanged.stdout, /已收藏自同一来源/);

    remoteSource = 'owner/replacement';
    await assert.rejects(
      run(context, ['search', '--collect', 'owner/replacement/search-skill']),
      /异源同名技能.*--replace/
    );
  } finally {
    await new Promise<void>((resolveServer, rejectServer) => {
      server.close((error) => error ? rejectServer(error) : resolveServer());
    });
    await rm(context.root, { recursive: true, force: true });
  }
});

test('interactive search cancellation has no persistent side effects', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }
  const context = await makeContext();
  try {
    await runInteractive(context, ['search'], [
      { wait: '搜索技能', send: '\u001b', enter: false },
    ], context.project, { rows: 10, columns: 40 });
    await assert.rejects(lstat(context.collection), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('Ctrl+C interrupts an Ink screen with exit code 130', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }
  const context = await makeContext();
  try {
    try {
      await runInteractive(context, ['search'], [
        { wait: '搜索技能', send: '\u0003', enter: false, delayAfter: 100 },
      ]);
      assert.fail('Ctrl+C should interrupt the command');
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string };
      assert.equal(failure.code, 130);
      assert.doesNotMatch(failure.stdout || '', /错误：/);
    }
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('background collection sync merges clean remote changes without blocking the active tree', async () => {
  const context = await makeContext();
  context.env.SK_NO_BACKGROUND_SYNC = '1';
  const collection = context.collection;
  const remote = join(context.root, 'collection.git');
  const other = join(context.root, 'other');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: collection });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });

    const first = join(context.project, 'first-local');
    await makeSkill(first, 'first-local');
    await run(context, ['import', first, '--all', '--yes']);
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd: collection });

    await exec('git', ['clone', remote, other]);
    await exec('git', ['config', 'user.name', 'Other'], { cwd: other });
    await exec('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
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

test('tracks an upstream Skill directory rename through Git history', async () => {
  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context);

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await exec('git', ['mv', 'skills/remote-skill', 'skills/renamed-skill-directory'], {
      cwd: repository,
    });
    await exec('git', ['commit', '-m', 'rename skill directory'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill']);
    assert.match(result.stdout, /remote-skill: updated/);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/remote-skill.json'), 'utf8')
    );
    assert.equal(metadata.source.path, 'skills/renamed-skill-directory');
    assert.equal((await lstat(join(context.collection, 'skills/remote-skill'))).isDirectory(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('applies upstream deletion through collection removal after explicit confirmation', async () => {
  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context);
  const target = join(context.project, '.agents/skills');

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await run(context, ['add', 'remote-skill', '--to', target]);
    await rm(join(repository, 'skills/remote-skill'), { recursive: true });
    await exec('git', ['add', '-A'], { cwd: repository });
    await exec('git', ['commit', '-m', 'delete skill'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill', '--yes']);
    assert.match(result.stdout, /remote-skill: deleted/);
    await assert.rejects(lstat(join(context.collection, 'skills/remote-skill')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(target, 'remote-skill')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY import -g focuses tabs with arrows, multi-selects across agents and views detail', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const longDescription =
    '一个用于演示长描述截断行为的 claude 全局技能，主界面只展示一行，详情视图完整呈现';
  const claudeSkill = join(context.home, '.claude/skills/claude-skill');
  const claudeSkill2 = join(context.home, '.claude/skills/claude-second');
  const codexSkill = join(context.home, '.codex/skills/codex-skill');
  await makeSkill(claudeSkill, 'claude-skill', longDescription);
  await makeSkill(claudeSkill2, 'claude-second', '另一个 claude 技能');
  await makeSkill(codexSkill, 'codex-skill', 'codex 全局技能');

  try {
    const result = await runInteractive(context, ['import', '-g'], [
      { wait: '扫描全局 Skill 目录', send: '', enter: false },
      { wait: 'claude (2)', send: ' ', enter: false, delayAfter: 100 },
      { wait: '已选 1', send: '\u001b[A', enter: false, delayAfter: 100 },
      { wait: '←/→ 切换 Agent', send: '\u001b[C', enter: false, delayAfter: 100 },
      { wait: 'codex (1)', send: '\u001b[B', enter: false, delayAfter: 100 },
      { wait: 'Space 选择', send: ' ', enter: false, delayAfter: 100 },
      { wait: '已选 2', send: '\u001b[A', enter: false, delayAfter: 100 },
      { wait: '←/→ 切换 Agent', send: '\u001b[D', enter: false, delayAfter: 100 },
      { wait: 'claude (2)', send: '\u001b[B', enter: false, delayAfter: 100 },
      { wait: 'Space 选择', send: '\u001b[B', enter: false, delayAfter: 100 },
      { send: '\u001b[B', enter: false, delay: 200 },
      { send: '\u001b[C', enter: false, delay: 300 },
      { wait: '另一个 claude 技能', send: '\u001b[D', enter: false, delayAfter: 200 },
      { wait: 'Enter 确认', send: '', delayAfter: 200 },
      { wait: '继续吗？', send: 'y', enter: false, delayAfter: 100 },
    ]);
    assert.match(result.stdout, /claude \(2\)/);
    assert.match(result.stdout, /codex \(1\)/);
    assert.match(result.stdout, /完整描述/);
    assert.doesNotMatch(result.stdout, /顶部按 ↑ 选择 Agent/);
    assert.doesNotMatch(result.stdout, /错误：/);
    assert.equal((await lstat(claudeSkill)).isDirectory(), true);
    assert.equal((await lstat(claudeSkill2)).isSymbolicLink(), true);
    assert.equal((await lstat(codexSkill)).isSymbolicLink(), true);
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
    await exec('git', ['config', 'user.name', 'Test'], { cwd: collection });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });
    await run(context, ['import', source, '--all', '--yes']);
    await exec('git', ['push', '-u', 'origin', 'main'], { cwd: collection });

    await exec('git', ['clone', remote, other]);
    await exec('git', ['config', 'user.name', 'Other'], { cwd: other });
    await exec('git', ['config', 'user.email', 'other@example.com'], { cwd: other });
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

test('keeps Tag-based Git imports pinned', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);
  await exec('git', ['tag', 'v1'], { cwd: repository });

  try {
    await run(context, ['import', `file://${repository}#v1`, '--all', '--yes']);
    await writeFile(join(skill, 'asset.txt'), 'after tag\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'after tag'], { cwd: repository });

    const result = await run(context, ['update', 'remote-skill']);
    assert.match(result.stdout, /remote-skill: pinned/);
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'keep me\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY source rebinding discovers repository paths and focuses the matching Skill', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'metadata-skill');
  const repository = join(context.root, 'rebind-remote');
  await makeSkill(source, 'metadata-skill');
  await makeSkill(join(repository, 'skills/unrelated'), 'aaa-unrelated');
  await makeSkill(join(repository, 'nested/matched'), 'metadata-skill');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repository });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
  await exec('git', ['add', '.'], { cwd: repository });
  await exec('git', ['commit', '-m', 'initial'], { cwd: repository });

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: '→ 查看', send: '\u001b[B', enter: false },
      { send: '\u001b[C', enter: false, delay: 200 },
      { wait: 's 来源', send: 's', enter: false, delayAfter: 200 },
      { wait: 'Git 来源', send: `file://${repository}`, enter: false },
      { send: '', enter: false, delay: 200 },
      { send: '', delay: 100 },
      { wait: '分支、Tag 或 Commit', send: 'main', enter: false },
      { send: '', enter: false, delay: 200 },
      { send: '', delay: 100 },
      { wait: '选择仓库内 Skill', send: '', delayAfter: 200 },
      { send: '', enter: false, delay: 1000 },
      { wait: 's 来源', send: 'q', enter: false, delayAfter: 300 },
      { wait: 'q 退出', send: 'q', enter: false, delayAfter: 300 },
    ]);

    assert.doesNotMatch(result.stdout, /错误：/);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/metadata-skill.json'), 'utf8')
    );
    assert.equal(metadata.source.url, `file://${repository}`);
    assert.equal(metadata.source.ref, 'main');
    assert.equal(metadata.source.path, 'nested/matched');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY list searches across groups and jumps directly to a group', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const root = join(context.project, 'tagged-skills');
  await makeSkill(join(root, 'alpha'), 'alpha');
  await makeSkill(join(root, 'beta'), 'beta');
  await makeSkill(join(root, 'gamma'), 'gamma');

  try {
    await run(context, ['import', root, '--all', '--yes']);
    await run(context, ['list', 'alpha', '--tags', 'frontend,shared', '--json']);
    await run(context, ['list', 'beta', '--tags', 'frontend', '--json']);
    await run(context, ['list', 'gamma', '--tags', 'shared', '--json']);

    const result = await runInteractive(context, [], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false, delayAfter: 400 },
      { wait: '→ 查看', send: '/', enter: false, delayAfter: 100 },
      { wait: '搜索技能', send: 'alphax', enter: false, delayAfter: 100 },
      { wait: '没有匹配的技能', send: '\x7f', enter: false, delayAfter: 100 },
      { wait: 'frontend · shared / ', send: '\u001b', enter: false, delayAfter: 100 },
      { wait: 'g 分组', send: 'g', enter: false, delayAfter: 100 },
      { wait: '跳转到分组', send: '2', enter: false, delayAfter: 100 },
      { wait: '› ○ shared (2)', send: ' ', enter: false, delayAfter: 200 },
      { wait: '已选 2', send: 't', enter: false, delayAfter: 100 },
      { wait: '为 2 个技能添加标签', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 1000 },
      { wait: '已为 2 个技能添加标签', send: 'q', enter: false, delayAfter: 100 },
    ]);

    assert.match(result.stdout, /frontend · shared \/ /);
    assert.match(result.stdout, /● shared \(2\)/);
    const alpha = JSON.parse(
      await readFile(join(context.collection, 'metadata/alpha.json'), 'utf8')
    );
    const gamma = JSON.parse(
      await readFile(join(context.collection, 'metadata/gamma.json'), 'utf8')
    );
    assert.deepEqual(alpha.tags, ['frontend', 'shared']);
    assert.deepEqual(gamma.tags, ['shared', 'frontend']);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY add bootstraps an empty collection from a local Skill', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'first-skill');
  await makeSkill(source, 'first-skill');

  try {
    const result = await runInteractive(context, ['add'], [
      { wait: 'Esc 取消', send: '\u001b[B\u001b[B', enter: false },
      { wait: 'Esc 取消', send: '' },
      { wait: '路径或 Git 来源：', send: source, enter: false, delayAfter: 100 },
      { wait: 'first-skill', send: '' },
      { wait: '继续吗？', send: 'y', enter: false, delayAfter: 100 },
    ]);
    assert.match(result.stdout, /已添加/);
    assert.equal((await lstat(source)).isSymbolicLink(), true);
    assert.equal(
      (await lstat(join(context.project, '.agents/skills/first-skill'))).isSymbolicLink(),
      true
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY entry opens collection browser directly', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-skill');
  await makeSkill(source, 'entry-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /收藏夹 1/);
    assert.match(result.stdout, /entry-skill/);
    assert.doesNotMatch(result.stdout, /你想做什么？/);
    assert.doesNotMatch(result.stdout, /错误：/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY entry defaults to existing project Skill directories', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-agent-skill');
  await makeSkill(source, 'entry-agent-skill');
  await mkdir(join(context.project, '.claude/skills'), { recursive: true });

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 100 },
      { wait: '添加到：', send: '' },
      { wait: '添加方式：', send: '' },
      { wait: '选择项目 Skill 目录：', send: '', enter: false },
      { wait: '○', send: '', enter: false },
      { wait: '标准 Agent Skills (.agents/skills)', send: '', enter: false },
      { wait: '●', send: '', enter: false },
      { wait: 'Claude Code (.claude/skills)', send: '', delayAfter: 150 },
      { wait: '已通过软链添加 1 个技能到 1 个目录', send: 'q', enter: false },
    ]);
    assert.doesNotMatch(result.stdout, /错误：/);
    assert.equal(
      (await lstat(join(context.project, '.claude/skills/entry-agent-skill'))).isSymbolicLink(),
      true
    );
    await assert.rejects(lstat(join(context.project, '.agents/skills/entry-agent-skill')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY entry can copy a selected collection Skill into a global Agent directory', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-copy-skill');
  await makeSkill(source, 'entry-copy-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 100 },
      { wait: '添加到：', send: '\u001b[B', enter: false },
      { wait: '全局', send: '' },
      { wait: '添加方式：', send: '\u001b[B', enter: false },
      { wait: '复制', send: '' },
      { wait: '选择全局 Skill 目录：', send: ' ', enter: false },
      { wait: '●', send: '' },
      { wait: '已通过复制添加 1 个技能到 1 个目录', send: 'q', enter: false },
    ]);
    const target = join(context.home, '.agents/skills/entry-copy-skill');
    const state = JSON.parse(await readFile(join(context.collection, '.local/state.json'), 'utf8'));
    assert.doesNotMatch(result.stdout, /错误：/);
    assert.equal((await lstat(target)).isSymbolicLink(), false);
    assert.equal(state.links.some((link: JsonLink) => link.path === target), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY entry cancels add mode selection without creating a target', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-cancel-skill');
  await makeSkill(source, 'entry-cancel-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 100 },
      { wait: '添加到：', send: '' },
      { wait: '添加方式：', send: '\u001b', enter: false },
      { wait: 'q 退出', send: 'q', enter: false },
    ]);
    assert.doesNotMatch(result.stdout, /错误：/);
    await assert.rejects(lstat(join(context.project, '.agents/skills')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY project tab labels local skills and imports them with i', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const agentsSkills = join(context.project, '.agents/skills');
  const local = join(agentsSkills, 'local-only');
  await makeSkill(local, 'local-only');
  const collectedSource = join(context.project, 'collected-source');
  await makeSkill(collectedSource, 'collected-skill');

  try {
    await run(context, ['import', collectedSource, '--all', '--yes']);
    await run(context, ['add', 'collected-skill', '--to', agentsSkills]);

    const json = JSON.parse((await run(context, ['list', '--json'])).stdout);
    const localSkill = json.project.find((skill: JsonSkill) => skill.name === 'local-only');
    const linkedSkill = json.project.find((skill: JsonSkill) => skill.name === 'collected-skill');
    assert.equal(localSkill?.fromCollection, false);
    assert.equal(linkedSkill?.fromCollection, true);

    const result = await runInteractive(context, ['list'], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: 'agents (2)', send: '\u001b[C', enter: false, delayAfter: 100 },
      { wait: '没有匹配的技能', send: '\u001b[D', enter: false, delayAfter: 100 },
      { wait: '本地 · local-only', send: '\u001b[B', enter: false },
      { wait: 'Enter 查看', send: ' ', enter: false, delayAfter: 200 },
      { wait: 'i 加入收藏夹', send: 'i', enter: false, delayAfter: 200 },
      { wait: '已导入 1 个技能到收藏夹', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /本地 · local-only/);
    assert.doesNotMatch(result.stdout, /本地 · collected-skill/);
    assert.match(result.stdout, /○ 本地 · local-only/);
    assert.doesNotMatch(result.stdout, /[○●] collected-skill/);
    assert.equal(
      await readFile(join(context.collection, 'skills/local-only/SKILL.md'), 'utf8').then(Boolean),
      true
    );
    assert.equal((await lstat(local)).isSymbolicLink(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('iskills init initializes Git', async (t) => {
  const context = await makeContext();
  try {
    const initialized = await run(context, ['init']);
    assert.match(initialized.stdout, /已初始化收藏夹 Git/);
    assert.equal((await lstat(join(context.collection, '.git'))).isDirectory(), true);

    const repeated = await run(context, ['init']);
    assert.match(repeated.stdout, /收藏夹 Git 已初始化/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('iskills init offers origin setup and --remote configures it later', async () => {
  const context = await makeContext();
  const remote = join(context.root, 'collection.git');
  try {
    const interactive = await runInteractive(context, ['init'], [
      { wait: '是否配置远程仓库？', send: 'n', enter: false },
    ]);
    assert.match(interactive.stdout, /是否配置远程仓库/);
    await assert.rejects(exec('git', ['remote', 'get-url', 'origin'], { cwd: context.collection }));

    await run(context, ['init', '--remote', remote]);
    const origin = await exec('git', ['remote', 'get-url', 'origin'], { cwd: context.collection });
    assert.equal(origin.stdout.trim(), remote);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('iskills init configures origin from its first-run prompt', async () => {
  const context = await makeContext();
  const remote = join(context.root, 'collection.git');
  try {
    const result = await runInteractive(context, ['init'], [
      { wait: '是否配置远程仓库？', send: 'y', enter: false },
      { wait: '远程仓库地址：', send: remote, enter: false },
      { wait: 'collection.git', send: '' },
    ]);
    assert.match(result.stdout, /已配置远程仓库 origin/);
    const origin = await exec('git', ['remote', 'get-url', 'origin'], { cwd: context.collection });
    assert.equal(origin.stdout.trim(), remote);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY import cancellation exits without an error', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const root = join(context.project, 'skill-set');
  await makeSkill(join(root, 'alpha'), 'alpha');
  await makeSkill(join(root, 'beta'), 'beta');

  try {
    const result = await runInteractive(context, ['import', root], [
      { wait: '发现以下技能', send: '\u001b', enter: false },
    ]);
    assert.match(result.stdout, /→ 详情/);
    assert.doesNotMatch(result.stdout, /错误：|没有选择技能/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('failed replacement commit restores the old collection and links', async () => {
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

    await assert.rejects(
      run(context, ['import', second, '--all', '--yes', '--replace'])
    );
    assert.equal(await readFile(join(first, 'version.txt'), 'utf8'), 'first\n');
    assert.equal((await lstat(first)).isSymbolicLink(), true);
    assert.equal((await lstat(second)).isDirectory(), true);
    assert.equal(
      await readFile(join(context.collection, 'skills/rollback-skill/version.txt'), 'utf8'),
      'first\n'
    );
    assert.equal(
      await readFile(join(usage, 'rollback-skill/version.txt'), 'utf8'),
      'first\n'
    );
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/rollback-skill.json'), 'utf8')
    );
    assert.equal(metadata.note, 'preserved');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('update --all continues after one Skill conflicts', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);
  const second = join(repository, 'skills/second-remote');
  await makeSkill(second, 'second-remote');
  await exec('git', ['add', '.'], { cwd: repository });
  await exec('git', ['commit', '-m', 'add second skill'], { cwd: repository });

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await writeFile(
      join(context.collection, 'skills/remote-skill/asset.txt'),
      'local conflict\n',
      'utf8'
    );
    await writeFile(join(skill, 'asset.txt'), 'remote conflict\n', 'utf8');
    await writeFile(join(second, 'asset.txt'), 'clean second update\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'update both'], { cwd: repository });

    const result = await run(context, ['update', '--all']);
    assert.match(result.stdout, /remote-skill: conflict/);
    assert.match(result.stdout, /second-remote: updated/);
    assert.equal(
      await readFile(join(context.collection, 'skills/second-remote/asset.txt'), 'utf8'),
      'clean second update\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('collection browser sync establishes the first upstream and excludes machine-local state', async () => {
  const context = await makeContext();
  context.env.SK_NO_BACKGROUND_SYNC = '1';
  const collection = context.collection;
  const remote = join(context.root, 'first-sync.git');
  const source = join(context.project, 'sync-skill');
  await makeSkill(source, 'sync-skill');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: collection });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: collection });
    await exec('git', ['init', '--bare', '-b', 'main', remote]);
    await exec('git', ['remote', 'add', 'origin', remote], { cwd: collection });
    await run(context, ['import', source, '--all', '--yes']);

    await runInteractive(context, [], [
      { wait: 's 同步 Git', send: 's', enter: false, delayAfter: 800 },
      { wait: 'Git 同步完成', send: 'q', enter: false },
    ]);
    const upstream = await exec('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: collection });
    assert.equal(upstream.stdout.trim(), 'origin/main');
    const trackedLocalState = await exec('git', ['ls-files', '.local'], { cwd: collection });
    assert.equal(trackedLocalState.stdout.trim(), '');
    const remoteSkill = await exec(
      'git',
      ['--git-dir', remote, 'show', 'main:skills/sync-skill/SKILL.md']
    );
    assert.match(remoteSkill.stdout, /name: sync-skill/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('a mutating command returns while its detached Git sync pushes in the background', async () => {
  const context = await makeContext();
  const collection = context.collection;
  const remote = join(context.root, 'async-sync.git');
  const source = join(context.project, 'async-skill');
  await makeSkill(source, 'async-skill');

  try {
    await run(context, ['list', '--json']);
    await exec('git', ['init', '-b', 'main'], { cwd: collection });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: collection });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: collection });
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

test('rejects an upstream update that introduces an escaping symlink', async () => {
  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await writeFile(join(repository, 'secret.txt'), 'outside skill\n', 'utf8');
    await symlink('../../secret.txt', join(skill, 'escape'));
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'unsafe symlink'], { cwd: repository });

    await assert.rejects(run(context, ['update', 'remote-skill']));
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'keep me\n'
    );
    await assert.rejects(lstat(join(context.collection, 'skills/remote-skill/escape')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
