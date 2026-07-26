import { Box, Text, useStdout } from 'ink';
import { useRef, useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { graphemes } from './text.js';
import { useInput } from './use-input.js';

export function TextInput({
  label,
  initialValue = '',
  isActive = true,
  onCancel,
  onChange,
  onSubmit,
  width = 72,
}: {
  label: string;
  initialValue?: string;
  isActive?: boolean;
  onCancel?: () => void;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  width?: number;
}): ReactNode {
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const [cursor, setCursor] = useState(graphemes(initialValue).length);
  const cursorRef = useRef(graphemes(initialValue).length);
  const { stdout } = useStdout();
  const resolvedWidth = Math.min(width, Math.max(20, (stdout.columns ?? 80) - 2));
  const update = (next: string): void => {
    valueRef.current = next;
    setValue(next);
    onChange?.(next);
  };
  const insert = (input: string): string => {
    const next = graphemes(valueRef.current);
    const inserted = graphemes(input);
    next.splice(cursorRef.current, 0, ...inserted);
    cursorRef.current += inserted.length;
    setCursor(cursorRef.current);
    const nextValue = next.join('');
    update(nextValue);
    return nextValue;
  };
  useInput((input, key) => {
    const newline = input.search(/[\r\n]/);
    if (key.return || newline >= 0) {
      const typed = newline >= 0 ? input.slice(0, newline) : input;
      return onSubmit(typed && !key.ctrl && !key.meta ? insert(typed) : valueRef.current);
    }
    if (key.escape) return onCancel?.();
    if (key.leftArrow) {
      cursorRef.current = Math.max(0, cursorRef.current - 1);
      return setCursor(cursorRef.current);
    }
    if (key.rightArrow) {
      cursorRef.current = Math.min(graphemes(valueRef.current).length, cursorRef.current + 1);
      return setCursor(cursorRef.current);
    }
    if (key.home) {
      cursorRef.current = 0;
      return setCursor(0);
    }
    if (key.end) {
      cursorRef.current = graphemes(valueRef.current).length;
      return setCursor(cursorRef.current);
    }
    // Ink 6 reports the usual terminal Backspace (DEL) as Delete too.
    if (key.backspace || key.delete) {
      if (!cursorRef.current) return;
      const next = graphemes(valueRef.current);
      next.splice(cursorRef.current - 1, 1);
      cursorRef.current--;
      setCursor(cursorRef.current);
      return update(next.join(''));
    }
    if (
      input &&
      input !== '\r' &&
      input !== '\n' &&
      !key.ctrl &&
      !key.meta &&
      !key.escape &&
      !key.tab &&
      !key.upArrow &&
      !key.downArrow
    ) {
      insert(input);
    }
  }, { isActive });
  const parts = graphemes(value);
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box
        borderStyle="round"
        borderColor={isActive ? termcnColors.primary : termcnColors.border}
        paddingX={1}
        width={resolvedWidth}
      >
        <Text>
          {isActive ? <>
            {parts.slice(0, cursor).join('')}
            <Text inverse>{parts[cursor] || ' '}</Text>
            {parts.slice(cursor + 1).join('')}
          </> : value || ' '}
        </Text>
      </Box>
    </Box>
  );
}
