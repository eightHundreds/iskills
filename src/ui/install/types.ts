/**
 * Install / add destination review protocol (type-only).
 * Commands may `import type` without depending on Ink implementations.
 */

export interface InstallReviewTarget {
  value: string;
  projectLabel?: string;
  globalLabel?: string;
}

export interface InstallReviewResult {
  confirmed: boolean;
  destination: 'project' | 'global';
  copy: boolean;
  agents: string[];
}
