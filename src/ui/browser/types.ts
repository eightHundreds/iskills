/**
 * Browser TUI protocol types (type-only leaf).
 * Commands may `import type` from here without depending on Ink implementations.
 */
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../../domain/types.js';

export type BrowserTab = 'project' | 'collection' | 'global';
export type BrowserFocus = 'tabs' | 'agents' | 'tags' | 'list';

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

/**
 * Intent-only results from the browser view.
 * Navigation/selection live in the app store — not re-serialized here.
 */
export type BrowserResult =
  | { type: 'quit' }
  | { type: 'sync' }
  | { type: 'tags'; skills: Skill[] }
  | { type: 'update'; skills: CollectedSkill[] }
  | { type: 'add'; skills: CollectedSkill[] }
  | { type: 'removeCollection'; skills: CollectedSkill[] }
  | { type: 'removeLocations'; skills: Skill[] }
  | { type: 'materialize'; skills: Skill[] }
  | { type: 'import'; skills: Skill[] }
  | {
      type: 'open';
      skill: Skill;
      collection: boolean;
      frameHeight: number;
      frameWidth: number;
    };

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
  canSync: boolean;
  status: string;
  transientStatus: boolean;
  checkUpdates: BrowserUpdateChecker;
  updatingSkillName?: string | undefined;
  updatingProgress?: { current: number; total: number } | undefined;
  workingAction?: '更新' | '转换';
}

export type BrowserAppPhase = 'browse' | 'detail';

export interface BrowserDataSnapshot {
  projectGroups: SkillGroup[];
  collection: CollectedSkill[];
  globalGroups: SkillGroup[];
  canSync: boolean;
}

export interface BrowserStatusSnapshot {
  text: string;
  transient: boolean;
}

export interface WorkingProgressSnapshot {
  skillName: string;
  current: number;
  total: number;
  workingAction: '更新' | '转换';
}

export interface DetailViewContext {
  skill: Skill;
  collection: boolean;
  frameHeight: number;
  frameWidth: number;
  metadata: SkillMetadata;
  links: SkillLink[];
}

export interface BrowserAppLifecycle {
  suspendForSubprocess: (task: () => Promise<void>) => Promise<void>;
}

export interface BrowserAppLaunchOptions {
  initialQuery?: string;
  initialTab?: BrowserTab;
}

/** Full navigation snapshot including multi-select paths (host / actions). */
export interface BrowserNavigationSnapshot extends BrowserState {}

/**
 * Browser action host: AppShell + data, not interactive UI.
 * Prompts use static {@link import('../overlay/static.js').Modal} / Layer / present helpers.
 */
export interface BrowserActionHost {
  lifecycle: BrowserAppLifecycle;
  setWorkingProgress: (
    progress: {
      skillName: string;
      current: number;
      total: number;
      workingAction: '更新' | '转换';
    } | null
  ) => void;
  setStatus: (text: string, transient: boolean) => void;
  reloadData: () => Promise<BrowserDataSnapshot>;
  getNavigation: () => BrowserNavigationSnapshot;
  setNavigation: (navigation: BrowserNavigationSnapshot) => void;
  setAbortController: (controller: AbortController | null) => void;
}

export interface DetailEditorContext {
  skill: Skill;
  metadata: SkillMetadata;
}
