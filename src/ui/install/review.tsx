import { Text, useModalChrome } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { Tabs, termcnColors, type Tab } from '../components/termcn.js';
import type { InstallReviewResult, InstallReviewTarget } from './types.js';
import { t } from '../../i18n/index.js';

function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
}

export function InstallReview({
  skills,
  targets,
  defaultProjectAgents,
  defaultGlobalAgents,
  onSubmit,
}: {
  skills: Skill[];
  targets: InstallReviewTarget[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
  onSubmit: (result: InstallReviewResult) => void;
}): ReactNode {
  type Destination = InstallReviewResult['destination'];
  type TabKey = 'destination' | 'mode' | 'targets' | 'confirm';
  const chrome = useModalChrome();
  const colors = {
    primary: termcnColors.primary,
    muted: chrome.muted,
    body: chrome.body,
  };
  const [activeTab, setActiveTab] = useState<TabKey>('destination');
  const [destination, setDestination] = useState<Destination>('project');
  const [copy, setCopy] = useState(false);
  const [targetCursor, setTargetCursor] = useState(0);
  const [agentsByDestination, setAgentsByDestination] = useState<Record<Destination, Set<string>>>(
    () => ({
      project: new Set(defaultProjectAgents),
      global: new Set(defaultGlobalAgents),
    })
  );
  const activeAgents = agentsByDestination[destination];
  const availableTargets = targets.filter((target) =>
    destination === 'global' ? Boolean(target.globalLabel) : Boolean(target.projectLabel)
  );
  const activeTargetLabel = (target: InstallReviewTarget): string =>
    destination === 'global' ? target.globalLabel! : target.projectLabel!;
  const selectedTargetLabels = availableTargets
    .filter((target) => activeAgents.has(target.value))
    .map(activeTargetLabel);
  const tabOrder: TabKey[] = ['destination', 'mode', 'targets', 'confirm'];
  const tabIndex = tabOrder.indexOf(activeTab);
  const moveTab = (offset: number): void => {
    const next = tabOrder[tabIndex + offset];
    if (next) setActiveTab(next);
  };
  const finish = (confirmed: boolean): void => {
    onSubmit({
      confirmed,
      destination,
      copy,
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
    if (activeTab === 'mode') {
      if (key.upArrow || key.downArrow) {
        setCopy((current) => !current);
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
          <Text color={colors.muted}>{t('install.locationStepFooter')}</Text>
        </box>
      ),
    },
    {
      key: 'mode',
      label: t('install.method'),
      content: (
        <box flexDirection="column">
          <Text color={!copy ? colors.primary : colors.body} bold={!copy}>
            {copy ? '○' : '●'} {t('install.symlinkRecommended')}
          </Text>
          <Text color={copy ? colors.primary : colors.body} bold={copy}>
            {copy ? '●' : '○'} {t('common.copy')}
          </Text>
          <Text color={colors.muted}>{t('install.methodStepFooter')}</Text>
        </box>
      ),
    },
    {
      key: 'targets',
      label: t('install.targetDirs'),
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
          <Text color={colors.muted}>
            {t('install.targetsFooter', { next: activeAgents.size ? t('install.nextStep') : t('install.selectAtLeastOne') })}
          </Text>
        </box>
      ),
    },
    {
      key: 'confirm',
      label: t('common.confirm'),
      content: (
        <box flexDirection="column">
          <Text color={colors.body}>
            {t('install.skillLine', { names: skills.map((skill) => skill.name).join(', ') })}
          </Text>
          <Text color={colors.body}>
            {t('install.locationLine', { value: destination === 'project' ? t('common.project') : t('common.global') })}
          </Text>
          <Text color={colors.body}>{t('install.methodLine', { value: copy ? t('common.copy') : t('common.symlink') })}</Text>
          <Text color={colors.body}>
            {t('install.targetsLine', { value: selectedTargetLabels.join(', ') })}
          </Text>
          <Text color={colors.muted}>{t('install.confirmFooter')}</Text>
        </box>
      ),
    },
  ];

  return (
    <box flexDirection="column">
      <Text bold color={colors.body}>
        {t('install.title')}
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
