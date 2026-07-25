import { Box, Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { Tabs, termcnColors, type Tab } from '../components/termcn.js';
import type { InstallReviewResult, InstallReviewTarget } from './types.js';

const colors = termcnColors;

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
      label: '安装位置',
      content: (
        <Box flexDirection="column">
          {(['project', 'global'] as const).map((option) => {
            const selected = destination === option;
            return (
              <Text key={option} color={selected ? colors.primary : colors.muted} bold={selected}>
                {selected ? '●' : '○'} {option === 'project' ? '当前项目' : '全局'}
              </Text>
            );
          })}
          <Text color={colors.muted}>↑/↓ 选择 · Enter 下一步 · Esc 取消</Text>
        </Box>
      ),
    },
    {
      key: 'mode',
      label: '添加方式',
      content: (
        <Box flexDirection="column">
          <Text color={!copy ? colors.primary : colors.muted} bold={!copy}>
            {copy ? '○' : '●'} 软链（推荐）
          </Text>
          <Text color={copy ? colors.primary : colors.muted} bold={copy}>
            {copy ? '●' : '○'} 复制
          </Text>
          <Text color={colors.muted}>↑/↓ 选择 · ← 返回 · Enter 下一步 · Esc 取消</Text>
        </Box>
      ),
    },
    {
      key: 'targets',
      label: '目标目录',
      content: (
        <Box flexDirection="column">
          {availableTargets.map((target, index) => {
            const selected = activeAgents.has(target.value);
            const active = index === targetCursor;
            return (
              <Text key={target.value} {...(active ? { color: colors.primary } : {})} bold={active}>
                {active ? '›' : ' '} {selected ? '●' : '○'} {activeTargetLabel(target)}
              </Text>
            );
          })}
          <Text color={colors.muted}>
            ↑/↓ 移动 · Space 选择 · ← 返回 · {activeAgents.size ? 'Enter 下一步' : '至少选择一个目录'} · Esc 取消
          </Text>
        </Box>
      ),
    },
    {
      key: 'confirm',
      label: '确认',
      content: (
        <Box flexDirection="column">
          <Text>技能：{skills.map((skill) => skill.name).join(', ')}</Text>
          <Text>安装位置：{destination === 'project' ? '当前项目' : '全局'}</Text>
          <Text>添加方式：{copy ? '复制' : '软链'}</Text>
          <Text>目标目录：{selectedTargetLabels.join(', ')}</Text>
          <Text color={colors.muted}>Enter 确认安装 · ← 返回 · n 取消 · Esc 取消</Text>
        </Box>
      ),
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>安装技能</Text>
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={() => undefined}
        isActive={false}
      />
    </Box>
  );
}
