import type { CollectedSkill } from '../../domain/types.js';
import type { InstallReviewResult, InstallReviewTarget } from '../install/types.js';

/**
 * In-tree host interactive surface (Browser `host.prompts` / layer).
 *
 * Not the shape of `ui/prompts/index` CLI adapters — those are a separate
 * module export list (confirm / choose* / reviewImport / …).
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
}
