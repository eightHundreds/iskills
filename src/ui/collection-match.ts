import type { CollectionMatch } from '../domain/types.js';
import { t } from '../i18n/index.js';
// Imports the palette directly rather than the termcn barrel so the command
// layer can reuse these labels without loading the TUI.
import { termcnColors } from './components/colors.js';

export function collectionMatchLabels(): Record<CollectionMatch, string> {
  return {
    'same-source': t('match.sameSource'),
    'conflicting-source': t('match.conflictingSource'),
    'unverified-source': t('match.unverifiedSource'),
  };
}

/** Symbols carry the state on their own; color only reinforces it (NO_COLOR). */
export const collectionMatchMarkers: Record<CollectionMatch, { symbol: string; color: string }> = {
  'same-source': { symbol: '★', color: termcnColors.muted },
  'conflicting-source': { symbol: '⚠', color: termcnColors.error },
  'unverified-source': { symbol: '☆', color: termcnColors.muted },
};
