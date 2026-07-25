import type { BrowserState, BrowserTab, SkillGroup } from './browser.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../domain/types.js';
import type { InstallReviewResult, InstallReviewTarget } from './install-review.js';

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

export interface BrowserConfirmRequest {
  title: string;
  message: string;
  details?: string[];
}

export interface BrowserAppLifecycle {
  suspendForSubprocess: (task: () => Promise<void>) => Promise<void>;
}

export interface BrowserAppLaunchOptions {
  initialQuery?: string;
  initialTab?: BrowserTab;
}

export type PromptTextRequest = {
  type: 'text';
  label: string;
  initialValue?: string;
  resolve: (value: string | undefined) => void;
};

export type PromptTagsRequest = {
  type: 'tags';
  title: string;
  tags: string[];
  initialValues: string[];
  resolve: (value: string[] | undefined) => void;
};

export type PromptChooseRequest = {
  type: 'choose';
  title: string;
  options: { label: string; value: string }[];
  resolve: (value: string | undefined) => void;
};

export type PromptInstallReviewRequest = {
  type: 'install-review';
  skills: CollectedSkill[];
  targets: InstallReviewTarget[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
  resolve: (value: InstallReviewResult | undefined) => void;
};

export type InAppPromptRequest =
  | PromptTextRequest
  | PromptTagsRequest
  | PromptChooseRequest
  | PromptInstallReviewRequest;

/** Full navigation snapshot including multi-select paths (host / actions). */
export interface BrowserNavigationSnapshot extends BrowserState {}
