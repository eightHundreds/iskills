import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  exec,
  errorMessage,
  makeContext,
  makeGitSkillRepo,
  makeSkill,
  renderTerminalScreen,
  run,
  runInteractive,
  type JsonLink,
  type JsonSkill,
} from './helpers.js';

function frameBounds(screen: string[]): { height: number; width: number; x: number; y: number } {
  const y = screen.findIndex((line) => line.startsWith('╭'));
  assert.notEqual(y, -1, 'screen must contain a frame top');
  const top = screen[y] ?? '';
  const x = top.indexOf('╭');
  const right = top.indexOf('╮', x);
  assert.notEqual(right, -1, 'frame top must have a right border');
  const bottom = screen.findIndex((line, index) =>
    index > y && line.startsWith(`${' '.repeat(x)}╰`)
  );
  assert.notEqual(bottom, -1, 'screen must contain a frame bottom');
  const bottomLine = screen[bottom] ?? '';
  assert.equal(bottomLine.indexOf('╯', x), right, 'frame sides must align');
  return { height: bottom - y + 1, width: right - x + 1, x, y };
}

function terminalWidth(value: string): number {
  return [...value].reduce((width, char) => {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    return width + (wide ? 2 : 1);
  }, 0);
}

function popupFrameBounds(
  screen: string[],
  title: string
): { height: number; width: number; x: number; y: number } {
  const y = screen.findIndex((line) => line.includes(`╭─ ${title} `));
  assert.notEqual(y, -1, 'screen must contain a popup frame top');
  const top = screen[y] ?? '';
  const x = top.indexOf('╭');
  const right = top.indexOf('╮', x);
  assert.notEqual(right, -1, 'popup frame top must have a right border');
  const bottom = screen.findIndex((line, index) => index > y && line.includes('╰'));
  assert.notEqual(bottom, -1, 'screen must contain a popup frame bottom');
  return {
    height: bottom - y + 1,
    width: terminalWidth(top.slice(x, right + 1)),
    x: terminalWidth(top.slice(0, x)),
    y,
  };
}

test.concurrent('TTY detail frame matches the selected browser frame', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'frame-skills');
  const names = Array.from({ length: 31 }, (_, index) => `frame-skill-${String(index).padStart(2, '0')}`);
  await Promise.all(names.map((name, index) =>
    makeSkill(join(source, name), name, index === 0 ? 'x'.repeat(140) : undefined)
  ));

  try {
    await run(context, ['import', source, '--all', '--yes']);
    await writeFile(
      join(context.collection, 'metadata/frame-skill-00.json'),
      `${JSON.stringify({
        name: 'frame-skill-00',
        description: 'x'.repeat(140),
        tags: [],
        note: '',
        source: { type: 'unknown', path: 'very-long-source-path/'.repeat(18) },
      })}\n`,
      'utf8'
    );
    const size = { rows: 16, columns: 100 };
    const result = await runInteractive(context, [], [
      { wait: '收藏夹 31', send: '\u001b[B', enter: false },
      { wait: '→ 查看', capture: 'list', send: '\u001b[C', enter: false },
      {
        wait: '↑/↓ 滚动',
        capture: 'detail',
        send: '\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B',
        enter: false,
      },
      { capture: 'detailScrolled', send: 'q', enter: false },
      { wait: '→ 查看', send: 'q', enter: false },
    ], context.project, size);
    const listOutput = result.screens?.list;
    const detailOutput = result.screens?.detail;
    const detailScrolledOutput = result.screens?.detailScrolled;
    assert.ok(listOutput, 'selected list screen must be captured');
    assert.ok(detailOutput, 'detail screen must be captured');
    assert.ok(detailScrolledOutput, 'scrolled detail screen must be captured');
    const listFrame = frameBounds(await renderTerminalScreen(listOutput, size));
    const detailScreen = await renderTerminalScreen(detailOutput, size);
    const detailFrame = frameBounds(detailScreen);
    assert.deepEqual(
      { height: detailFrame.height, width: detailFrame.width, x: detailFrame.x },
      { height: listFrame.height, width: listFrame.width, x: listFrame.x }
    );
    assert.equal(detailFrame.y, listFrame.y);
    assert.match(
      detailScreen.slice(detailFrame.y + 1, detailFrame.y + detailFrame.height - 1).join('\n'),
      /描述.*x/,
      'the long description must be rendered inside the stable detail frame'
    );
    assert.doesNotMatch(detailScreen.join('\n'), /…/, 'description must wrap instead of truncating');
    const scrolledFrame = frameBounds(await renderTerminalScreen(detailScrolledOutput, size));
    assert.deepEqual(scrolledFrame, detailFrame, 'scrolling detail content must not change the frame');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY shortcut overlay centers in the browser frame', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'overlay-skills');
  await Promise.all(Array.from({ length: 24 }, (_, index) =>
    makeSkill(join(source, `overlay-${index}`), `overlay-${index}`)
  ));
  const size = { rows: 40, columns: 120 };

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(context, [], [
      { wait: '收藏夹 24', send: '\u001b[B', enter: false },
      { wait: '? 快捷键', send: '?', enter: false },
      { wait: '完整快捷键', capture: 'shortcuts', send: '\u001b', enter: false },
      { wait: '? 快捷键', send: 'q', enter: false },
    ], context.project, size);
    const shortcutsOutput = result.screens?.shortcuts;
    assert.ok(shortcutsOutput, 'shortcut overlay screen must be captured');
    const screen = await renderTerminalScreen(shortcutsOutput, size);
    const frame = frameBounds(screen);
    const popup = popupFrameBounds(screen, '完整快捷键');
    assert.ok(
      Math.abs((popup.x * 2 + popup.width) - (frame.x * 2 + frame.width)) <= 2,
      'shortcut overlay must be horizontally centered'
    );
    assert.ok(
      Math.abs((popup.y * 2 + popup.height) - (frame.y * 2 + frame.height)) <= 3,
      'shortcut overlay must be vertically centered'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY Git import review shows repository identity and saves selected groups', async (t) => {
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
      { wait: '选择分组', send: 'remote' },
      { wait: '分组：remote', send: '' },
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

test.concurrent('TTY import selects current repository skills before group and confirmation', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  await makeSkill(join(context.project, 'skills/current-skill'), 'current-skill');

  try {
    const result = await runInteractive(context, ['import'], [
      { wait: '选择当前仓库技能', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '选择分组', send: 'frontend' },
      { wait: '分组：frontend', send: '' },
      { wait: '已导入 1 个技能。', send: '', enter: false },
    ]);
    assert.match(result.stdout, /选择当前仓库技能/);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/current-skill.json'), 'utf8')
    );
    assert.deepEqual(metadata.tags, ['frontend']);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY Git import list marks skills already collected from the same GitHub source', async (t) => {
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
      { wait: '发现以下技能', capture: 'selection', send: '', enter: false },
      { wait: '★', send: '\u001b', enter: false },
    ]);
    assert.match(result.stdout, /alpha/);
    assert.match(result.stdout, /beta/);
    assert.match(result.stdout, /★/);
    const selectionOutput = result.screens?.selection;
    assert.ok(selectionOutput, 'import selection screen must be captured');
    const selectionScreen = (await renderTerminalScreen(selectionOutput, {
      rows: 40,
      columns: 120,
    })).join('\n');
    assert.match(selectionScreen, /╭.*╮/);
    assert.match(selectionScreen, /╰.*╯/);
    assert.match(selectionScreen, /★\s+alpha/);
    assert.doesNotMatch(selectionScreen, /已收藏/);

    const { repository: replacementRepository } = await makeGitSkillRepo(
      context,
      'alpha',
      'replacement'
    );
    await makeSkill(join(replacementRepository, 'skills/beta'), 'beta');
    await exec('git', ['add', '.'], { cwd: replacementRepository });
    await exec('git', ['commit', '-m', 'add beta'], { cwd: replacementRepository });
    context.env.GIT_CONFIG_COUNT = '3';
    context.env.GIT_CONFIG_KEY_2 = `url.file://${replacementRepository}.insteadOf`;
    context.env.GIT_CONFIG_VALUE_2 = 'https://github.com/owner/replacement';

    const conflict = await runInteractive(
      context,
      ['import', 'https://github.com/owner/replacement'],
      [
        { wait: '☆', capture: 'selection', send: '\u001b', enter: false },
      ]
    );
    const conflictOutput = conflict.screens?.selection;
    assert.ok(conflictOutput, 'conflicting import selection screen must be captured');
    const conflictScreen = (await renderTerminalScreen(conflictOutput, {
      rows: 40,
      columns: 120,
    })).join('\n');
    assert.match(conflictScreen, /☆\s+alpha/);
    assert.doesNotMatch(conflictScreen, /同名冲突/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY search selects a skills.sh result and saves its Git source to the collection', async (t) => {
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
      { wait: 'search-skill', send: '' },
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
      { wait: '☆', send: '' },
    ]);
    assert.doesNotMatch(declined.stdout, /错误：/);
    assert.match(declined.stdout, /已收藏自同一来源/);
    assert.doesNotMatch(declined.stdout, /\(y\/N\)/);

    remoteSource = 'search-owner/replacement-repo';
    const conflict = await runInteractive(context, ['search', 'search'], [
      { wait: '☆', send: '' },
      { wait: 'replacement-repo/skills/search-skill', send: 'n' },
    ]);
    assert.match(conflict.stdout, /search-repo\/skills\/search-skill/);
    assert.match(conflict.stdout, /\(y\/N\)/);

    const replaced = await runInteractive(context, ['search', 'search'], [
      { wait: '☆', send: '' },
      { wait: 'replacement-repo/skills/search-skill', send: 'y' },
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

test.concurrent('interactive search cancellation has no persistent side effects', async (t) => {
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

test.concurrent('Ctrl+C interrupts an Ink screen with exit code 130', async (t) => {
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
        { wait: '搜索技能', send: '\u0003', enter: false },
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

test.concurrent('TTY import -g focuses tabs with arrows, multi-selects across agents and views detail', async (t) => {
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
      { wait: 'claude (2)', send: ' ', enter: false },
      { wait: '已选 1', send: '\u001b[A', enter: false },
      { wait: '←/→ 切换 Agent', send: '\u001b[C', enter: false },
      { wait: 'codex (1)', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: ' ', enter: false },
      { wait: '已选 2', send: '\u001b[A', enter: false },
      { wait: '←/→ 切换 Agent', send: '\u001b[D', enter: false },
      { wait: 'claude (2)', send: '\u001b[B', enter: false },
      { wait: 'Space 选择', send: '\u001b[B', enter: false },
      { wait: '一个用于演示长描述', send: '\u001b[B', enter: false },
      { wait: '另一个 claude 技能', capture: 'list', send: '\u001b[C', enter: false },
      {
        wait: '另一个 claude 技能',
        capture: 'detail',
        send: '\u001b[D',
        enter: false,
      },
      { wait: 'Enter 确认', send: '' },
      { wait: '选择分组', send: '' },
      { wait: 'Enter 确认导入', send: '' },
    ]);
    assert.match(result.stdout, /claude \(2\)/);
    assert.match(result.stdout, /codex \(1\)/);
    assert.match(result.stdout, /描述：/);
    assert.doesNotMatch(result.stdout, /完整描述/);
    assert.doesNotMatch(result.stdout, /顶部按 ↑ 选择 Agent/);
    assert.doesNotMatch(result.stdout, /错误：/);
    const listOutput = result.screens?.list;
    const detailOutput = result.screens?.detail;
    assert.ok(listOutput, 'import selection screen must be captured');
    assert.ok(detailOutput, 'import detail screen must be captured');
    const size = { rows: 40, columns: 120 };
    const listFrame = frameBounds(await renderTerminalScreen(listOutput, size));
    const detailFrame = frameBounds(await renderTerminalScreen(detailOutput, size));
    assert.deepEqual(
      { height: detailFrame.height, width: detailFrame.width, x: detailFrame.x, y: detailFrame.y },
      { height: listFrame.height, width: listFrame.width, x: listFrame.x, y: listFrame.y }
    );
    assert.equal((await lstat(claudeSkill)).isDirectory(), true);
    assert.equal((await lstat(claudeSkill2)).isSymbolicLink(), true);
    assert.equal((await lstat(codexSkill)).isSymbolicLink(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY import detail keeps its frame while scrolling long descriptions', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const root = join(context.project, 'skill-set');
  await makeSkill(join(root, 'alpha'), 'alpha', '详细描述'.repeat(80));
  await makeSkill(join(root, 'beta'), 'beta', '另一项技能');
  const size = { rows: 14, columns: 60 };

  try {
    const result = await runInteractive(context, ['import', root], [
      { wait: '发现以下技能', capture: 'list', send: '\u001b[C', enter: false },
      {
        wait: '描述：',
        capture: 'detail',
        send: '\u001b[B'.repeat(20),
        enter: false,
      },
      { wait: '来自 本地', capture: 'detailScrolled', send: '\u001b', enter: false },
      { wait: '→ 详情', send: '\u001b', enter: false },
    ], context.project, size);
    const listOutput = result.screens?.list;
    const detailOutput = result.screens?.detail;
    const detailScrolledOutput = result.screens?.detailScrolled;
    assert.ok(listOutput, 'import selection screen must be captured');
    assert.ok(detailOutput, 'import detail screen must be captured');
    assert.ok(detailScrolledOutput, 'scrolled import detail screen must be captured');
    const listFrame = frameBounds(await renderTerminalScreen(listOutput, size));
    const detailFrame = frameBounds(await renderTerminalScreen(detailOutput, size));
    const detailScrolledFrame = frameBounds(await renderTerminalScreen(detailScrolledOutput, size));
    assert.deepEqual(detailFrame, listFrame);
    assert.deepEqual(detailScrolledFrame, listFrame);
    assert.match((await renderTerminalScreen(detailScrolledOutput, size)).join('\n'), /来自 本地/);
    assert.doesNotMatch((await renderTerminalScreen(detailOutput, size)).join('\n'), /备注/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY import list gives long Skill names room before descriptions', async (t) => {
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

test.concurrent('TTY source rebinding discovers repository paths and focuses the matching Skill', async (t) => {
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
      { send: '\u001b[C', enter: false, delay: 10 },
      { wait: 's 来源', send: 's', enter: false },
      { wait: 'Git 来源', send: `file://${repository}`, enter: false },
      { wait: 'rebind-remote', send: '' },
      { wait: '分支、Tag 或 Commit', send: 'main', enter: false },
      { wait: 'main', send: '' },
      { wait: '选择仓库内 Skill', send: '' },
      { wait: 's 来源', send: 'q', enter: false },
      { wait: 'q 退出', send: 'q', enter: false },
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

test.concurrent('TTY list searches across groups and jumps directly to a group', async (t) => {
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
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: '/ 搜索 · ? 快捷键', send: '/', enter: false },
      { wait: '搜索技能', send: 'alphax', enter: false },
      { wait: '没有匹配的技能', send: '\x7f', enter: false },
      { wait: 'frontend · shared / ', send: '\u001b', enter: false },
      { wait: '? 快捷键', send: '?', enter: false },
      { wait: '完整快捷键', send: '\u001b', enter: false },
      { wait: '/ 搜索 · ? 快捷键 · q 退出', send: 'g', enter: false },
      { wait: '跳转到分组', send: '2', enter: false },
      { wait: '› ○ shared (2)', send: ' ', enter: false },
      { wait: '已选 2', send: 't', enter: false },
      { wait: '为 2 个技能添加标签', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '已为 2 个技能添加标签', send: 'q', enter: false },
    ]);

    assert.match(result.stdout, /frontend · shared \/ /);
    assert.match(result.stdout, /● shared \(2\)/);
    assert.match(result.stdout, /完整快捷键/);
    assert.match(result.stdout, /Esc 关闭/);
    assert.doesNotMatch(result.stdout, /Esc \/ q \/ \? 关闭/);
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

test.concurrent('TTY empty search preserves the browser frame width', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const size = { rows: 40, columns: 120 };

  try {
    const result = await runInteractive(context, [], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: '/ 搜索 · ? 快捷键 · q 退出', send: '/', enter: false },
      { wait: '搜索技能', send: 'missing', enter: false },
      { wait: '没有匹配的技能', capture: 'empty', send: '\u001b', enter: false },
      { wait: '/ 搜索 · ? 快捷键 · q 退出', send: 'q', enter: false },
    ], context.project, size);

    const emptyOutput = result.screens?.empty;
    assert.ok(emptyOutput, 'empty search screen must be captured');
    assert.equal(
      frameBounds(await renderTerminalScreen(emptyOutput, size)).width,
      size.columns,
      'empty search results must preserve the browser frame width'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY list flattens a sole ungrouped section', async (t) => {
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
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'plain-skill', send: 'q', enter: false },
    ]);

    assert.match(result.stdout, /plain-skill/);
    assert.doesNotMatch(result.stdout, /未分组/);
    assert.doesNotMatch(result.stdout, /g 分组/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY add bootstraps an empty collection from a local Skill', async (t) => {
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
      { wait: '路径或 Git 来源：', send: source, enter: false },
      { wait: 'first-skill', send: '' },
      { wait: '选择分组', send: '' },
      { wait: 'Enter 确认导入', send: '' },
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

test.concurrent('TTY entry opens collection browser directly', async (t) => {
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

test.concurrent('collection browser removes the current Skill with confirmation', async (t) => {
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
      { wait: '删除收藏', send: '', enter: false },
      { wait: '(y/N)', send: 'y', enter: false },
      { wait: '收藏夹 0', send: 'q', enter: false },
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

test.concurrent('project browser deletes a local Skill with default-cancel confirmation', async (t) => {
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
      { wait: '(y/N)', send: 'n', enter: false },
      { wait: 'd 删除', send: 'd', enter: false },
      { wait: '(y/N)', send: 'y', enter: false },
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

test.concurrent('global browser batch deletes collected and local Skill locations', async (t) => {
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
      { wait: '(y/N)', send: 'y', enter: false },
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

test.concurrent('collection browser shows progress while updating a Skill', async (t) => {
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
      { wait: '正在更新：remote-skill', send: '', enter: false },
      { wait: 'remote-skill: updated', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /正在更新：remote-skill/);
    assert.match(result.stdout, /remote-skill: updated/);
    assert.equal(
      result.stdout.split('\u001B[2J\u001B[H').length - 1,
      1,
      '更新结束后不得绕过 Ink 再次清屏，否则其行数和光标状态会失效'
    );
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'browser update\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.sequential('collection browser updates all selected Skills without shifting the browser', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const { repository, skill } = await makeGitSkillRepo(context);
  const second = join(repository, 'skills/second-skill');
  const third = join(repository, 'skills/third-skill');

  try {
    await makeSkill(second, 'second-skill');
    await makeSkill(third, 'third-skill');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'add second skill'], { cwd: repository });
    await run(context, ['import', `file://${repository}`, '--all', '--yes']);

    await writeFile(join(skill, 'asset.txt'), 'first browser update\n', 'utf8');
    await writeFile(join(second, 'asset.txt'), 'second browser update\n', 'utf8');
    await writeFile(join(third, 'asset.txt'), 'third browser update\n', 'utf8');
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['commit', '-m', 'update selected skills'], { cwd: repository });

    const result = await runInteractive(context, [], [
      { wait: 'q 退出', send: '\u001b[B', enter: false },
      { wait: 'remote-skill', send: ' ', enter: false },
      { wait: '已选 1', send: '\u001b[B', enter: false },
      { wait: 'second-skill', send: ' ', enter: false },
      { wait: '已选 2', send: '\u001b[B', enter: false },
      { wait: 'third-skill', send: ' ', enter: false },
      { wait: 'u 更新可更新的已选技能 (3)', send: 'u', enter: false },
      { wait: '正在更新 1/3：remote-skill', send: '', enter: false },
      { wait: '正在更新 2/3：second-skill', send: '', enter: false },
      { wait: '正在更新 3/3：third-skill', send: '', enter: false },
      { wait: 'third-skill: updated', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /正在更新 1\/3：remote-skill/);
    assert.match(result.stdout, /正在更新 2\/3：second-skill/);
    assert.match(result.stdout, /正在更新 3\/3：third-skill/);
    assert.equal(
      await readFile(join(context.collection, 'skills/remote-skill/asset.txt'), 'utf8'),
      'first browser update\n'
    );
    assert.equal(
      await readFile(join(context.collection, 'skills/second-skill/asset.txt'), 'utf8'),
      'second browser update\n'
    );
    assert.equal(
      await readFile(join(context.collection, 'skills/third-skill/asset.txt'), 'utf8'),
      'third browser update\n'
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY entry defaults to existing project Skill directories', async (t) => {
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
      { wait: '→ 查看 · d 删除', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '● 当前项目', send: '' },
      { wait: '● 软链（推荐）', send: '' },
      { wait: '› ○ 标准 Agent Skills (.agents/skills)', send: '' },
      { wait: '技能：entry-agent-skill', send: '' },
      { wait: '已通过软链添加 1 个技能到 1 个目录', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /安装位置/);
    assert.match(result.stdout, /添加方式/);
    assert.match(result.stdout, /目标目录/);
    assert.match(result.stdout, /确认/);
    assert.doesNotMatch(result.stdout, /添加到：|选择项目 Skill 目录：/);
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

test.concurrent('TTY entry can copy a selected collection Skill into a global Agent directory', async (t) => {
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
      { wait: '→ 查看 · d 删除', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '● 当前项目', send: '\u001b[B', enter: false },
      { wait: '● 全局', send: '' },
      { wait: '● 软链（推荐）', send: '\u001b[B', enter: false },
      { wait: '● 复制', send: '' },
      { wait: '› ○ 标准 Agent Skills (~/.agents/skills)', send: ' ', enter: false },
      { wait: '› ● 标准 Agent Skills (~/.agents/skills)', send: '' },
      { wait: '技能：entry-copy-skill', send: '' },
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

test.concurrent('TTY entry cancels installation configuration without creating a target', async (t) => {
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
      { wait: '→ 查看 · d 删除', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '● 当前项目', send: '\u001b', enter: false },
      { wait: 'q 退出', send: 'q', enter: false },
    ]);
    assert.doesNotMatch(result.stdout, /错误：/);
    await assert.rejects(lstat(join(context.project, '.agents/skills')), { code: 'ENOENT' });
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('collection browser confirms replacing an existing add target in a popup', async (t) => {
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
      { wait: '→ 查看 · d 删除', send: ' ', enter: false },
      { wait: '已选 1', send: '' },
      { wait: '● 当前项目', send: '' },
      { wait: '● 软链（推荐）', send: '' },
      { wait: '› ● 标准 Agent Skills (.agents/skills)', send: '' },
      { wait: '技能：entry-replace-skill', send: '' },
      { wait: '替换目标', send: '', enter: false },
      { wait: '(y/N)', send: 'y', enter: false },
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

test.concurrent('TTY project tab labels local skills and imports them with i', async (t) => {
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
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: '→ 查看', send: '\u001b[C', enter: false },
      { wait: '‹ collected-skill', send: '\u001b', enter: false },
      { wait: '→ 查看 · d 删除', send: '\u001b[B', enter: false },
      { wait: '› ○ 本地 · local-only', send: ' ', enter: false },
      { wait: 'i 加入收藏夹', send: 'i', enter: false },
      { wait: '已导入 1 个技能到收藏夹', send: 'q', enter: false },
    ]);
    assert.match(result.stdout, /本地 · local-only/);
    assert.match(result.stdout, /‹ collected-skill/);
    assert.doesNotMatch(result.stdout, /本地 · collected-skill/);
    assert.match(result.stdout, /○ 本地 · local-only/);
    assert.match(result.stdout, /引用 ·/);
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

test.concurrent('TTY project tab materializes the current Skill reference from the more-actions menu', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.root, 'sources/menu-reference');
  const reference = join(context.project, '.agents/skills/menu-reference');
  await makeSkill(source, 'menu-reference');
  await mkdir(join(context.project, '.agents/skills'), { recursive: true });
  await symlink(source, reference);

  try {
    const result = await runInteractive(context, ['list'], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: 'm 更多操作', capture: 'footer', send: 'm', enter: false },
      { wait: '更多操作', send: '', enter: false },
      { wait: '技能：menu-reference', send: '', enter: false },
      { wait: '将引用转为副本', send: '' },
      { wait: '正在转换 1/1：menu-reference', send: '', enter: false },
      { wait: '已将 menu-reference 转为副本', send: 'q', enter: false },
    ], context.project, { rows: 10, columns: 40 });

    assert.match(result.stdout, /引用 ·/);
    assert.match(result.stdout, /m 更多操作/);
    assert.doesNotMatch(result.stdout, /转换.*\(y\/N\)/);
    const footerOutput = result.screens?.footer;
    assert.ok(footerOutput, 'more-actions footer must be captured');
    const footerScreen = await renderTerminalScreen(footerOutput, { rows: 10, columns: 40 });
    const moreActionsLine = footerScreen.findIndex((line) => line.includes('m 更多操作'));
    const navigationLine = footerScreen.findIndex((line) => line.includes('/ 搜索'));
    assert.ok(moreActionsLine >= 0, 'more-actions shortcut must be visible');
    assert.equal(navigationLine, moreActionsLine + 1, 'navigation must immediately follow more actions');
    assert.equal((await lstat(reference)).isDirectory(), true);
    assert.equal((await lstat(reference)).isSymbolicLink(), false);
    assert.equal(await readFile(join(reference, 'asset.txt'), 'utf8'), 'keep me\n');
    assert.equal(await readFile(join(source, 'asset.txt'), 'utf8'), 'keep me\n');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY project more-actions menu materializes all selected Skill references', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const skillRoot = join(context.project, '.agents/skills');
  const alphaSource = join(context.root, 'sources/alpha-reference');
  const betaSource = join(context.root, 'sources/beta-reference');
  const alpha = join(skillRoot, 'alpha-reference');
  const beta = join(skillRoot, 'beta-reference');
  await makeSkill(alphaSource, 'alpha-reference');
  await makeSkill(betaSource, 'beta-reference');
  await mkdir(skillRoot, { recursive: true });
  await symlink(alphaSource, alpha);
  await symlink(betaSource, beta);

  try {
    const result = await runInteractive(context, ['list'], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: 'm 更多操作', send: ' ', enter: false },
      { wait: '已选 1', send: '\u001b[B', enter: false },
      { wait: 'beta-reference', send: ' ', enter: false },
      { wait: 'm 更多操作 · i 加入收藏夹 · 已选 2', send: 'm', enter: false },
      { wait: '已选择 2 个技能', send: '', enter: false },
      { wait: '将引用转为副本', send: '' },
      { wait: '正在转换 1/2：alpha-reference', send: '', enter: false },
      { wait: '正在转换 2/2：beta-reference', send: '', enter: false },
      { wait: '已将 2 个引用转为副本', send: 'q', enter: false },
    ]);

    assert.doesNotMatch(result.stdout, /转换.*\(y\/N\)/);
    assert.equal((await lstat(alpha)).isDirectory(), true);
    assert.equal((await lstat(beta)).isDirectory(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('TTY project more-actions menu stays unavailable for a mixed selection', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const skillRoot = join(context.project, '.agents/skills');
  const source = join(context.root, 'sources/alpha-reference');
  const reference = join(skillRoot, 'alpha-reference');
  const local = join(skillRoot, 'beta-local');
  await makeSkill(source, 'alpha-reference');
  await makeSkill(local, 'beta-local');
  await symlink(source, reference);

  try {
    const result = await runInteractive(context, ['list'], [
      { wait: '↓ 进入', send: '\u001b[B', enter: false },
      { wait: '切换 Agent', send: '\u001b[B', enter: false },
      { wait: 'm 更多操作', send: ' ', enter: false },
      { wait: '已选 1', send: '\u001b[B', enter: false },
      { wait: 'beta-local', send: ' ', enter: false },
      { wait: 'i 加入收藏夹 · 已选 2', send: 'm', enter: false },
      { send: 'q', enter: false, delay: 10 },
    ]);

    assert.doesNotMatch(result.stdout, /╭─ 更多操作/);
    assert.equal((await lstat(reference)).isSymbolicLink(), true);
    assert.equal((await lstat(local)).isDirectory(), true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('Ctrl+C during reference conversion exits 130 and preserves the reference', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.root, 'sources/interrupted-reference');
  const reference = join(context.project, '.agents/skills/interrupted-reference');
  await makeSkill(source, 'interrupted-reference');
  await mkdir(dirname(reference), { recursive: true });
  await symlink(source, reference);

  try {
    try {
      await runInteractive(context, ['list'], [
        { wait: '↓ 进入', send: '\u001b[B', enter: false },
        { wait: '切换 Agent', send: '\u001b[B', enter: false },
        { wait: 'm 更多操作', send: 'm', enter: false },
        { wait: '将引用转为副本', send: '' },
        {
          wait: '正在转换 1/1：interrupted-reference',
          send: '\u0003',
          enter: false,
        },
      ]);
      assert.fail('Ctrl+C should interrupt reference conversion');
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string };
      assert.equal(failure.code, 130);
      assert.doesNotMatch(failure.stdout || '', /错误：/);
    }
    assert.equal((await lstat(reference)).isSymbolicLink(), true);
    assert.equal(await readFile(join(reference, 'asset.txt'), 'utf8'), 'keep me\n');
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test.concurrent('iskills init offers origin setup and --remote configures it later', async () => {
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

test.concurrent('iskills init configures origin from its first-run prompt', async () => {
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

test.concurrent('TTY import cancellation exits without an error', async (t) => {
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

test.concurrent('collection browser sync establishes the first upstream and excludes machine-local state', async () => {
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
      { wait: '? 快捷键', send: 's', enter: false },
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
