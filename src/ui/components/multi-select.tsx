import { Text, usePanelColors, useStdout } from '../tui/index.js';
import { useInput } from './use-input.js';
import { useMemo, useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import {
  resolveOptionValues,
  toListOptions,
  toggleSelection,
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
  const panel = usePanelColors();
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
      setSelected((previous) => toggleSelection(previous, option.value));
      return;
    }
    if (isReturn(input, key.return) && selected.size) {
      onSubmit(options.filter((option) => selected.has(option.value)).map((option) => option.value));
    }
  });
  const visible = options.slice(from, from + count);
  return (
    <box flexDirection="column">
      {visible.map((option, index) => {
        const isFocused = from + index === focus;
        const isSelected = selected.has(option.value);
        return (
          <box flexDirection="row"
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
                    : panel.muted
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
                  : { color: panel.body, bold: isSelected })}
            >
              {option.label}
            </Text>
          </box>
        );
      })}
    </box>
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
  const panel = usePanelColors();
  const listOptions = useMemo(() => toListOptions(options), [options]);
  const defaultValue = options.flatMap((option, index) =>
    defaultValues.includes(option.value) ? [String(index)] : []
  );
  return (
    <box flexDirection="column">
      {label && (
        <Text bold color={panel.body}>
          {label}
        </Text>
      )}
      <OptionMultiSelect
        defaultValue={defaultValue}
        visibleCount={visibleOptionCount(stdout.rows ?? 24, label)}
        options={listOptions}
        onSubmit={(values) => onSubmit(resolveOptionValues(options, values))}
        {...(onCancel ? { onCancel } : {})}
      />
    </box>
  );
}
