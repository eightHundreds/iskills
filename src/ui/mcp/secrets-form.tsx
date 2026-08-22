import { useState, type ReactNode } from 'react';
import { t } from '../../i18n/index.js';
import { Tabs, TextInput, type Tab } from '../components/termcn.js';
import { Layer } from '../overlay/static.js';
import { Text, usePanelColors } from '../tui/index.js';

export interface McpSecretFormResult {
  key: string;
  value: string;
}

export function promptMcpSecrets(
  headerDefault: string
): Promise<McpSecretFormResult | undefined> {
  return Layer.open<McpSecretFormResult | undefined>({
    footerItems: [
      { key: 'Enter', label: t('common.confirm') },
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <McpSecretForm
        headerDefault={headerDefault}
        onSubmit={(result) => close(result)}
        onCancel={() => close(undefined)}
      />
    ),
  });
}

export function McpSecretForm({
  headerDefault,
  onSubmit,
  onCancel,
}: {
  headerDefault: string;
  onSubmit: (result: McpSecretFormResult) => void;
  onCancel: () => void;
}): ReactNode {
  type Step = 'key' | 'value';
  const panel = usePanelColors();
  const colors = {
    body: panel.body,
  };
  const [step, setStep] = useState<Step>('key');
  const [secretKey, setSecretKey] = useState(headerDefault);
  const [secretValue, setSecretValue] = useState('');

  const goToValue = (raw: string): void => {
    const next = raw.trim();
    if (!next) return;
    setSecretKey(next);
    setStep('value');
  };

  const finish = (raw: string): void => {
    const key = secretKey.trim();
    const value = raw.trim();
    if (!key || !value) return;
    onSubmit({ key, value });
  };

  const changeStep = (next: string): void => {
    if (next === 'value') {
      const key = secretKey.trim();
      if (!key) return;
      setSecretKey(key);
      setStep('value');
      return;
    }
    if (next === 'key') setStep('key');
  };

  const tabs: Tab[] = [
    {
      key: 'key',
      label: t('mcp.secretKeyStep'),
      content: (
        <TextInput
          key="secret-key"
          label={t('mcp.headerPrompt')}
          initialValue={secretKey}
          onChange={setSecretKey}
          onSubmit={goToValue}
          onCancel={onCancel}
        />
      ),
    },
    {
      key: 'value',
      label: t('mcp.secretValueStep'),
      content: (
        <TextInput
          key="secret-value"
          label={t('mcp.tokenPrompt')}
          initialValue={secretValue}
          onChange={setSecretValue}
          onSubmit={finish}
          onCancel={onCancel}
        />
      ),
    },
  ];

  return (
    <box flexDirection="column">
      <Text bold color={colors.body}>
        {t('mcp.secretsTitle')}
      </Text>
      <Tabs
        tabs={tabs}
        activeTab={step}
        onTabChange={changeStep}
        // Arrow tab nav would steal the input cursor; click a step label to go back.
        isActive={false}
      />
    </box>
  );
}
