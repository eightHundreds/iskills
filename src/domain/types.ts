export type LinkKind = 'origin' | 'dependent' | 'usage';
export type RefType = 'branch' | 'tag' | 'commit';

export interface SkillSource {
  type: string;
  id?: string;
  url?: string;
  ref?: string;
  refType?: RefType;
  path?: string;
  commit?: string;
  importedFromLock?: boolean;
}

export interface GitSource extends SkillSource {
  type: 'git';
  url: string;
  refType: RefType;
  path: string;
}

/**
 * How a candidate Skill relates to a collected Skill of the same name.
 * `unverified-source` is not a weaker conflict: it means provenance cannot
 * prove sameness either way, so it must not be presented as a known difference.
 */
export type CollectionMatch = 'same-source' | 'conflicting-source' | 'unverified-source';

export interface Skill {
  name: string;
  description: string;
  path: string;
  isReference?: boolean;
  tags?: string[];
  note?: string;
  source?: SkillSource;
  fromCollection?: boolean;
  collectionStatus?: CollectionMatch;
}

export interface RemoteSkill {
  resultId: string;
  name: string;
  source: string;
  installs: number;
}

export interface SkillMetadata {
  name: string;
  description: string;
  tags: string[];
  note: string;
  source: SkillSource;
}

export interface CollectedSkill extends SkillMetadata {
  path: string;
}

export interface SkillLink {
  skill: string;
  path: string;
  kind: LinkKind;
}

export interface SourceConflict {
  type: 'source';
  skill: string;
  path: string;
  source: GitSource;
  baseline?: string;
}

export interface CollectionConflict {
  type: 'collection';
  message: string;
  remoteHead?: string;
}

export type Conflict = SourceConflict | CollectionConflict;

export interface CollectionState {
  links: SkillLink[];
  conflicts: Conflict[];
}

export interface CollectionPaths {
  root: string;
  skills: string;
  metadata: string;
  local: string;
  state: string;
  collectionConflict: string;
}

export interface AgentConfig {
  project?: string;
  global: (home: string) => string;
  /** Explicit tool root for presence; defaults to dirname(global(home)). */
  root?: (home: string) => string;
}

export interface LockEntry {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  ref?: string;
  skillPath?: string;
}

export interface LockFile {
  skills?: Record<string, LockEntry>;
}

export interface ParsedGitSource {
  url: string;
  ref?: string;
}

export interface GitImportContext {
  temporary: string;
  repository: string;
  source: Omit<GitSource, 'path'>;
}

export interface Choice<T extends string = string> {
  label: string;
  value: T;
}

export type UpdateStatus =
  | 'unmanaged'
  | 'pinned'
  | 'conflict'
  | 'unchanged'
  | 'delete-skipped'
  | 'deleted'
  | 'updated';
