import { Text } from '../tui/index.js';
import type { ReactNode } from 'react';
import { Clickable } from '../components/mouse/clickable.js';
import { termcnColors } from '../components/termcn.js';
import { textWidth } from '../components/terminal-layout.js';
import {
  DETAIL_ACTION_CHIP_GAP,
  type DetailActionChip,
} from './detail-actions.js';
import type { DetailActionId } from './types.js';

/** Click-only action chips (copy path, unbind source). Hover covers label text only. */
export function DetailActionChipRow({
  chips,
  onChip,
}: {
  chips: readonly DetailActionChip[];
  onChip: (chip: DetailActionId) => void;
}): ReactNode {
  return (
    <box flexDirection="row">
      {chips.map((chip, index) => {
        const width = Math.max(1, textWidth(chip.text));
        return (
          <box key={chip.id} flexDirection="row" flexShrink={0}>
            {index > 0 ? <Text>{' '.repeat(DETAIL_ACTION_CHIP_GAP)}</Text> : null}
            <box width={width} flexShrink={0}>
              <Clickable onClick={() => onChip(chip.id)}>
                <Text color={termcnColors.primary} bold>
                  {chip.text}
                </Text>
              </Clickable>
            </box>
          </box>
        );
      })}
    </box>
  );
}
