/**
 * Import review protocol (type-only).
 * Commands may `import type` without loading the TUI implementation.
 */
import type { Skill } from '../../domain/types.js';

export interface ImportReviewItem<T extends Skill = Skill> {
  skill: T;
  detail: string;
}

export interface ImportReviewResult {
  confirmed: boolean;
  tags: string[];
}
