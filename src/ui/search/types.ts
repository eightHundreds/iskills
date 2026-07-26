import type { CollectionMatch, RemoteSkill } from '../../domain/types.js';

/** Search screen protocol (type-only). */

export type RemoteSkillSearch = (
  query: string,
  signal: AbortSignal
) => Promise<RemoteSkill[]>;

export interface SearchViewInput {
  initialQuery: string;
  /** Undefined when the collection holds no Skill of that name. */
  matchCollection: (skill: RemoteSkill) => CollectionMatch | undefined;
  search: RemoteSkillSearch;
}
