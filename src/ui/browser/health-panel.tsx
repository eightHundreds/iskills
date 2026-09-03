import { Text, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import type { ReactNode } from 'react';
import { t } from '../../i18n/index.js';
import { termcnColors } from '../components/termcn.js';
import { Clickable } from '../components/mouse/clickable.js';
import { ModalPanel } from '../components/modal-panel.js';
import { isReturn } from '../components/text.js';
import type { BrowserHealthAlert } from './health.js';

export function HealthAlertsPanel({
  alerts,
  onCopy,
  onClose,
}: {
  alerts: BrowserHealthAlert[];
  onCopy: () => void;
  onClose: () => void;
}): ReactNode {
  const copyLabel = t('browser.copyForAgent');
  const { stdout } = useStdout();
  const width = Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6));
  useInput((input, key) => {
    if (input === 'c' || input === 'C') {
      onCopy();
      return;
    }
    if (key.escape || isReturn(input, key.return) || input === 'q' || input === ' ') {
      onClose();
    }
  });

  return (
    <ModalPanel title={` ${t('browser.healthTitle')} `} width={width}>
      <box flexDirection="column" gap={1}>
        {alerts.map((alert) => (
          <box key={alert.id} flexDirection="column">
            <Text>{alert.title}</Text>
            <Text color={termcnColors.muted}>{`  ${alert.detail}`}</Text>
          </box>
        ))}
        <box flexDirection="row" justifyContent="center">
          <Clickable onClick={onCopy}>
            <Text color={termcnColors.primary} bold>
              {copyLabel}
            </Text>
          </Clickable>
        </box>
      </box>
    </ModalPanel>
  );
}
