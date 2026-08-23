/**
 * Install / add UI package: destination review screen.
 * Protocol types in `types.ts`. Hosts mount via static Layer/Modal (or in-tree hooks).
 */
export { InstallReview } from './review.js';
export { DestinationReview } from './destination-review.js';
export type {
  DestinationReviewResult,
  DestinationReviewTarget,
  InstallReviewResult,
  InstallReviewTarget,
} from './types.js';
