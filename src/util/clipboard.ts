import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function clipboardReadCommands(
  platform: NodeJS.Platform = process.platform
): Array<[string, string[]]> {
  if (platform === 'darwin') return [['pbpaste', []]];
  if (platform === 'win32') {
    return [['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]];
  }
  return [
    ['wl-paste', ['--no-newline']],
    ['xclip', ['-selection', 'clipboard', '-o']],
  ];
}

export function clipboardWriteCommands(
  platform: NodeJS.Platform = process.platform
): Array<[string, string[]]> {
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [['clip', []]];
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
  ];
}

/** Best-effort clipboard read. Empty or unavailable → undefined. */
export async function readClipboardText(): Promise<string | undefined> {
  for (const [command, args] of clipboardReadCommands()) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: 2000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      if (stdout.trim()) return stdout;
    } catch {
      continue;
    }
  }
  return undefined;
}

function spawnWrite(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('clipboard write timed out'));
    }, 2000);
    const fail = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
    child.stdin.end(text, 'utf8');
  });
}

/** Best-effort clipboard write. Missing tools or spawn errors → false. */
export async function writeClipboardText(text: string): Promise<boolean> {
  for (const [command, args] of clipboardWriteCommands()) {
    try {
      await spawnWrite(command, args, text);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
