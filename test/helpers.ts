import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Terminal } from '@xterm/headless';

export interface ExecResult {
  stdout: string;
  stderr: string;
  screens?: Record<string, string>;
}

export interface TestContext {
  root: string;
  home: string;
  config: string;
  project: string;
  env: NodeJS.ProcessEnv;
  collection: string;
}

export interface InteractiveStep {
  send: string;
  wait?: string;
  regex?: boolean;
  delay?: number;
  enter?: boolean;
  capture?: string;
}

export interface TerminalSize {
  rows: number;
  columns: number;
}

export interface JsonSkill {
  name: string;
  description?: string;
  tags?: string[];
  fromCollection?: boolean;
}

export interface JsonLink {
  skill: string;
  path: string;
}

const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options?: ExecFileOptionsWithStringEncoding
) => Promise<ExecResult>;

export async function exec(
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding = {}
): Promise<ExecResult> {
  return execFileAsync(file, args, {
    ...options,
    env: file === 'git'
      ? {
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          ...options.env,
        }
      : options.env,
  });
}
const cli = resolve('bin/iskills.js');

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function renderTerminalScreen(
  output: string,
  { rows, columns }: TerminalSize
): Promise<string[]> {
  const terminal = new Terminal({ allowProposedApi: true, cols: columns, rows });
  await new Promise<void>((resolve) => terminal.write(output, resolve));
  const screen = Array.from({ length: rows }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true) ?? ''
  );
  terminal.dispose();
  return screen;
}

export async function makeContext(): Promise<TestContext> {
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
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      HOME: home,
      XDG_CONFIG_HOME: config,
    },
    collection: join(config, 'iskills'),
  };
}

export async function makeSkill(
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

export async function run(
  context: TestContext,
  args: string[],
  cwd = context.project
): Promise<ExecResult> {
  return exec(process.execPath, [cli, ...args], {
    cwd,
    env: context.env,
  });
}

export async function runInteractive(
  context: TestContext,
  args: string[],
  steps: InteractiveStep[],
  cwd = context.project,
  size: TerminalSize = { rows: 40, columns: 120 }
): Promise<ExecResult> {
  const driver = String.raw`
import base64, fcntl, json, os, pty, select, struct, sys, termios, time

command = json.loads(os.environ.pop("SK_PTY_COMMAND"))
steps = json.loads(os.environ.pop("SK_PTY_STEPS"))
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(command[0], command, os.environ)
rows = int(os.environ.pop("SK_PTY_ROWS"))
columns = int(os.environ.pop("SK_PTY_COLUMNS"))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))

output = bytearray()
cursor = 0
captures = {}

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

def wait_for_idle():
    deadline = time.time() + 1
    idle_deadline = time.time() + 0.01
    while time.time() < deadline:
        remaining = idle_deadline - time.time()
        if remaining <= 0:
            return
        if read_once(min(remaining, 0.01)):
            idle_deadline = time.time() + 0.01

for step in steps:
    wait = step.get("wait")
    if wait:
        pattern = wait.encode("utf-8")
        deadline = time.time() + 20
        while output.find(pattern, cursor) < 0 and time.time() < deadline:
            read_once()
        found = output.find(pattern, cursor)
        if found < 0:
            raise TimeoutError("PTY prompt not found: " + wait + "\n" + output.decode("utf-8", "replace"))
        cursor = found + len(pattern)
        wait_for_idle()
    elif step.get("delay"):
        time.sleep(step["delay"] / 1000)
    capture = step.get("capture")
    if capture:
        settle_deadline = time.time() + 1
        idle_deadline = time.time() + 0.1
        while time.time() < settle_deadline and time.time() < idle_deadline:
            if read_once(0.02):
                idle_deadline = time.time() + 0.1
        captures[capture] = base64.b64encode(output).decode("ascii")
    try:
        payload = step["send"].encode("utf-8")
        if step.get("enter", True):
            payload += b"\r"
        if payload:
            os.write(fd, payload)
    except OSError:
        sys.stdout.buffer.write(output)
        raise

deadline = time.time() + 20
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
if captures:
    sys.stdout.buffer.write(b"\n__ISKILLS_SCREEN_CAPTURES__")
    sys.stdout.buffer.write(json.dumps(captures).encode("ascii"))
exit_code = os.waitstatus_to_exitcode(status)
sys.exit(128 - exit_code if exit_code < 0 else exit_code)
`;
  const result = await exec('python3', ['-c', driver], {
    cwd,
    env: {
      ...context.env,
      SK_PTY_COMMAND: JSON.stringify([process.execPath, cli, ...args]),
      SK_PTY_STEPS: JSON.stringify(steps),
      SK_PTY_ROWS: String(size.rows),
      SK_PTY_COLUMNS: String(size.columns),
    },
  });
  const marker = '\n__ISKILLS_SCREEN_CAPTURES__';
  const markerIndex = result.stdout.lastIndexOf(marker);
  if (markerIndex === -1) return result;
  const captures = JSON.parse(result.stdout.slice(markerIndex + marker.length)) as Record<string, string>;
  return {
    ...result,
    stdout: result.stdout.slice(0, markerIndex),
    screens: Object.fromEntries(
      Object.entries(captures).map(([name, output]) => [name, Buffer.from(output, 'base64').toString('utf8')])
    ),
  };
}

export async function makeGitSkillRepo(
  context: TestContext,
  name = 'remote-skill',
  directory = 'remote'
): Promise<{ repository: string; skill: string }> {
  const repository = join(context.root, directory);
  const skill = join(repository, 'skills', name);
  await makeSkill(skill, name);
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', '.'], { cwd: repository });
  await exec('git', ['commit', '-m', 'initial'], { cwd: repository });
  return { repository, skill };
}
