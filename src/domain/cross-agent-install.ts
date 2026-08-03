/**
 * Cross-agent install classification (project/global location → other agent roots).
 * UI may use sync flags; write path re-validates on disk.
 */
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { collectionPaths, pathPresent, readSkill } from './core.js';
import type { Skill } from './types.js';

/** Sync gate from browser skill flags (list annotation). */
export function isCrossAgentInstallable(skill: Skill): boolean {
  if (skill.isReference) return Boolean(skill.fromCollection);
  return true;
}

export type CrossAgentInstallPlan = {
  skill: Skill;
  /** Absolute path B should symlink to (canonical when possible). */
  linkTarget: string;
  /** Register collection usage link after install (collection-backed only). */
  registerUsage: boolean;
};

/**
 * Best-effort canonical path: realpath when the path exists; otherwise
 * realpath(parent) + basename so symlink parents still compare equal.
 */
export async function canonicalizePath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    try {
      return join(await realpath(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

export async function sameCanonicalPath(left: string, right: string): Promise<boolean> {
  return (await canonicalizePath(left)) === (await canonicalizePath(right));
}

/** Source skill root for filtering same-path agent targets (dirname of skill path). */
export function skillLocationRoot(skill: Skill): string {
  return dirname(resolve(skill.path));
}

/** Lexical + canonical forms of skill location roots (for target filtering). */
export async function collectSkillSourceRoots(skills: Skill[]): Promise<Set<string>> {
  const roots = new Set<string>();
  for (const skill of skills) {
    const root = skillLocationRoot(skill);
    roots.add(resolve(root));
    roots.add(await canonicalizePath(root));
  }
  return roots;
}

/**
 * True when installing a symlink at `target` would point at / remove the same
 * physical tree as `linkTarget` (e.g. agent roots are aliases via parent symlink).
 */
export async function isPhysicalSelfInstall(
  target: string,
  linkTarget: string
): Promise<boolean> {
  const linkCanon = await canonicalizePath(linkTarget);
  const targetAbs = resolve(target);
  if (targetAbs === linkCanon || targetAbs === resolve(linkTarget)) return true;
  // Projected location through symlink parents (target may not exist yet).
  const projected = await canonicalizePath(targetAbs);
  if (projected === linkCanon) return true;
  if (await pathPresent(targetAbs)) {
    try {
      if ((await realpath(targetAbs)) === linkCanon) return true;
    } catch {
      /* broken link etc. */
    }
  }
  return false;
}

/**
 * Disk-backed classification for A→B install.
 * - Symlink to **this skill's** collection root → link B to that collection skill.
 * - Real directory → link B to A (unless it *is* the collection skill tree).
 * - Other symlinks / missing / non-dir / wrong collection identity → null.
 */
export async function resolveCrossAgentInstallPlan(
  skill: Skill
): Promise<CrossAgentInstallPlan | null> {
  const path = resolve(skill.path);
  if (!(await pathPresent(path))) return null;
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    return null;
  }

  const expectedCollection = join(collectionPaths().skills, skill.name);
  let expectedCollectionReal: string | undefined;
  try {
    expectedCollectionReal = await realpath(expectedCollection);
  } catch {
    expectedCollectionReal = undefined;
  }

  if (stats.isSymbolicLink()) {
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      return null;
    }
    // Must resolve to **this** skill's collection tree, not any path under skills/.
    if (!expectedCollectionReal || real !== expectedCollectionReal) return null;
    try {
      if (!(await lstat(real)).isDirectory()) return null;
      const disk = await readSkill(real);
      if (disk.name !== skill.name) return null;
    } catch {
      return null;
    }
    return { skill, linkTarget: expectedCollectionReal, registerUsage: true };
  }

  if (stats.isDirectory()) {
    let linkTarget = path;
    try {
      linkTarget = await realpath(path);
    } catch {
      /* keep resolved path */
    }
    // Real dir that *is* the collection skill (unusual) → still collection install.
    if (expectedCollectionReal && linkTarget === expectedCollectionReal) {
      return { skill, linkTarget: expectedCollectionReal, registerUsage: true };
    }
    // Refuse local install of a path nested inside the collection skills tree.
    try {
      const skillsRoot = await realpath(collectionPaths().skills);
      if (linkTarget === skillsRoot || linkTarget.startsWith(`${skillsRoot}${sep}`)) {
        return null;
      }
    } catch {
      /* no collection skills dir */
    }
    return { skill, linkTarget, registerUsage: false };
  }
  return null;
}
