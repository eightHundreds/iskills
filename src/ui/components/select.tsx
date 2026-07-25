import { Box, Text, useInput, useStdout } from 'ink';
import { useMemo, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { isReturn } from './text.js';
import {
  resolveOptionValue,
  toInkOptions,
  useScrollWindow,
  visibleOptionCount,
  type InternalOption,
  type Option,
} from './options.js';

function OptionSelect({
  options,
  visibleCount,
  onChange,
  onCancel,
}: {
  options: InternalOption[];
  visibleCount: number;
  onChange: (value: string) => void;
  onCancel?: () => void;
}): ReactNode {
  const { count, focus, from, focusNext, focusPrevious } = useScrollWindow(
    options.length,
    visibleCount
  );
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.downArrow) return focusNext();
    if (key.upArrow) return focusPrevious();
    if (isReturn(input, key.return)) {
      const option = options[focus];
      if (option) onChange(option.value);
    }
  });
  const visible = options.slice(from, from + count);
  return (
    <Box flexDirection="column">
      {visible.map((option, index) => {
        const isFocused = from + index === focus;
        return (
          <Box key={option.value} gap={1} paddingLeft={isFocused ? 0 : 2}>
            {isFocused && <Text color={termcnColors.primary}>❯</Text>}
            <Text {...(isFocused ? { color: termcnColors.primary } : {})}>{option.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

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
  const inkOptions = useMemo(() => toInkOptions(options, numbered), [numbered, options]);
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (!numbered || !/^[1-9]$/.test(input)) return;
    const option = options[Number(input) - 1];
    if (option) onSubmit(option.value);
  });
  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <OptionSelect
        visibleCount={visibleOptionCount(stdout.rows ?? 24, label)}
        options={inkOptions}
        onChange={(value) => {
          const resolved = resolveOptionValue(options, value);
          if (resolved !== undefined) onSubmit(resolved);
        }}
        {...(onCancel ? { onCancel } : {})}
      />
      <Text color={termcnColors.muted}>
        {numbered ? `1–${Math.min(options.length, 9)} 快选 · ` : ''}↑/↓ 选择 · Enter 确认 · Esc 取消
      </Text>
    </Box>
  );
}
