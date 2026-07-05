import {
  ConfirmInput,
  MultiSelect as InkMultiSelect,
  Select as InkSelect,
} from '@inkjs/ui';
import { Box, Text, useInput, useStdout } from 'ink';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Skill } from '../types.js';

const colors = {
  primary: '#7C3AED',
  foreground: '#FFFFFF',
  muted: '#9CA3AF',
  border: '#4B5563',
  error: '#EF4444',
};

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

function visibleOptionCount(rows: number, label?: string) {
  return Math.max(3, rows - (label ? 5 : 4));
}

function toInkOptions<T>(options: Option<T>[], numbered = false) {
  return options.map((option, index) => ({
    value: String(index),
    label: `${numbered ? `${index + 1}. ` : ''}${option.label}${option.hint ? ` — ${option.hint}` : ''}`,
  }));
}

function resolveOptionValues<T>(options: Option<T>[], values: string[]): T[] {
  return values.flatMap((value) => {
    const index = Number(value);
    const option = options[index];
    return option ? [option.value] : [];
  });
}

function resolveOptionValue<T>(options: Option<T>[], value: string): T | undefined {
  const index = Number(value);
  return options[index]?.value;
}

export function Select<T>({
  label,
  options,
  onSubmit,
  numbered = false,
}: {
  label?: string;
  options: Option<T>[];
  onSubmit: (value: T) => void;
  numbered?: boolean;
}): ReactNode {
  const { stdout } = useStdout();
  const inkOptions = useMemo(() => toInkOptions(options, numbered), [numbered, options]);
  useInput((input) => {
    if (!numbered || !/^[1-9]$/.test(input)) return;
    const option = options[Number(input) - 1];
    if (option) onSubmit(option.value);
  });
  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <InkSelect
        visibleOptionCount={visibleOptionCount(stdout.rows, label)}
        options={inkOptions}
        onChange={(value) => {
          const resolved = resolveOptionValue(options, value);
          if (resolved !== undefined) onSubmit(resolved);
        }}
      />
      <Text color={colors.muted}>
        {numbered ? `1–${Math.min(options.length, 9)} 快选 · ` : ''}↑/↓ 选择 · Enter 确认 · Esc 取消
      </Text>
    </Box>
  );
}

export function MultiSelect<T>({
  label,
  options,
  onSubmit,
}: {
  label?: string;
  options: Option<T>[];
  onSubmit: (values: T[]) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const inkOptions = useMemo(() => toInkOptions(options), [options]);
  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <InkMultiSelect
        visibleOptionCount={visibleOptionCount(stdout.rows, label)}
        options={inkOptions}
        onSubmit={(values) => onSubmit(resolveOptionValues(options, values))}
      />
      <Text color={colors.muted}>Space 选择 · Enter 确认 · Esc 取消</Text>
    </Box>
  );
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
    <Box flexDirection="column">
      <Text>
        <Text color={colors.primary}>? </Text>
        {message}
      </Text>
      <Box paddingLeft={2}>
        <ConfirmInput
          defaultChoice={defaultValue ? 'confirm' : 'cancel'}
          onConfirm={() => onSubmit(true)}
          onCancel={() => onSubmit(false)}
        />
      </Box>
      <Text color={colors.muted}>Y/n 确认 · Enter 确认 · Esc 取消</Text>
    </Box>
  );
}

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
  const [cursor, setCursor] = useState(initialValue.length);
  const cursorRef = useRef(initialValue.length);
  const { stdout } = useStdout();
  const resolvedWidth = Math.min(width, Math.max(20, stdout.columns - 2));
  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
    onChange?.(next);
  };
  useInput((input, key) => {
    if (key.return || input === '\r' || input === '\n') return onSubmit(valueRef.current);
    if (key.escape || (key.ctrl && input === 'c')) return onCancel?.();
    if (key.leftArrow) {
      cursorRef.current = Math.max(0, cursorRef.current - 1);
      return setCursor(cursorRef.current);
    }
    if (key.rightArrow) {
      cursorRef.current = Math.min(valueRef.current.length, cursorRef.current + 1);
      return setCursor(cursorRef.current);
    }
    if (key.backspace || key.delete) {
      if (!cursorRef.current) return;
      const next =
        valueRef.current.slice(0, cursorRef.current - 1) +
        valueRef.current.slice(cursorRef.current);
      cursorRef.current--;
      setCursor(cursorRef.current);
      return update(next);
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
      const next =
        valueRef.current.slice(0, cursorRef.current) +
        input +
        valueRef.current.slice(cursorRef.current);
      cursorRef.current += input.length;
      setCursor(cursorRef.current);
      update(next);
    }
  }, { isActive });
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box
        borderStyle="round"
        borderColor={isActive ? colors.primary : colors.border}
        paddingX={1}
        width={resolvedWidth}
      >
        <Text>{isActive ? <>
          {value.slice(0, cursor)}
          <Text inverse>{value[cursor] || ' '}</Text>
          {value.slice(cursor + 1)}
        </> : value || ' '}</Text>
      </Box>
    </Box>
  );
}

export function TagEditor({
  tags,
  initialValues,
  title = '编辑标签',
  onSubmit,
}: {
  tags: string[];
  initialValues: string[];
  title?: string;
  onSubmit: (tags: string[]) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialValues));
  const [focus, setFocus] = useState<'list' | 'input'>(tags.length ? 'list' : 'input');
  const [cursor, setCursor] = useState(0);
  const height = Math.max(3, stdout.rows - 13);
  const offset = Math.max(0, Math.min(cursor - Math.floor(height / 2), tags.length - height));
  const visible = tags.slice(offset, offset + height);
  const save = (input: string) => onSubmit([
    ...new Set([
      ...selected,
      ...input.split(',').map((tag) => tag.trim()).filter(Boolean),
    ]),
  ]);

  useInput((input, key) => {
    if (key.tab) {
      return setFocus((value) => tags.length && value === 'input' ? 'list' : 'input');
    }
    if (focus !== 'list') return;
    if (key.upArrow) return setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) {
      return setCursor((value) => Math.min(Math.max(0, tags.length - 1), value + 1));
    }
    if (input === ' ') {
      const tag = tags[cursor];
      if (!tag) return;
      return setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      });
    }
    if (key.return) save('');
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title} · 已选 {selected.size}</Text>
      <Text bold>已有标签</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={focus === 'list' ? colors.primary : colors.border}
        paddingX={1}
      >
        {visible.length ? visible.map((tag, index) => {
          const active = offset + index === cursor;
          return (
            <Text key={tag} {...(active && focus === 'list' ? { color: colors.primary } : {})}>
              {`${active ? '›' : ' '} ${selected.has(tag) ? '●' : '○'} ${tag}`}
            </Text>
          );
        }) : <Text color={colors.muted}>暂无已有标签</Text>}
      </Box>
      <TextInput
        label="新增标签（逗号分隔）"
        isActive={focus === 'input'}
        onSubmit={save}
      />
      <Text color={colors.muted}>
        ↑/↓ 移动 · Space 选择 · Tab 切换区域 · Enter 保存 · Esc 取消
      </Text>
    </Box>
  );
}

export interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  isActive = true,
}: {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isActive?: boolean;
}): ReactNode {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));
  useInput(
    (_input, key) => {
      if (key.leftArrow || (key.shift && key.tab)) {
        const previous = tabs[Math.max(0, activeIndex - 1)];
        if (previous) onTabChange(previous.key);
      }
      if (key.rightArrow || (key.tab && !key.shift)) {
        const next = tabs[Math.min(tabs.length - 1, activeIndex + 1)];
        if (next) onTabChange(next.key);
      }
    },
    { isActive }
  );
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        {tabs.map((tab, index) => (
          <Box key={tab.key}>
            <Text
              color={tab.key === activeTab ? colors.primary : colors.muted}
              bold={tab.key === activeTab}
              underline={tab.key === activeTab}
            >
              {tab.label}
            </Text>
            {index < tabs.length - 1 && <Text color={colors.border}> │ </Text>}
          </Box>
        ))}
      </Box>
      <Box borderStyle="round" borderColor={colors.border} paddingX={1}>
        {tabs.find((tab) => tab.key === activeTab)?.content}
      </Box>
    </Box>
  );
}

export const termcnColors = colors;

export interface SkillOption<T extends Skill> {
  skill: T;
  agent: string;
}

function SkillDetailPreview<T extends Skill>({
  skill,
  agent,
  note,
}: {
  skill: T;
  agent: string;
  note: string | undefined;
}): ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={colors.primary} bold>
        ‹ {skill.name}
      </Text>
      <Text color={colors.muted}>
        来自 {agent} · {skill.path}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>完整描述：</Text>
        <Text>{skill.description || '无'}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>备注：</Text>
        <Text>{note ?? '无'}</Text>
      </Box>
      <Text color={colors.muted}>←/Esc 返回 · Space 选择 · Enter 确认导入</Text>
    </Box>
  );
}

export function SkillMultiSelect<T extends Skill>({
  groups,
  label,
  collectionNote,
  onSubmit,
}: {
  groups: { agent: string; options: SkillOption<T>[] }[];
  label?: string;
  collectionNote?: (skill: T) => string | undefined;
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

  const height = Math.max(3, stdout.rows - 9);
  const clampedCursor = Math.max(0, Math.min(cursor, Math.max(0, options.length - 1)));
  const offset = Math.max(
    0,
    Math.min(clampedCursor - Math.floor(height / 2), Math.max(0, options.length - height))
  );
  const visible = options.slice(offset, offset + height);

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
      if (key.escape || key.leftArrow || (key.ctrl && input === 'c')) {
        setViewing(undefined);
        return;
      }
      if (key.return) {
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
    if (key.return) {
      submit();
      return;
    }
  });

  if (viewing) {
    return (
      <SkillDetailPreview
        skill={viewing}
        agent={activeAgent}
        note={collectionNote ? collectionNote(viewing) : undefined}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {label ?? '选择技能'} · 已选 {selected.size} / 共 {total}
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
      <Box flexDirection="column">
        {visible.length ? (
          visible.map((option, visibleIndex) => {
            const index = offset + visibleIndex;
            const isSelected = selected.has(option.skill.path);
            const isCursor = focus === 'list' && index === clampedCursor;
            return (
              <Box key={option.skill.path} gap={1} width="100%">
                <Text {...(isCursor ? { color: colors.primary } : {})}>
                  {isSelected ? '●' : '○'}
                </Text>
                <Box width={20}>
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
          ? `${offset + 1}–${Math.min(offset + height, options.length)} / ${options.length}`
          : `0 / 0`}
      </Text>
      <Text color={colors.muted}>
        {singleAgent
          ? '↑/↓ 移动 · Space 选择 · → 详情 · a 全选 · Enter 确认 · Esc 取消'
          : focus === 'tabs'
            ? '←/→ 切换 Agent · ↓ 返回技能列表 · Esc 取消'
            : '↑/↓ 移动 · Space 选择 · → 详情 · a 全选当前 · Enter 确认 · Esc 取消'}
      </Text>
    </Box>
  );
}
