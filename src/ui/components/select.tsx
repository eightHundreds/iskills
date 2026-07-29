/**
 * Product Select — OpenTUI `<select>` with iskills Option&lt;T&gt; contract.
 * Esc cancel + optional 1–9 shortcuts stay product-side.
 */
import { useMemo, type ReactNode } from 'react';
import { Box, Text, useStdout } from '../tui/index.js';
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
    <Box flexDirection="column">
      {label ? <Text bold>{label}</Text> : null}
      <Box height={height} flexDirection="column" width="100%">
        <select
          focused
          options={selectOptions}
          showDescription={showDescription}
          showScrollIndicator={options.length > height}
          showSelectionIndicator
          selectedTextColor={termcnColors.selectionFg}
          selectedBackgroundColor={termcnColors.selectionBg}
          // Avoid OpenTUI select default (often near-white text on dark chip) looking
          // wrong next to a light terminal; use brand selection for focus only and
          // mid-gray for idle rows so both light/dark canvases stay readable.
          textColor={termcnColors.muted}
          focusedTextColor={termcnColors.muted}
          descriptionColor={termcnColors.muted}
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
      </Box>
      <Text color={termcnColors.muted}>
        {numbered ? `1–${Math.min(options.length, 9)} 快选 · ` : ''}
        ↑/↓ 选择 · Enter 确认 · Esc 取消
      </Text>
    </Box>
  );
}
