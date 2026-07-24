import type {
  BrowserAppLifecycle,
  BrowserConfirmRequest,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
} from './browser-app.js';
import type { CollectedSkill } from '../domain/types.js';
import type { InstallReviewResult, InstallReviewTarget } from '../ui/reviews.js';

export interface BrowserPromptBridge {
  editInput: (label: string, initialValue: string) => Promise<string | undefined>;
  editTags: (tags: string[], initialValues: string[], title: string) => Promise<string[] | undefined>;
  chooseOne: (
    options: { label: string; value: string }[],
    title: string
  ) => Promise<string | undefined>;
  reviewInstall: (
    skills: CollectedSkill[],
    targets: InstallReviewTarget[],
    defaultProjectAgents: string[],
    defaultGlobalAgents: string[]
  ) => Promise<InstallReviewResult | undefined>;
}

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

export type { BrowserConfirmRequest, BrowserDataSnapshot, BrowserNavigationSnapshot, InstallReviewTarget };
