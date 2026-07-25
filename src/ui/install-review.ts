/** Install / add destination review DTOs (UI protocol). */

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
