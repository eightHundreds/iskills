/**
 * Product Select — OpenTUI `<select>` with iskills Option&lt;T&gt; contract.
 * Esc cancel + optional 1–9 shortcuts stay product-side.
 */
import { useMemo, type ReactNode } from 'react';
import { Text, usePanelColors, useStdout } from '../tui/index.js';
import { termcnColors } from './colors.js';
import {
  resolveOptionValue,
  visibleOptionCount,
  type Option,
} from './options.js';
import { useInput } from './use-input.js';

export function Select<T>({
  label,
  options,
  onSubmit,
  onCancel,
  numbered = false,
}: {
  label?: string;
  options: Option<T>[];
  onSubmit: (value: T) => void;
  onCancel?: () => void;
  numbered?: boolean;
}): ReactNode {
  const { stdout } = useStdout();
  const panel = usePanelColors();
  const rows = stdout.rows ?? 24;
  const visible = visibleOptionCount(rows, label);
  const height = Math.max(3, Math.min(visible, Math.max(1, options.length)));

  const selectOptions = useMemo(
    () =>
      options.map((option, index) => ({
        name: numbered ? `${index + 1}. ${option.label}` : option.label,
        description: option.hint ?? '',
        value: String(index),
      })),
    [numbered, options]
  );

  const showDescription = options.some((option) => Boolean(option.hint));

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (!numbered || !/^[1-9]$/.test(input)) return;
    const option = options[Number(input) - 1];
    if (option) onSubmit(option.value);
  });

  return (
    <box flexDirection="column">
      {label ? (
        <Text bold color={panel.body}>
          {label}
        </Text>
      ) : null}
      <box height={height} flexDirection="column" width="100%">
        <select
          focused
          options={selectOptions}
          showDescription={showDescription}
          showScrollIndicator={options.length > height}
          showSelectionIndicator
          selectedTextColor={termcnColors.selectionFg}
          selectedBackgroundColor={termcnColors.selectionBg}
          // Theme-aware idle text (not forced white / fixed mid-gray only).
          textColor={panel.body}
          focusedTextColor={panel.body}
          descriptionColor={panel.muted}
          selectedDescriptionColor={termcnColors.selectionFg}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          height={height}
          flexGrow={1}
          onSelect={(_index, option) => {
            if (!option) return;
            const resolved = resolveOptionValue(options, String(option.value));
            if (resolved !== undefined) onSubmit(resolved);
          }}
        />
      </box>
    </box>
  );
}
