import { cp, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { errorMessage, pathPresent, readState, writeState } from './core.js';
import { isPhysicalSelfInstall } from './cross-agent-install.js';
import { DomainError, domainNotify } from './errors.js';

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
    throw error;
  }
  try {
    await rm(transaction, { recursive: true, force: true });
  } catch (error) {
    domainNotify('domain.installCleanupFailed', { target, backup, error: errorMessage(error) });
  }
}
