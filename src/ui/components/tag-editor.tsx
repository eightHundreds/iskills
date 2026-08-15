import { Text, usePanelColors, useStdout } from '../tui/index.js';
import { useInput } from './use-input.js';
import { useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { TextInput } from './text-input.js';
import { isReturn } from './text.js';
import { t } from '../../i18n/index.js';

export function TagEditor({
  tags,
  initialValues,
  onSubmit,
  onCancel,
}: {
  tags: string[];
  initialValues: string[];
  onSubmit: (tags: string[]) => void;
  onCancel?: () => void;
}): ReactNode {
  const { stdout } = useStdout();
  const panel = usePanelColors();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialValues));
  const [focus, setFocus] = useState<'list' | 'input'>(tags.length ? 'list' : 'input');
  const [cursor, setCursor] = useState(0);
  // Compact list for modal overlay: leave room for title, input, help, shell footer.
  const height = Math.max(3, Math.min(8, (stdout.rows ?? 24) - 16));
  const offset = Math.max(0, Math.min(cursor - Math.floor(height / 2), tags.length - height));
  const visible = tags.slice(offset, offset + height);
  const save = (input: string): void => onSubmit([
    ...new Set([
      ...selected,
      ...input.split(',').map((tag) => tag.trim()).filter(Boolean),
    ]),
  ]);

  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.tab) {
      return setFocus((value) => tags.length && value === 'input' ? 'list' : 'input');
    }
    if (focus !== 'list') return;
    if (key.upArrow) return setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) {
      return setCursor((value) => Math.min(Math.max(0, tags.length - 1), value + 1));
    }
    if (input === ' ') {
      const tag = tags[cursor];
      if (!tag) return;
      return setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      });
    }
    if (isReturn(input, key.return)) save('');
  });

  return (
    <box flexDirection="column">
      <Text bold color={panel.body}>
        {t('ui.selectedCount', { count: selected.size })}
      </Text>
      <Text bold color={panel.body}>
        {t('ui.existingTags')}
      </Text>
      <box border
        flexDirection="column"
        borderStyle="rounded"
        borderColor={termcnColors.border}
        backgroundColor={panel.surface}
        paddingX={1}
      >
        {visible.length ? visible.map((tag, index) => {
          const active = offset + index === cursor;
          return (
            <Text
              key={tag}
              color={
                active && focus === 'list'
                  ? termcnColors.primary
                  : panel.body
              }
              backgroundColor={panel.surface}
            >
              {`${active ? '›' : ' '} ${selected.has(tag) ? '●' : '○'} ${tag}`}
            </Text>
          );
        }) : (
          <Text color={panel.muted} backgroundColor={panel.surface}>
            {t('ui.noExistingTags')}
          </Text>
        )}
      </box>
      <TextInput
        label={t('comp.newTagsComma')}
        isActive={focus === 'input'}
        onSubmit={save}
        {...(onCancel ? { onCancel } : {})}
      />
    </box>
  );
}
