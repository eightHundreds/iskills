import type {
  BrowserAppLifecycle,
  BrowserConfirmRequest,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
} from './browser-app.js';
import type { PromptPort } from './prompt-port.js';

/** In-app / host prompt surface — subset of the shared PromptPort. */
export type BrowserPromptBridge = Pick<
  PromptPort,
  'editInput' | 'editTags' | 'chooseOne' | 'reviewInstall'
>;

export interface BrowserActionHost {
  lifecycle: BrowserAppLifecycle;
  requestConfirm: (request: BrowserConfirmRequest) => Promise<boolean>;
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
  prompts: BrowserPromptBridge;
  setAbortController: (controller: AbortController | null) => void;
}

export interface DetailEditorContext {
  skill: import('../domain/types.js').Skill;
  metadata: import('../domain/types.js').SkillMetadata;
}

export type {
  BrowserConfirmRequest,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
} from './browser-app.js';
export type { InstallReviewResult, InstallReviewTarget } from './install-review.js';
