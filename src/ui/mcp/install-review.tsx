import { useState, type ReactNode } from 'react';
import type { McpInstallReviewOptions, McpScope } from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { Tabs, termcnColors, type Tab } from '../components/termcn.js';
import { isReturn } from '../components/text.js';
import { useInput } from '../components/use-input.js';
import { Layer } from '../overlay/static.js';
import { Text, usePanelColors } from '../tui/index.js';

export interface McpInstallReviewResult {
  confirmed: boolean;
  destination: McpScope;
  agents: string[];
}

export function promptMcpInstallReview(
  names: string[],
  options: McpInstallReviewOptions
): Promise<{ destination: McpScope; agents: string[] } | undefined> {
  return Layer.open<{ destination: McpScope; agents: string[] } | undefined>({
    footerItems: [
      { key: '↑↓', label: t('common.move') },
      { key: 'Space', label: t('common.select') },
      { key: 'Enter', label: t('common.confirm') },
      { key: '←', label: t('common.back') },
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <McpInstallReview
        names={names}
        targets={options.targets}
        defaultProjectAgents={options.defaultProjectAgents}
        defaultGlobalAgents={options.defaultGlobalAgents}
        onSubmit={(result) => close(result.confirmed ? {
          destination: result.destination,
          agents: result.agents,
        } : undefined)}
      />
    ),
  });
}

export function McpInstallReview({
  names,
  targets,
  defaultProjectAgents,
  defaultGlobalAgents,
  onSubmit,
}: {
  names: string[];
  targets: McpInstallReviewOptions['targets'];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
  onSubmit: (result: McpInstallReviewResult) => void;
}): ReactNode {
  type TabKey = 'destination' | 'targets' | 'confirm';
  const panel = usePanelColors();
  const colors = {
    primary: termcnColors.primary,
    body: panel.body,
  };
  const [activeTab, setActiveTab] = useState<TabKey>('destination');
  const [destination, setDestination] = useState<McpScope>('project');
  const [targetCursor, setTargetCursor] = useState(0);
  const [agentsByDestination, setAgentsByDestination] = useState<Record<McpScope, Set<string>>>(
    () => ({
      project: new Set(defaultProjectAgents),
      global: new Set(defaultGlobalAgents),
    })
  );
  const activeAgents = agentsByDestination[destination];
  const availableTargets = targets.filter((target) =>
    destination === 'global' ? Boolean(target.globalLabel) : Boolean(target.projectLabel)
  );
  const activeTargetLabel = (target: McpInstallReviewOptions['targets'][number]): string =>
    destination === 'global' ? target.globalLabel! : target.projectLabel!;
  const selectedTargetLabels = availableTargets
    .filter((target) => activeAgents.has(target.value))
    .map(activeTargetLabel);
  const tabOrder: TabKey[] = ['destination', 'targets', 'confirm'];
  const tabIndex = tabOrder.indexOf(activeTab);
  const moveTab = (offset: number): void => {
    const next = tabOrder[tabIndex + offset];
    if (next) setActiveTab(next);
  };
  const finish = (confirmed: boolean): void => {
    onSubmit({
      confirmed,
      destination,
      agents: [...activeAgents],
    });
  };

  useInput((input, key) => {
    if (key.escape) return finish(false);

    if (activeTab === 'confirm') {
      if (key.leftArrow) return moveTab(-1);
      if (input.trim().toLowerCase() === 'n') return finish(false);
      if (input.trim().toLowerCase() === 'y' || isReturn(input, key.return)) return finish(true);
      return;
    }

    if (key.leftArrow) return moveTab(-1);
    if (key.rightArrow) {
      if (activeTab !== 'targets' || activeAgents.size) moveTab(1);
      return;
    }
    if (activeTab === 'destination') {
      if (key.upArrow || key.downArrow) {
        setDestination((current) => current === 'project' ? 'global' : 'project');
        setTargetCursor(0);
        return;
      }
      if (isReturn(input, key.return)) return moveTab(1);
      return;
    }

    if (key.upArrow) {
      setTargetCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setTargetCursor((current) => Math.min(Math.max(0, availableTargets.length - 1), current + 1));
      return;
    }
    if (input === ' ') {
      const target = availableTargets[targetCursor];
      if (!target) return;
      setAgentsByDestination((previous) => {
        const next = new Set(previous[destination]);
        if (next.has(target.value)) next.delete(target.value);
        else next.add(target.value);
        return { ...previous, [destination]: next };
      });
      return;
    }
    if (isReturn(input, key.return) && activeAgents.size) moveTab(1);
  });

  const tabs: Tab[] = [
    {
      key: 'destination',
      label: t('install.location'),
      content: (
        <box flexDirection="column">
          {(['project', 'global'] as const).map((option) => {
            const selected = destination === option;
            return (
              <Text
                key={option}
                color={selected ? colors.primary : colors.body}
                bold={selected}
              >
                {selected ? '●' : '○'} {option === 'project' ? t('common.project') : t('common.global')}
              </Text>
            );
          })}
        </box>
      ),
    },
    {
      key: 'targets',
      label: t('mcp.targetsTab'),
      content: (
        <box flexDirection="column">
          {availableTargets.map((target, index) => {
            const selected = activeAgents.has(target.value);
            const active = index === targetCursor;
            return (
              <Text
                key={target.value}
                color={active ? colors.primary : colors.body}
                bold={active}
              >
                {active ? '›' : ' '} {selected ? '●' : '○'} {activeTargetLabel(target)}
              </Text>
            );
          })}
        </box>
      ),
    },
    {
      key: 'confirm',
      label: t('common.confirm'),
      content: (
        <box flexDirection="column">
          <Text color={colors.body}>{t('mcp.mcpLine', { names: names.join(', ') })}</Text>
          <Text color={colors.body}>
            {t('install.locationLine', {
              value: destination === 'project' ? t('common.project') : t('common.global'),
            })}
          </Text>
          <Text color={colors.body}>{t('mcp.targetsLine', { value: selectedTargetLabels.join(', ') })}</Text>
        </box>
      ),
    },
  ];

  return (
    <box flexDirection="column">
      <Text bold color={colors.body}>
        {t('mcp.installTitle')}
      </Text>
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={() => undefined}
        isActive={false}
      />
    </box>
  );
}
