import type { CollectedSkill, Skill } from '../domain/types.js';
import type { InstallReviewResult, InstallReviewTarget } from './install-review.js';

/**
 * Shared prompt capability interface for CLI session adapters and
 * in-tree browser overlay adapters. Two adapters justify this seam.
 */
export interface PromptPort {
  editInput: (label: string, initialValue: string) => Promise<string | undefined>;
  editTags: (
    tags: string[],
    initialValues: string[],
    title: string
  ) => Promise<string[] | undefined>;
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
  confirm?: (message: string) => Promise<boolean>;
  multiSelect?: (
    items: { label: string; value: string; detail?: string }[],
    title: string
  ) => Promise<string[] | undefined>;
  /** Import multi-select over skills — CLI path. */
  skillMultiSelect?: (
    skills: Skill[],
    title: string
  ) => Promise<Skill[] | undefined>;
}
