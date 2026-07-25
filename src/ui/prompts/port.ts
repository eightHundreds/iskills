import type { CollectedSkill, Skill } from '../../domain/types.js';
import type { InstallReviewResult, InstallReviewTarget } from '../install/types.js';

/**
 * Shared interactive I/O capability surface for CLI adapters and in-tree hosts.
 * Type-only seam — commands may `import type` this module.
 *
 * `reviewInstall` refers to the install feature contract, not a presentation mode.
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
