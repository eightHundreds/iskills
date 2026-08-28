import { relative, resolve, sep } from 'node:path';
import { DomainError } from './errors.js';
import type { Skill } from './types.js';

export function posixRelativeFromRoot(root: string, skillPath: string): string | undefined {
  const relativePath = relative(resolve(root), resolve(skillPath)).split(sep).join('/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) return undefined;
  return relativePath;
}

export function annotateSourcePaths(skills: Skill[], root: string): Skill[] {
  return skills.map((skill) => {
    const sourcePath = posixRelativeFromRoot(root, skill.path) ?? skill.sourcePath;
    return sourcePath ? { ...skill, sourcePath } : skill;
  });
}

/** Lowercase frontmatter names that appear more than once. */
export function duplicatedSkillNames(skills: Skill[]): Set<string> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
  );
}

export function assertUniqueSkillNames(skills: Skill[]): void {
  const seen = new Map<string, string>();
  const duplicated: string[] = [];
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      if (!duplicated.includes(skill.name)) duplicated.push(skill.name);
      continue;
    }
    seen.set(key, skill.name);
  }
  if (duplicated.length) {
    throw new DomainError('cmd.skillDuplicateInSource', {
      name: duplicated.join(', '),
    });
  }
}
