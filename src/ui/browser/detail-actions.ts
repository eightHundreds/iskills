import { isBoundGitSource } from '../../domain/core.js';
import type { Skill } from '../../domain/types.js';
import { t } from '../../i18n/index.js';
import { textWidth } from '../components/terminal-layout.js';
import type { DetailActionId } from './types.js';

export interface DetailActionChip {
  text: string;
  id: DetailActionId;
}

/** Space between peek / fullscreen action chips. */
export const DETAIL_ACTION_CHIP_GAP = 2;

export function peekActionChips(
  collection: boolean,
  source?: Skill['source']
): DetailActionChip[] {
  const chips: DetailActionChip[] = [
    { text: t('browser.copyPath'), id: 'copyPath' },
  ];
  if (collection && isBoundGitSource(source)) {
    chips.push({ text: t('browser.unbindSource'), id: 'unbindSource' });
  }
  return chips;
}

export function detailActionChipsWidth(chips: readonly DetailActionChip[]): number {
  if (!chips.length) return 0;
  let width = 0;
  for (let index = 0; index < chips.length; index += 1) {
    if (index > 0) width += DETAIL_ACTION_CHIP_GAP;
    width += textWidth(chips[index]!.text);
  }
  return width;
}
