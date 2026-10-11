import { cp, mkdir, mkdtemp, rename, rm, symlink, lstat, readlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { errorMessage, pathPresent, readState, writeState } from './core.js';
import { isPhysicalSelfInstall } from './cross-agent-install.js';
import { DomainError, domainNotify } from './errors.js';
import { OperationFailure } from './operation.js';

/** Commit one installation target and its link state; earlier targets remain committed. */
export async function installSkillTarget(
  name: string,
  source: string,
  target: string,
  copy: boolean,
  registerUsage = !copy,
): Promise<void> {
  if (await isPhysicalSelfInstall(target, source)) {
    throw new DomainError('cmd.targetPointsSelf', { target });
  }
  const state = await readState();
  await mkdir(dirname(target), { recursive: true });
  const transaction = await mkdtemp(join(dirname(target), '.iskills-install-'));
  const staged = join(transaction, 'new');
  const backup = join(transaction, 'old');
  let backedUp = false;
  let installed = false;
  const before = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  const beforeLink = before?.isSymbolicLink() ? await readlink(target) : null;
  try {
    if (copy) await cp(source, staged, { recursive: true, errorOnExist: true });
    else await symlink(source, staged, 'dir');
    if (await pathPresent(target)) {
      await rename(target, backup);
      backedUp = true;
    }
    await rename(staged, target);
    installed = true;
    const links = state.links.filter((link) => resolve(link.path) !== resolve(target));
    if (registerUsage) links.push({ skill: name, path: target, kind: 'usage' });
    // writeState atomically renames its temporary file: failure leaves old state intact.
    if (registerUsage || links.length !== state.links.length) {
      await writeState({ ...state, links });
    }
  } catch (error) {
    try {
      if (installed) await rm(target, { recursive: true, force: true });
      if (backedUp) await rename(backup, target);
    } catch (rollbackError) {
      throw new DomainError('domain.installRollbackFailed', {
        target, error: errorMessage(error), rollback: errorMessage(rollbackError), backup,
      });
    }
    await rm(transaction, { recursive: true, force: true }).catch(() => {});
    const after = await lstat(target).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; });
    const restored = before ? Boolean(after && before.dev === after.dev && before.ino === after.ino && (beforeLink === null || beforeLink === await readlink(target))) : after === null;
    if (process.env.ISKILLS_AGENT_CLI === '1') throw new OperationFailure('execution.writeFailed', 'The installation target could not be written.', { target, stage: 'install', restored }, 1, restored ? 'after-fix' : 'inspect-state');
    throw error;
  }
  try {
    await rm(transaction, { recursive: true, force: true });
  } catch (error) {
    domainNotify('domain.installCleanupFailed', { target, backup, error: errorMessage(error) });
  }
}
