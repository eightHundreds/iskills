import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface TestContext {
  root: string;
  home: string;
  config: string;
  project: string;
  env: NodeJS.ProcessEnv;
  collection: string;
}

interface InteractiveStep {
  send: string;
  wait?: string;
  regex?: boolean;
  delay?: number;
  delayAfter?: number;
  enter?: boolean;
}

interface JsonSkill {
  name: string;
  description?: string;
  tags?: string[];
}

interface JsonLink {
  skill: string;
  path: string;
}

const exec = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options?: ExecFileOptionsWithStringEncoding
) => Promise<ExecResult>;
const cli = resolve('bin/iskills.js');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function makeContext(): Promise<TestContext> {
  const root = await mkdtemp(join(tmpdir(), 'iskills-cli-'));
  const home = join(root, 'home');
  const config = join(root, 'config');
  const project = join(root, 'project');
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(config, { recursive: true }),
    mkdir(project, { recursive: true }),
  ]);
  return {
    root,
    home,
    config,
    project,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config },
    collection: join(config, 'iskills'),
  };
}

async function makeSkill(
  path: string,
  name = 'demo-skill',
  description = 'Demo skill'
): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions.\n`,
    'utf8'
  );
  await writeFile(join(path, 'asset.txt'), 'keep me\n', 'utf8');
}

async function run(
  context: TestContext,
  args: string[],
  cwd = context.project
): Promise<ExecResult> {
  return exec(process.execPath, [cli, ...args], {
    cwd,
    env: context.env,
  });
}

async function runInteractive(
  context: TestContext,
  args: string[],
  steps: InteractiveStep[],
  cwd = context.project
): Promise<ExecResult> {
  const driver = String.raw`
import fcntl, json, os, pty, select, struct, sys, termios, time

command = json.loads(os.environ.pop("SK_PTY_COMMAND"))
steps = json.loads(os.environ.pop("SK_PTY_STEPS"))
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(command[0], command, os.environ)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

output = bytearray()
cursor = 0

def read_once(timeout=0.1):
    ready, _, _ = select.select([fd], [], [], timeout)
    if not ready:
        return False
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        return False
    if chunk:
        output.extend(chunk)
        return True
    return False

for step in steps:
    wait = step.get("wait")
    if wait:
        pattern = wait.encode("utf-8")
        deadline = time.time() + 10
        while output.find(pattern, cursor) < 0 and time.time() < deadline:
            read_once()
        found = output.find(pattern, cursor)
        if found < 0:
            raise TimeoutError("PTY prompt not found: " + wait + "\n" + output.decode("utf-8", "replace"))
        cursor = found + len(pattern)
    else:
        time.sleep(step.get("delay", 150) / 1000)
    if step.get("delayAfter"):
        time.sleep(step["delayAfter"] / 1000)
    try:
        payload = step["send"].encode("utf-8")
        if step.get("enter", True):
            payload += b"\r"
        os.write(fd, payload)
    except OSError:
        sys.stdout.buffer.write(output)
        raise

deadline = time.time() + 10
status = None
while time.time() < deadline:
    read_once()
    finished, current_status = os.waitpid(pid, os.WNOHANG)
    if finished:
        status = current_status
        while read_once(0):
            pass
        break
if status is None:
    os.kill(pid, 9)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  return exec('python3', ['-c', driver], {
    cwd,
    env: {
      ...context.env,
      SK_PTY_COMMAND: JSON.stringify([process.execPath, cli, ...args]),
      SK_PTY_STEPS: JSON.stringify(steps),
    },
  });
}

async function makeGitSkillRepo(
  context: TestContext,
  name = 'remote-skill'
): Promise<{ repository: string; skill: string }> {
  const repository = join(context.root, 'remote');
  const skill = join(repository, 'skills', name);
  await makeSkill(skill, name);
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repository });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
  await exec('git', ['add', '.'], { cwd: repository });
  await exec('git', ['commit', '-m', 'initial'], { cwd: repository });
  return { repository, skill };
}

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

test('prints import help instead of parsing it as an import option', async () => {
  const context = await makeContext();
  try {
    for (const args of [
      ['import', '--help'],
      ['help', 'import'],
    ]) {
      const result = await run(context, args);
      assert.match(result.stdout, /iskills import \[路径或 Git URL\]/);
      assert.match(result.stdout, /--replace/);
      assert.equal(result.stderr, '');
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

test('TTY list switches tabs, opens detail and edits a note', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  const source = join(context.project, 'interactive-skill');
  await makeSkill(source, 'interactive-skill');

  try {
    await run(context, ['import', source, '--all', '--yes']);
    const result = await runInteractive(
      context,
      ['list'],
      [
        { wait: 'q 退出', send: '\u001b[C', enter: false },
        { wait: 'interactive-skill', send: '' },
        { wait: 'n 备注', send: 'n', enter: false, delayAfter: 100 },
        { wait: '编辑备注', send: 'written from tty', enter: false, delayAfter: 100 },
        { wait: '│ written from tty', send: '' },
        { wait: 'b/Esc 返回', send: 'b', enter: false, delayAfter: 200 },
        { wait: 'q 退出', send: '/', enter: false, delayAfter: 100 },
        { wait: '搜索技能', send: 'missing', enter: false, delayAfter: 100 },
        { wait: '没有匹配的技能', send: '\u001b', enter: false, delayAfter: 100 },
        { wait: 'interactive-skill', send: 'q', enter: false, delayAfter: 100 },
      ]
    );
    assert.match(result.stdout, /当前项目 0\s+│\s+收藏夹 1/);
    assert.match(result.stdout, /interactive-skill/);
    assert.match(result.stdout, /关联位置/);
    const metadata = JSON.parse(
      await readFile(join(context.collection, 'metadata/interactive-skill.json'), 'utf8')
    );
    assert.equal(metadata.note, 'written from tty', result.stdout);
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
      { wait: '收藏夹还是空的', send: '\u001b[B\u001b[B', enter: false },
      { wait: '❯ 输入本地路径或 Git 来源', send: '' },
      { wait: '路径或 Git 来源', send: source, enter: false, delayAfter: 100 },
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

test('TTY main menu shows numbered actions and accepts a number shortcut', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  await makeSkill(join(context.project, 'entry-skill'), 'entry-skill');

  try {
    const result = await runInteractive(context, [], [
      { wait: '你想做什么？', send: '2', enter: false },
      { wait: '继续吗？', send: 'n', enter: false },
    ]);
    assert.match(result.stdout, /1\. 从收藏夹添加到当前目录/);
    assert.match(result.stdout, /5\. 更新远程来源技能/);
    assert.match(result.stdout, /6\. 初始化收藏夹 Git/);
    assert.doesNotMatch(result.stdout, /同步收藏夹 Git/);
    assert.match(result.stdout, /entry-skill/);
    assert.doesNotMatch(result.stdout, /错误：/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test('TTY main menu initializes Git and then hides the action', async (t) => {
  try {
    await exec('python3', ['--version']);
  } catch (error) {
    t.skip(`PTY utility is unavailable: ${errorMessage(error)}`);
    return;
  }

  const context = await makeContext();
  try {
    const initialized = await runInteractive(context, [], [
      { wait: '初始化收藏夹 Git', send: '6', enter: false },
    ]);
    assert.match(initialized.stdout, /已初始化收藏夹 Git/);
    assert.equal((await lstat(join(context.collection, '.git'))).isDirectory(), true);

    const reopened = await runInteractive(context, [], [
      { wait: '你想做什么？', send: '\u001b', enter: false },
    ]);
    assert.doesNotMatch(reopened.stdout, /初始化收藏夹 Git/);
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
    assert.doesNotMatch(result.stdout, /错误：|没有选择技能/);
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
  await makeSkill(first, 'duplicate');
  await makeSkill(second, 'duplicate');
  await writeFile(join(first, 'version.txt'), 'first\n', 'utf8');
  await writeFile(join(second, 'version.txt'), 'second\n', 'utf8');

  try {
    await run(context, ['import', first, '--all', '--yes']);
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

    await runInteractive(context, ['list'], [
      { wait: 'q 退出', send: '\u001b[C', enter: false },
      { wait: 's 同步 Git', send: 's', enter: false },
      { wait: 'q 退出', send: 'q', enter: false },
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
