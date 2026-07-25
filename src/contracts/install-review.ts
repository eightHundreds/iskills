/** Install / add destination review DTOs — owned by contracts, not UI. */

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
