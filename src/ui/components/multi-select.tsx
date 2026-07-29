import { Box, Text, useStdout } from '../tui/index.js';
import { useInput } from './use-input.js';
import { useMemo, useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import {
  resolveOptionValues,
  toInkOptions,
  useScrollWindow,
  visibleOptionCount,
  type InternalOption,
  type Option,
} from './options.js';
import { isReturn } from './text.js';

function OptionMultiSelect({
  options,
  visibleCount,
  defaultValue = [],
  onSubmit,
  onCancel,
}: {
  options: InternalOption[];
  visibleCount: number;
  defaultValue?: string[];
  onSubmit: (values: string[]) => void;
  onCancel?: () => void;
}): ReactNode {
  const { count, focus, from, focusNext, focusPrevious } = useScrollWindow(
    options.length,
    visibleCount
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultValue));
  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.downArrow) return focusNext();
    if (key.upArrow) return focusPrevious();
    if (input === ' ') {
      const option = options[focus];
      if (!option) return;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
      return;
    }
    if (isReturn(input, key.return) && selected.size) {
      onSubmit(options.filter((option) => selected.has(option.value)).map((option) => option.value));
    }
  });
  const visible = options.slice(from, from + count);
  return (
    <Box flexDirection="column">
      {visible.map((option, index) => {
        const isFocused = from + index === focus;
        const isSelected = selected.has(option.value);
        return (
          <Box
            key={option.value}
            gap={1}
            paddingLeft={isFocused ? 0 : 2}
            {...(isFocused
              ? { backgroundColor: termcnColors.selectionBg }
              : {})}
          >
            {isFocused && (
              <Text color={termcnColors.selectionFg} backgroundColor={termcnColors.selectionBg}>
                ❯
              </Text>
            )}
            <Text
              color={
                isFocused
                  ? termcnColors.selectionFg
                  : isSelected
                    ? termcnColors.primary
                    : termcnColors.muted
              }
              {...(isFocused ? { backgroundColor: termcnColors.selectionBg } : {})}
            >
              {isSelected ? '●' : '○'}
            </Text>
            <Text
              {...(isFocused
                ? {
                    color: termcnColors.selectionFg,
                    backgroundColor: termcnColors.selectionBg,
                    bold: true,
                  }
                : isSelected
                  ? { color: termcnColors.primary, bold: true }
                  : { bold: isSelected })}
            >
              {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function MultiSelect<T>({
  label,
  options,
  defaultValues = [],
  onSubmit,
  onCancel,
}: {
  label?: string;
  options: Option<T>[];
  defaultValues?: T[];
  onSubmit: (values: T[]) => void;
  onCancel?: () => void;
}): ReactNode {
  const { stdout } = useStdout();
  const inkOptions = useMemo(() => toInkOptions(options), [options]);
  const defaultValue = options.flatMap((option, index) =>
    defaultValues.includes(option.value) ? [String(index)] : []
  );
  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <OptionMultiSelect
        defaultValue={defaultValue}
        visibleCount={visibleOptionCount(stdout.rows ?? 24, label)}
        options={inkOptions}
        onSubmit={(values) => onSubmit(resolveOptionValues(options, values))}
        {...(onCancel ? { onCancel } : {})}
      />
      <Text color={termcnColors.muted}>Space/空格 勾选 · Enter 确认 · Esc 取消</Text>
    </Box>
  );
}
