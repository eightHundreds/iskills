/**
 * Product TextInput — thin product API over OpenTUI `<input>`.
 * Prefer native input editing; keep label / variant / Esc cancel for callers.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Text, usePanelColors, useStdout } from '../tui/index.js';
import { termcnColors } from './colors.js';
import { useInput } from './use-input.js';

export function TextInput({
  label,
  initialValue = '',
  isActive = true,
  onCancel,
  onChange,
  onSubmit,
  width = 72,
  /** box = form field (label above bordered value); inline = single-row label+value (footer filter). */
  variant = 'box',
}: {
  label: string;
  initialValue?: string;
  isActive?: boolean;
  onCancel?: () => void;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  width?: number;
  variant?: 'box' | 'inline';
}): ReactNode {
  const [value, setValue] = useState(initialValue);
  const { stdout } = useStdout();
  const panel = usePanelColors();
  const resolvedWidth = Math.min(width, Math.max(20, (stdout.columns ?? 80) - 2));

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleInput = (next: string): void => {
    setValue(next);
    onChange?.(next);
  };

  // Esc is product-level cancel; OpenTUI input does not own it.
  useInput(
    (_input, key) => {
      if (key.escape) onCancel?.();
    },
    { isActive }
  );

  const field = (inputWidth: number | `${number}%` | undefined) => (
    <input
      value={value}
      focused={isActive}
      onInput={handleInput}
      onSubmit={(submitted) => {
        const text = typeof submitted === 'string' ? submitted : value;
        onSubmit(text);
      }}
      placeholder=""
      cursorColor={termcnColors.primary}
      textColor={panel.body}
      backgroundColor={panel.surface}
      focusedBackgroundColor={panel.surface}
      focusedTextColor={panel.body}
      {...(inputWidth !== undefined ? { width: inputWidth } : {})}
    />
  );

  if (variant === 'inline') {
    // Explicit width so the native input paints the full value under OpenTUI layout.
    // Footer filter: keep transparent field bg so shell canvas shows through.
    const inputCols = Math.max(8, (stdout.columns ?? 80) - Math.min(24, label.length * 2));
    return (
      <box width="100%" flexDirection="row" height={1}>
        <Text bold color={panel.body}>
          {label}
        </Text>
        <input
          value={value}
          focused={isActive}
          onInput={handleInput}
          onSubmit={(submitted) => {
            const text = typeof submitted === 'string' ? submitted : value;
            onSubmit(text);
          }}
          placeholder=""
          cursorColor={termcnColors.primary}
          textColor={panel.body}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          focusedTextColor={panel.body}
          width={inputCols}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <Text bold color={panel.body}>
        {label}
      </Text>
      <box border
        borderStyle="rounded"
        borderColor={isActive ? termcnColors.primary : termcnColors.border}
        backgroundColor={panel.surface}
        paddingX={1}
        width={resolvedWidth}
        height={3}
        flexDirection="column"
      >
        {field(Math.max(4, resolvedWidth - 4))}
      </box>
    </box>
  );
}
