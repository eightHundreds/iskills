import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Best-effort clipboard read. Empty or unavailable → undefined. */
export async function readClipboardText(): Promise<string | undefined> {
  const commands: Array<[string, string[]]> =
    process.platform === 'darwin'
      ? [['pbpaste', []]]
      : [
          ['wl-paste', ['--no-newline']],
          ['xclip', ['-selection', 'clipboard', '-o']],
        ];
  for (const [command, args] of commands) {
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
