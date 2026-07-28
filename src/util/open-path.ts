import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Open a filesystem path in the platform file manager (Finder / Explorer / xdg-open). */
export async function openPath(path: string): Promise<void> {
  if (process.env.SK_NO_OPEN === '1') return;

  if (process.platform === 'darwin') {
    await execFileAsync('open', [path]);
    return;
  }
  if (process.platform === 'win32') {
    try {
      await execFileAsync('explorer', [path]);
    } catch (error) {
      // explorer often exits non-zero even when the folder opened successfully.
      // Only surface real spawn failures (e.g. ENOENT), not numeric exit codes.
      const code = (error as NodeJS.ErrnoException).code;
      if (typeof code === 'string') throw error;
    }
    return;
  }
  await execFileAsync('xdg-open', [path]);
}
