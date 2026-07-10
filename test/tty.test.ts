import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
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

test('TTY Git import review shows repository identity and saves selected tags', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context);
  const source = `file://${repository}`;

  try {
    const result = await runInteractive(context, ['import', source], [
      { wait: '选择标签', send: 'remote', delayAfter: 100 },
      { wait: '标签：remote', send: '', delayAfter: 100 },
      { wait: '已导入 1 个技能。', send: '', enter: false },
    ]);
    assert.match(result.stdout, /file:\/\/.*#main · skills\/remote-/);
    assert.doesNotMatch(result.stdout, /iskills-source-|repository\/skills\/remote-skill/);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/remote-skill.json'), 'utf8')
    );
    assert.deepEqual(metadata.tags, ['remote']);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY Git import list marks skills already collected from the same GitHub source', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const { repository } = await makeGitSkillRepo(context, 'alpha');
  await makeSkill(join(repository, 'skills/beta'), 'beta');
  await exec('git', ['add', '.'], { cwd: repository });
  await exec('git', ['commit', '-m', 'add beta'], { cwd: repository });
  context.env.GIT_CONFIG_COUNT = '2';
  context.env.GIT_CONFIG_KEY_0 = `url.file://${repository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_0 = 'https://github.com/Owner/Repo';
  context.env.GIT_CONFIG_KEY_1 = `url.file://${repository}.insteadOf`;
  context.env.GIT_CONFIG_VALUE_1 = 'https://github.com/owner/repo';

  try {
    await run(context, ['import', 'https://github.com/Owner/Repo', '--all', '--yes']);
    const result = await runInteractive(context, ['import', 'https://github.com/owner/repo'], [
      { wait: '发现以下技能', send: '', enter: false },
      { wait: '已收藏自同一来源', send: '\u001b', enter: false, delayAfter: 100 },
    ]);
    assert.match(result.stdout, /alpha/);
    assert.match(result.stdout, /beta/);
    assert.match(result.stdout, /已收藏自同一来源/);
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
      { wait: '选择标签', send: '', delayAfter: 100 },
      { wait: 'Enter 确认导入', send: '', delayAfter: 100 },
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

test('TTY import list gives long Skill names room before descriptions', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const root = join(context.project, 'skill-set');
  const longName = 'imagegen-frontend-website-direction';
  await makeSkill(join(root, longName), longName, 'Premium website design reference generation');
  await makeSkill(join(root, 'short-skill'), 'short-skill', 'Short helper');

  try {
    const result = await runInteractive(
      context,
      ['import', root],
      [
        { wait: '发现以下技能', send: '', enter: false },
        { wait: longName, send: '\u001b', enter: false },
      ],
      context.project,
      { rows: 24, columns: 120 }
    );
    assert.match(result.stdout, new RegExp(longName));
    assert.doesNotMatch(result.stdout, /imagegen-frontend-website…/);
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
      { wait: 'Space 选择 · / 搜索', send: '/', enter: false, delayAfter: 100 },
      { wait: '搜索技能', send: 'alphax', enter: false, delayAfter: 100 },
      { wait: '没有匹配的技能', send: '\x7f', enter: false, delayAfter: 100 },
      { wait: 'frontend · shared / ', send: '\u001b', enter: false, delayAfter: 100 },
      { wait: '? 快捷键', send: '?', enter: false, delayAfter: 100 },
      { wait: '完整快捷键', send: '\u001b', enter: false, delayAfter: 100 },
      { wait: '› ○ frontend (2)', send: 'g', enter: false, delayAfter: 100 },
      { wait: '跳转到分组', send: '2', enter: false, delayAfter: 100 },
      { wait: '› ○ shared (2)', send: ' ', enter: false, delayAfter: 200 },
      { wait: '已选 2', send: 't', enter: false, delayAfter: 100 },
      { wait: '为 2 个技能添加标签', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 1000 },
      { wait: '已为 2 个技能添加标签', send: 'q', enter: false, delayAfter: 100 },
    ]);

    assert.match(result.stdout, /frontend · shared \/ /);
    assert.match(result.stdout, /● shared \(2\)/);
    assert.match(result.stdout, /完整快捷键/);
    assert.doesNotMatch(result.stdout, /g 分组/);
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

test('TTY list flattens a sole ungrouped section', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'plain-skill');
  await makeSkill(source, 'plain-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false, delayAfter: 400 },
      { wait: 'plain-skill', send: 'q', enter: false },
    ]);

    assert.match(result.stdout, /plain-skill/);
    assert.doesNotMatch(result.stdout, /未分组/);
    assert.doesNotMatch(result.stdout, /g 分组/);
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
      { wait: 'first-skill', send: '', delayAfter: 100 },
      { wait: '选择标签', send: '', delayAfter: 100 },
      { wait: 'Enter 确认导入', send: '', delayAfter: 100 },
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

test('collection browser removes the current Skill with confirmation', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-delete-skill');
  await makeSkill(source, 'entry-delete-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'entry-delete-skill', send: 'd', enter: false },
      { wait: '删除收藏', send: '', enter: false, delayAfter: 100 },
      { wait: '(y/N)', send: 'y', enter: false, delayAfter: 150 },
      { wait: '收藏夹 0', send: 'q', enter: false, delayAfter: 300 },
    ]);
    const plainOutput = result.stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    assert.match(result.stdout, /d 删除/);
    assert.doesNotMatch(plainOutput, /\n\nd 删除\n/);
    assert.match(result.stdout, /从收藏夹移除 entry-delete-skill 吗？/);
    assert.match(result.stdout, /\(y\/N\)/);
    assert.doesNotMatch(result.stdout, /n \/ Enter \/ Esc 取消/);
    assert.doesNotMatch(result.stdout, /并还回/);
    assert.doesNotMatch(result.stdout, /错误：/);
    assert.equal((await lstat(source)).isDirectory(), true);
    assert.equal((await lstat(source)).isSymbolicLink(), false);
    await assert.rejects(lstat(join(context.collection, 'skills/entry-delete-skill')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('project browser deletes a local Skill with default-cancel confirmation', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const local = join(context.project, '.agents/skills/local-delete-skill');
  await makeSkill(local, 'local-delete-skill');

  try {
    const result = await runInteractive(context, ['list'], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: 'local-delete-skill', send: 'd', enter: false },
      { wait: '(y/N)', send: 'n', enter: false, delayAfter: 100 },
      { wait: 'd 删除', send: 'd', enter: false, delayAfter: 100 },
      { wait: '(y/N)', send: 'y', enter: false, delayAfter: 150 },
      { wait: '已删除 local-delete-skill 的当前位置', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /删除 local-delete-skill 的当前位置吗？/);
    assert.match(result.stdout, /将永久删除以下位置；收藏夹内容（如有）保留。/);
    assert.match(result.stdout, /\.agents\/skills\/local-delete-skill/);
    assert.doesNotMatch(result.stdout, /错误：/);
    await assert.rejects(lstat(local), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('global browser batch deletes collected and local Skill locations', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const linked = join(context.home, '.codex/skills/alpha-linked');
  const local = join(context.home, '.codex/skills/beta-local');
  await makeSkill(linked, 'alpha-linked');

  try {
    await run(context, ['import', '-g', '--agent', 'codex', '--all', '--yes']);
    await makeSkill(local, 'beta-local');
    const result = await runInteractive(context, ['list'], [
      { wait: 'q 退出', send: '\u001b[C', enter: false },
      { wait: '全局', send: '\u001b[B', enter: false },
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: 'alpha-linked', send: ' ', enter: false },
      { wait: '已选 1', send: '\u001b[B', enter: false },
      { wait: 'beta-local', send: ' ', enter: false },
      { wait: '已选 2', send: 'd', enter: false },
      { wait: '(y/N)', send: 'y', enter: false, delayAfter: 150 },
      { wait: '已删除 2 个技能位置', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /d 删除/);
    assert.match(result.stdout, /\/\.codex\/skills\/alpha-linked/);
    assert.match(result.stdout, /\/\.codex\/skills\/beta-local/);
    await assert.rejects(lstat(linked), { code: 'ENOENT' });
    await assert.rejects(lstat(local), { code: 'ENOENT' });
    assert.equal(
      (await lstat(join(context.collection, 'skills/alpha-linked'))).isDirectory(),
      true
    );
    const state = JSON.parse(await readFile(join(context.collection, '.local/state.json'), 'utf8'));
    assert.equal(state.links.some((link: JsonLink) => link.path === linked), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('collection browser shows progress while updating a Skill', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);

  try {
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);
    await writeFile(join(skill, 'asset.txt'), 'browser update\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'browser update'], { cwd: repository });

    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'remote-skill', send: '', enter: false },
      { wait: 'u 更新当前技能', send: 'u', enter: false },
      { wait: '正在更新 remote-skill', send: '', enter: false },
      { wait: 'remote-skill: updated', send: 'q', enter: false, delayAfter: 3600 },
    ]);
    assert.match(result.stdout, /正在更新 remote-skill/);
    assert.match(result.stdout, /remote-skill: updated/);
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'browser update\n'
    );
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

test('collection browser confirms replacing an existing add target in a popup', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'entry-replace-skill');
  const target = join(context.project, '.agents/skills/entry-replace-skill');
  await makeSkill(source, 'entry-replace-skill');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'foreign.txt'), 'replace me\n', 'utf8');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: ' ', enter: false },
      { wait: '已选 1', send: '', delayAfter: 100 },
      { wait: '添加到：', send: '' },
      { wait: '添加方式：', send: '' },
      { wait: '选择项目 Skill 目录：', send: '' },
      { wait: '替换目标', send: '', enter: false, delayAfter: 100 },
      { wait: '(y/N)', send: 'y', enter: false, delayAfter: 150 },
      { wait: '已通过软链添加 1 个技能到 1 个目录', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /替换目标/);
    assert.doesNotMatch(result.stdout, /目标已存在，替换 .*\\? \(y\/N\)/);
    assert.doesNotMatch(result.stdout, /错误：/);
    assert.equal((await lstat(target)).isSymbolicLink(), true);
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
      { wait: '切换 Agent', send: '\u001b[B', enter: false, delayAfter: 100 },
      { wait: '→ 查看', send: '\u001b[C', enter: false, delayAfter: 100 },
      { wait: '‹ collected-skill', send: '\u001b', enter: false, delayAfter: 100 },
      { wait: '↑/↓ 移动 · Space 选择 · → 查看', send: '\u001b[B', enter: false, delayAfter: 100 },
      { wait: '› ○ 本地 · local-only', send: ' ', enter: false, delayAfter: 200 },
      { wait: 'i 加入收藏夹', send: 'i', enter: false, delayAfter: 200 },
      { wait: '已导入 1 个技能到收藏夹', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /本地 · local-only/);
    assert.match(result.stdout, /‹ collected-skill/);
    assert.doesNotMatch(result.stdout, /本地 · collected-skill/);
    assert.match(result.stdout, /○ 本地 · local-only/);
    assert.match(result.stdout, /○ collected-skill/);
    assert.doesNotMatch(result.stdout, /claude \(0\)/);
    assert.doesNotMatch(result.stdout, /codex \(0\)/);
    assert.doesNotMatch(result.stdout, /cursor \(0\)/);
    assert.doesNotMatch(result.stdout, /opencode \(0\)/);
    assert.equal(
      await readFile(join(context.collection, 'skills/local-only/SKILL.md'), 'utf8').then(Boolean),
      true
    );
    assert.equal((await lstat(local)).isSymbolicLink(), true);
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

    const result = await runInteractive(context, [], [
      { wait: '? 快捷键', send: 's', enter: false, delayAfter: 800 },
      { wait: 'Git 同步完成', send: 'q', enter: false },
    ]);
    assert.doesNotMatch(result.stdout, /s 同步 Git/);
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
