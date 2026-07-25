import { Box, Text, useInput, useStdout } from 'ink';
import { useMemo, useState, type ReactNode } from 'react';
import type { Skill } from '../domain/types.js';
import { skillFieldLabels } from './skill-labels.js';
import { Tabs, TextInput, termcnColors, type Tab } from './components/termcn.js';
import { textWidth, wrapColumns } from './components/terminal-layout.js';

const colors = termcnColors;

function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
}

function skillNameColumnWidth(options: { skill: Skill }[], columns: number): number {
  const longestName = options.reduce(
    (longest, option) => Math.max(longest, textWidth(option.skill.name)),
    0
  );
  const minimumDescriptionWidth = columns >= 90 ? 32 : columns >= 70 ? 24 : columns >= 50 ? 14 : 0;
  // Account for the framed list, selection marker, status icon column, and gaps.
  const availableNameWidth = Math.max(12, columns - 9 - minimumDescriptionWidth);
  return Math.max(12, Math.min(Math.max(20, longestName), availableNameWidth));
}

function collectionStatusLabel(status: Skill['collectionStatus']): string {
  if (status === 'same-source') return '已收藏（同一来源）';
  if (status === 'same-name') return '同名冲突（来源不同）';
  return '';
}

function collectionStatusIcon(
  status: Skill['collectionStatus']
): { symbol: '★' | '☆'; color: string } | undefined {
  if (status === 'same-source') return { symbol: '★', color: colors.muted };
  if (status === 'same-name') return { symbol: '☆', color: colors.error };
  return undefined;
}

interface DetailPreviewLine {
  label?: string;
  value: string;
  muted?: boolean;
}

function detailFieldLines(
  label: string,
  value: string,
  width: number,
  muted = false
): DetailPreviewLine[] {
  const labelText = `${label}：`;
  const indentation = ' '.repeat(textWidth(labelText));
  const valueWidth = Math.max(1, width - textWidth(labelText));
  return value
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapColumns(paragraph || '无', valueWidth))
    .map((line, index) => index === 0
      ? { label: labelText, value: line, muted }
      : { value: `${indentation}${line}`, muted });
}

function detailPreviewLines(
  skill: Skill,
  agent: string,
  width: number
): DetailPreviewLine[] {
  const lines: DetailPreviewLine[] = [
    ...detailFieldLines(skillFieldLabels.description, skill.description || '无', width),
    ...wrapColumns(`来自 ${agent} · ${skill.path}`, width).map((value) => ({
      value,
      muted: true,
    })),
  ];
  const status = collectionStatusLabel(skill.collectionStatus);
  if (status) {
    lines.push({ value: '' }, ...detailFieldLines(skillFieldLabels.collectionStatus, status, width));
  }
  return lines;
}

export interface SkillOption<T extends Skill> {
  skill: T;
  agent: string;
}

export interface ImportReviewItem<T extends Skill> {
  skill: T;
  detail: string;
}

export interface ImportReviewResult {
  confirmed: boolean;
  tags: string[];
}

import type {
  InstallReviewResult,
  InstallReviewTarget,
} from '../contracts/install-review.js';

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

function SkillDetailPreview<T extends Skill>({
  skill,
  agent,
  frameHeight,
  frameWidth,
}: {
  skill: T;
  agent: string;
  frameHeight: number;
  frameWidth: number;
}): ReactNode {
  const [detailOffset, setDetailOffset] = useState(0);
  const lines = detailPreviewLines(skill, agent, Math.max(12, frameWidth - 4));
  const viewportHeight = Math.max(1, frameHeight - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(detailOffset, maxOffset);
  const visible = lines.slice(offset, offset + viewportHeight);

  useInput((_input, key) => {
    if (key.upArrow && maxOffset) {
      setDetailOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow && maxOffset) {
      setDetailOffset((current) => Math.min(maxOffset, current + 1));
    }
  });

  return (
    <>
      <Box
        flexDirection="column"
        width={frameWidth}
        height={frameHeight}
        borderStyle="round"
        borderColor={colors.border}
        paddingX={1}
        overflow="hidden"
      >
        {visible.map((line, index) => (
          <Text
            key={`${offset + index}:${line.label ?? ''}:${line.value}`}
            {...(line.muted ? { color: colors.muted } : {})}
          >
            {line.label && <Text bold>{line.label}</Text>}{line.value}
          </Text>
        ))}
      </Box>
      <Text color={colors.muted}>
        {maxOffset ? `${offset + 1}–${Math.min(offset + viewportHeight, lines.length)} / ${lines.length}` : ' '}
      </Text>
      <Text color={colors.muted}>
        {`${maxOffset ? '↑/↓ 滚动 · ' : ''}Esc 返回 · Space 选择 · Enter 确认导入`}
      </Text>
    </>
  );
}

export function SkillMultiSelect<T extends Skill>({
  groups,
  label,
  onCancel,
  onSubmit,
}: {
  groups: { agent: string; options: SkillOption<T>[] }[];
  label?: string;
  onCancel: () => void;
  onSubmit: (values: T[]) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const agentNames = useMemo(() => groups.map((group) => group.agent), [groups]);
  const [activeAgent, setActiveAgent] = useState(agentNames[0] ?? '');
  const [cursorByAgent, setCursorByAgent] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const name of agentNames) initial[name] = 0;
    return initial;
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<T | undefined>(undefined);
  const [focus, setFocus] = useState<'tabs' | 'list'>('list');

  const currentGroup = groups.find((group) => group.agent === activeAgent) ?? groups[0];
  const options = currentGroup?.options ?? [];
  const cursor = cursorByAgent[activeAgent] ?? 0;
  const total = groups.reduce((sum, group) => sum + group.options.length, 0);
  const singleAgent = groups.length <= 1;

  const nameColumnWidth = skillNameColumnWidth(options, stdout.columns ?? 80);
  const viewportHeight = Math.max(3, (stdout.rows ?? 24) - 9);
  const clampedCursor = Math.max(0, Math.min(cursor, Math.max(0, options.length - 1)));
  const offset = Math.max(
    0,
    Math.min(
      clampedCursor - Math.floor(viewportHeight / 2),
      Math.max(0, options.length - viewportHeight)
    )
  );
  const visible = options.slice(offset, offset + viewportHeight);
  const frameHeight = Math.max(5, Math.min(viewportHeight, Math.max(3, options.length)) + 2);
  const frameWidth = Math.max(20, stdout.columns ?? 80);

  const setCursor = (next: number) => {
    setCursorByAgent((prev) => ({ ...prev, [activeAgent]: next }));
  };

  const toggleCurrent = () => {
    const option = options[clampedCursor];
    if (!option) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(option.skill.path)) next.delete(option.skill.path);
      else next.add(option.skill.path);
      return next;
    });
  };

  const toggleAllInTab = () => {
    if (!options.length) return;
    const allSelected = options.every((option) => selected.has(option.skill.path));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const option of options) {
        if (allSelected) next.delete(option.skill.path);
        else next.add(option.skill.path);
      }
      return next;
    });
  };

  const submit = () => {
    const result: T[] = [];
    for (const group of groups) {
      for (const option of group.options) {
        if (selected.has(option.skill.path)) result.push(option.skill);
      }
    }
    onSubmit(result);
  };

  useInput((input, key) => {
    if (viewing) {
      if (key.escape || key.leftArrow) {
        setViewing(undefined);
        return;
      }
      if (isReturn(input, key.return)) {
        submit();
        return;
      }
      if (input === ' ') {
        const index = options.findIndex((option) => option.skill.path === viewing.path);
        if (index >= 0) {
          setCursor(index);
          const option = options[index];
          if (option) {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(option.skill.path)) next.delete(option.skill.path);
              else next.add(option.skill.path);
              return next;
            });
          }
        }
        return;
      }
      return;
    }

    if (key.escape) return onCancel();

    if (focus === 'tabs') {
      if (key.downArrow) setFocus('list');
      if (key.leftArrow || key.rightArrow) {
        const index = agentNames.indexOf(activeAgent);
        const offset = key.leftArrow ? -1 : 1;
        const next = agentNames[(index + offset + agentNames.length) % agentNames.length];
        if (next) setActiveAgent(next);
      }
      return;
    }

    if (key.upArrow) {
      if (!singleAgent && clampedCursor === 0) {
        setFocus('tabs');
        return;
      }
      setCursor(Math.max(0, clampedCursor - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(options.length ? (clampedCursor + 1) % options.length : 0);
      return;
    }

    if (input === ' ') {
      toggleCurrent();
      return;
    }
    if (key.rightArrow) {
      const option = options[clampedCursor];
      if (option) setViewing(option.skill);
      return;
    }
    if (input === 'a') {
      toggleAllInTab();
      return;
    }
    if (isReturn(input, key.return)) {
      submit();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text {...(viewing ? { color: colors.primary } : {})} bold>
        {viewing ? `‹ ${viewing.name}` : `${label ?? '选择技能'} · 已选 ${selected.size} / 共 ${total}`}
      </Text>
      {!singleAgent && (
        <Box paddingLeft={1}>
          {groups.map((group, index) => (
            <Box key={group.agent}>
              <Text
                color={group.agent === activeAgent ? colors.primary : colors.muted}
                bold={group.agent === activeAgent}
                underline={group.agent === activeAgent}
                inverse={focus === 'tabs' && group.agent === activeAgent}
              >
                {group.agent} ({group.options.length})
              </Text>
              {index < groups.length - 1 && <Text color={colors.border}> │ </Text>}
            </Box>
          ))}
        </Box>
      )}
      {viewing ? (
        <SkillDetailPreview
          skill={viewing}
          agent={activeAgent}
          frameHeight={frameHeight}
          frameWidth={frameWidth}
        />
      ) : (
        <>
          <Box
            flexDirection="column"
            width={frameWidth}
            height={frameHeight}
            borderStyle="round"
            borderColor={colors.border}
            paddingX={1}
            overflow="hidden"
          >
            {visible.length ? (
              visible.map((option, visibleIndex) => {
                const index = offset + visibleIndex;
                const isSelected = selected.has(option.skill.path);
                const isCursor = focus === 'list' && index === clampedCursor;
                const status = collectionStatusIcon(option.skill.collectionStatus);
                return (
                  <Box key={option.skill.path} gap={1} width="100%">
                    <Text {...(isCursor ? { color: colors.primary } : {})}>
                      {isSelected ? '●' : '○'}
                    </Text>
                    <Box width={1} flexShrink={0}>
                      {status && <Text color={status.color}>{status.symbol}</Text>}
                    </Box>
                    <Box width={nameColumnWidth} flexShrink={0}>
                      <Text wrap="truncate-end" bold={isCursor}>
                        {option.skill.name}
                      </Text>
                    </Box>
                    <Box flexGrow={1} overflow="hidden">
                      <Text wrap="truncate-end" color={colors.muted}>
                        {option.skill.description}
                      </Text>
                    </Box>
                  </Box>
                );
              })
            ) : (
              <Text color={colors.muted}>当前 Agent 没有可导入的技能</Text>
            )}
          </Box>
          <Text color={colors.muted}>
            {options.length > 0
              ? `${offset + 1}–${Math.min(offset + viewportHeight, options.length)} / ${options.length}`
              : `0 / 0`}
          </Text>
          <Text color={colors.muted}>
            {singleAgent
              ? '↑/↓ 移动 · Space 选择 · → 详情 · a 全选 · Enter 确认 · Esc 取消'
              : focus === 'tabs'
                ? '←/→ 切换 Agent · ↓ 返回技能列表 · Esc 取消'
                : '↑/↓ 移动 · Space 选择 · → 详情 · a 全选当前 · Enter 确认 · Esc 取消'}
          </Text>
        </>
      )}
    </Box>
  );
}

export function ImportReview<T extends Skill>({
  label = '确认导入',
  items,
  existingTags,
  onSubmit,
}: {
  label?: string;
  items: ImportReviewItem<T>[];
  existingTags: string[];
  onSubmit: (result: ImportReviewResult) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState<'tags' | 'confirm'>('tags');
  const [tagFocus, setTagFocus] = useState<'list' | 'input'>(existingTags.length ? 'list' : 'input');
  const [cursor, setCursor] = useState(0);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  const height = Math.max(3, (stdout.rows ?? 24) - 15);
  const clampedCursor = Math.max(0, Math.min(cursor, Math.max(0, existingTags.length - 1)));
  const offset = Math.max(
    0,
    Math.min(clampedCursor - Math.floor(height / 2), Math.max(0, existingTags.length - height))
  );
  const visibleTags = existingTags.slice(offset, offset + height);
  const visibleItems = items.slice(0, Math.max(3, Math.min(items.length, (stdout.rows ?? 24) - 10)));

  const submit = (confirmed: boolean) => {
    onSubmit({ confirmed, tags: [...selectedTags] });
  };
  const addTags = (input: string) => {
    const tags = input.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) {
      setSelectedTags((previous) => new Set([...previous, ...tags]));
    }
    setActiveTab('confirm');
  };
  const toggleCurrentTag = () => {
    const tag = existingTags[clampedCursor];
    if (!tag) return;
    setSelectedTags((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  useInput((input, key) => {
    if (activeTab === 'confirm') {
      if (key.leftArrow) {
        setActiveTab('tags');
        return;
      }
      if (input.trim().toLowerCase() === 'n') {
        submit(false);
        return;
      }
      if (input.trim().toLowerCase() === 'y' || isReturn(input, key.return)) {
        submit(true);
        return;
      }
      return;
    }

    if (tagFocus === 'list' && key.rightArrow) {
      setActiveTab('confirm');
      return;
    }
    if (key.tab) {
      setTagFocus((value) => existingTags.length && value === 'input' ? 'list' : 'input');
      return;
    }
    if (tagFocus !== 'list') return;
    if (key.upArrow) {
      setCursor(Math.max(0, clampedCursor - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(existingTags.length ? (clampedCursor + 1) % existingTags.length : 0);
      return;
    }
    if (input === ' ') {
      toggleCurrentTag();
      return;
    }
    if (isReturn(input, key.return)) {
      setActiveTab('confirm');
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box paddingLeft={1}>
        {(['tags', 'confirm'] as const).map((tab, index) => (
          <Box key={tab}>
            <Text
              color={activeTab === tab ? colors.primary : colors.muted}
              bold={activeTab === tab}
              underline={activeTab === tab}
            >
              {tab === 'tags' ? '选择分组' : '确认'}
            </Text>
            {index === 0 && <Text color={colors.border}> │ </Text>}
          </Box>
        ))}
      </Box>
      {activeTab === 'tags' ? (
        <Box flexDirection="column">
          <Text color={colors.muted}>
            已选分组：{selectedTags.size ? [...selectedTags].join(', ') : '无'}
          </Text>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={colors.border}
            paddingX={1}
          >
            {visibleTags.length ? (
              visibleTags.map((tag, visibleIndex) => {
                const index = offset + visibleIndex;
                const active = tagFocus === 'list' && index === clampedCursor;
                return (
                  <Text key={tag} {...(active ? { color: colors.primary } : {})}>
                    {`${active ? '›' : ' '} ${selectedTags.has(tag) ? '●' : '○'} ${tag}`}
                  </Text>
                );
              })
            ) : (
              <Text color={colors.muted}>暂无已有分组</Text>
            )}
          </Box>
          <TextInput
            label="新增分组（逗号分隔）"
            isActive={tagFocus === 'input'}
            onSubmit={addTags}
          />
          <Text color={colors.muted}>
            {tagFocus === 'input'
              ? 'Enter 完成分组 · Tab 返回已有分组 · Esc 取消'
              : '↑/↓ 移动 · Space 选择 · Tab 切换输入 · Enter 完成分组 · → 确认 · Esc 取消'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>
            将导入 {items.length} 个技能；分组：
            {selectedTags.size ? [...selectedTags].join(', ') : '无'}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {visibleItems.map((item) => (
              <Text key={item.skill.path} color={colors.muted} wrap="truncate-end">
                - {item.skill.name}: {item.detail}
              </Text>
            ))}
            {items.length > visibleItems.length && (
              <Text color={colors.muted}>… 还有 {items.length - visibleItems.length} 个</Text>
            )}
          </Box>
          <Text color={colors.muted}>Enter 确认导入 · ← 返回分组 · n 取消 · Esc 取消</Text>
        </Box>
      )}
    </Box>
  );
}
