import type { Skill } from './types.js';

export function matchesSkill(skill: Skill, query: string): boolean {
  if (!query) return true;
  const haystack = [
    skill.name,
    skill.description,
    skill.note,
    ...(skill.tags || []),
    skill.source?.url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
