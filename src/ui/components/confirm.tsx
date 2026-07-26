import { Text } from 'ink';
import { useInput } from './use-input.js';
import type { ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { isReturn } from './text.js';

function ConfirmInput({
  defaultChoice,
  onConfirm,
  onCancel,
  isActive = true,
}: {
  defaultChoice: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
  isActive?: boolean;
}): ReactNode {
  useInput(
    (input, key) => {
      const choice = input.trim().toLowerCase();
      if (choice === 'y') return onConfirm();
      if (choice === 'n') return onCancel();
      if (isReturn(input, key.return)) {
        return defaultChoice === 'confirm' ? onConfirm() : onCancel();
      }
    },
    { isActive }
  );
  return <Text dimColor={!isActive}>{defaultChoice === 'confirm' ? 'Y/n' : 'y/N'}</Text>;
}

export function Confirm({
  message,
  defaultValue,
  onSubmit,
}: {
  message: string;
  defaultValue: boolean;
  onSubmit: (value: boolean) => void;
}): ReactNode {
  return (
    <Text>
      <Text color={termcnColors.primary}>? </Text>
      {message} (
      <ConfirmInput
        defaultChoice={defaultValue ? 'confirm' : 'cancel'}
        onConfirm={() => onSubmit(true)}
        onCancel={() => onSubmit(false)}
      />
      )
    </Text>
  );
}
