/**
 * Install / add destination review protocol (type-only).
 * Commands may `import type` without depending on Ink implementations.
 */

import type { AgentInstallTarget } from '../../domain/core.js';

/** Alias of domain install row so command/UI share one shape. */
export type InstallReviewTarget = AgentInstallTarget;

export interface InstallReviewResult {
  confirmed: boolean;
  destination: 'project' | 'global';
  copy: boolean;
  agents: string[];
}
