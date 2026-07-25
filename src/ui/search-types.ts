import type { RemoteSkill } from '../domain/types.js';

/** Search screen protocol (type-only). */

export type RemoteSkillSearch = (
  query: string,
  signal: AbortSignal
) => Promise<RemoteSkill[]>;

export interface SearchViewInput {
  initialQuery: string;
  collectedNames: ReadonlySet<string>;
  search: RemoteSkillSearch;
}
