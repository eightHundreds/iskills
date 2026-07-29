import { Text, useModalChrome, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useMemo, useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { skillFieldLabels } from '../skill-labels.js';
import { collectionMatchLabels, collectionMatchMarkers } from '../collection-match.js';
import { termcnColors } from '../components/termcn.js';
import { Clickable } from '../components/mouse/clickable.js';
import { textWidth, wrapColumns } from '../components/terminal-layout.js';

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
  const status = skill.collectionStatus && collectionMatchLabels[skill.collectionStatus];
  if (status) {
    lines.push({ value: '' }, ...detailFieldLines(skillFieldLabels.collectionStatus, status, width));
  }
  return lines;
}

export interface SkillOption<T extends Skill> {
  skill: T;
  agent: string;
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
  const chrome = useModalChrome();
  const colors = {
    primary: termcnColors.primary,
    border: termcnColors.border,
    muted: chrome.muted,
    body: chrome.body,
    surface: chrome.surface,
  };
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
      <box border
        flexDirection="column"
        width={frameWidth}
        height={frameHeight}
        borderStyle="rounded"
        borderColor={colors.border}
        backgroundColor={colors.surface}
        paddingX={1}
        overflow="hidden"
      >
        {visible.map((line, index) => (
          <Text
            key={`${offset + index}:${line.label ?? ''}:${line.value}`}
            color={line.muted ? colors.muted : colors.body}
            backgroundColor={colors.surface}
          >
            {line.label && <Text bold color={colors.body} backgroundColor={colors.surface}>{line.label}</Text>}
            {line.value}
          </Text>
        ))}
      </box>
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
  const chrome = useModalChrome();
  const colors = {
    primary: termcnColors.primary,
    border: termcnColors.border,
    muted: chrome.muted,
    body: chrome.body,
    surface: chrome.surface,
  };
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
    <box flexDirection="column">
      <Text
        color={viewing ? colors.primary : colors.body}
        bold
      >
        {viewing ? `‹ ${viewing.name}` : `${label ?? '选择技能'} · 已选 ${selected.size} / 共 ${total}`}
      </Text>
      {!singleAgent && (
        <box flexDirection="row" paddingLeft={1}>
          {groups.map((group, index) => (
            <box flexDirection="row" key={group.agent}>
              <Clickable
                onClick={() => {
                  setActiveAgent(group.agent);
                  setFocus('list');
                }}
              >
                <Text
                  color={group.agent === activeAgent ? colors.primary : colors.muted}
                  bold={group.agent === activeAgent}
                  underline={group.agent === activeAgent}
                  inverse={focus === 'tabs' && group.agent === activeAgent}
                >
                  {group.agent} ({group.options.length})
                </Text>
              </Clickable>
              {index < groups.length - 1 && <Text color={colors.border}> │ </Text>}
            </box>
          ))}
        </box>
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
          <box border
            flexDirection="column"
            width={frameWidth}
            height={frameHeight}
            borderStyle="rounded"
            borderColor={colors.border}
            backgroundColor={colors.surface}
            paddingX={1}
            overflow="hidden"
          >
            {visible.length ? (
              visible.map((option, visibleIndex) => {
                const index = offset + visibleIndex;
                const isSelected = selected.has(option.skill.path);
                const isCursor = focus === 'list' && index === clampedCursor;
                const status = option.skill.collectionStatus &&
                  collectionMatchMarkers[option.skill.collectionStatus];
                return (
                  <Clickable
                    key={option.skill.path}
                    onClick={() => {
                      setCursor(index);
                      setFocus('list');
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(option.skill.path)) next.delete(option.skill.path);
                        else next.add(option.skill.path);
                        return next;
                      });
                    }}
                  >
                    <box
                      flexDirection="row"
                      gap={1}
                      width="100%"
                      backgroundColor={colors.surface}
                    >
                      <Text
                        color={isCursor ? colors.primary : colors.body}
                        backgroundColor={colors.surface}
                      >
                        {isSelected ? '●' : '○'}
                      </Text>
                      <box flexDirection="row" width={1} flexShrink={0}>
                        {status && <Text color={status.color}>{status.symbol}</Text>}
                      </box>
                      <box flexDirection="row" width={nameColumnWidth} flexShrink={0}>
                        <Text
                          wrap="truncate-end"
                          bold={isCursor}
                          color={colors.body}
                          backgroundColor={colors.surface}
                        >
                          {option.skill.name}
                        </Text>
                      </box>
                      <box flexDirection="row" flexGrow={1} overflow="hidden">
                        <Text
                          wrap="truncate-end"
                          color={colors.muted}
                          backgroundColor={colors.surface}
                        >
                          {option.skill.description}
                        </Text>
                      </box>
                    </box>
                  </Clickable>
                );
              })
            ) : (
              <Text color={colors.muted} backgroundColor={colors.surface}>
                当前 Agent 没有可导入的技能
              </Text>
            )}
          </box>
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
    </box>
  );
}
