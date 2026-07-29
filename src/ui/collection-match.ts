import type { CollectionMatch } from '../domain/types.js';
// Imports the palette directly rather than the termcn barrel so the command
// layer can reuse these labels without loading the TUI.
import { termcnColors } from './components/colors.js';

export const collectionMatchLabels: Record<CollectionMatch, string> = {
  'same-source': '已收藏（同一来源）',
  'conflicting-source': '同名冲突（来源不同）',
  'unverified-source': '同名技能（来源未验证）',
};

/** Symbols carry the state on their own; color only reinforces it (NO_COLOR). */
export const collectionMatchMarkers: Record<CollectionMatch, { symbol: string; color: string }> = {
  'same-source': { symbol: '★', color: termcnColors.muted },
  'conflicting-source': { symbol: '⚠', color: termcnColors.error },
  'unverified-source': { symbol: '☆', color: termcnColors.muted },
};
