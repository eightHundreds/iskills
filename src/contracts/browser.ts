import type { CollectedSkill, Skill } from '../domain/types.js';

export type BrowserTab = 'project' | 'collection' | 'global';
export type BrowserFocus = 'tabs' | 'agents' | 'list';

export interface BrowserState {
  tab: BrowserTab;
  query: string;
  cursor: number;
  selected: string[];
  agent: string;
  focus: BrowserFocus;
}

export interface SkillGroup {
  agent: string;
  skills: Skill[];
}

export type BrowserResult =
  | { type: 'quit' }
  | (BrowserState & (
      | { type: 'sync' }
      | { type: 'tags'; skills: Skill[] }
      | { type: 'update'; skills: CollectedSkill[] }
      | { type: 'add'; skills: CollectedSkill[] }
      | { type: 'removeCollection'; skills: CollectedSkill[] }
      | { type: 'removeLocations'; skills: Skill[] }
      | { type: 'materialize'; skills: Skill[] }
      | { type: 'import'; skills: Skill[] }
      | { type: 'open'; skill: Skill; collection: boolean }
    ));

export interface BrowserUpdateCheck {
  updates: Set<string>;
  failed: number;
}

export type BrowserUpdateChecker = (
  collection: CollectedSkill[]
) => Promise<BrowserUpdateCheck>;

export interface BrowserViewInput {
  projectGroups: SkillGroup[];
  collection: CollectedSkill[];
  globalGroups: SkillGroup[];
  state: BrowserState;
  canSync: boolean;
  status: string;
  transientStatus: boolean;
  checkUpdates: BrowserUpdateChecker;
  updatingSkillName?: string | undefined;
  updatingProgress?: { current: number; total: number } | undefined;
  workingAction?: '更新' | '转换';
}
