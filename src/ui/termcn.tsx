import { Box, Text, useInput, useStdout } from 'ink';
import { useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Skill } from '../types.js';

const colors = {
  primary: '#7C3AED',
  foreground: '#FFFFFF',
  muted: '#9CA3AF',
  border: '#4B5563',
  error: '#EF4444',
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}

function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
}

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

function visibleOptionCount(rows: number, label?: string) {
  return Math.max(3, rows - (label ? 5 : 4));
}

function skillNameColumnWidth(options: { skill: Skill }[], columns: number): number {
  const longestName = options.reduce(
    (longest, option) => Math.max(longest, graphemes(option.skill.name).length),
    0
  );
  const minimumDescriptionWidth = columns >= 90 ? 32 : columns >= 70 ? 24 : columns >= 50 ? 14 : 0;
  const availableNameWidth = Math.max(12, columns - 4 - minimumDescriptionWidth);
  return Math.max(12, Math.min(Math.max(20, longestName), availableNameWidth));
}

function collectionStatusLabel(status: Skill['collectionStatus']): string {
  if (status === 'same-source') return '已收藏自同一来源';
  if (status === 'same-name') return '已收藏同名技能';
  return '';
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

// Copy-owned replacements for the three @inkjs/ui components used here (Select,
// MultiSelect, ConfirmInput). @inkjs/ui does not declare `react` as a dependency
// or peer dependency, so under pnpm's isolated node_modules it can resolve a
// different React copy than ink, producing "Invalid hook call" / duplicate-React
// crashes (Cannot read properties of null (reading 'useContext')). Reimplementing
// on top of ink primitives keeps every hook on the single React instance ink uses.

interface InternalOption {
  value: string;
  label: string;
}

interface WindowState {
  focus: number;
  from: number;
}

type WindowAction = { type: 'next' | 'previous'; length: number; count: number };

// Uses a reducer (like @inkjs/ui) so that keypresses dispatched in quick
// succession accumulate against the latest state instead of a stale closure.
function windowReducer(state: WindowState, action: WindowAction): WindowState {
  const focus = Math.min(state.focus, Math.max(0, action.length - 1));
  if (action.type === 'next') {
    const next = Math.min(action.length - 1, focus + 1);
    const from = next >= state.from + action.count ? next - action.count + 1 : state.from;
    return { focus: next, from };
  }
  const previous = Math.max(0, focus - 1);
  const from = previous < state.from ? previous : state.from;
  return { focus: previous, from };
}

function useScrollWindow(length: number, visibleCount: number) {
  const count = Math.max(1, Math.min(visibleCount, Math.max(1, length)));
  const [state, dispatch] = useReducer(windowReducer, { focus: 0, from: 0 });
  const focus = Math.min(state.focus, Math.max(0, length - 1));
  const from = Math.max(0, Math.min(state.from, Math.max(0, length - count)));
  return {
    count,
    focus,
    from,
    focusNext: () => dispatch({ type: 'next', length, count }),
    focusPrevious: () => dispatch({ type: 'previous', length, count }),
  };
}

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

function OptionSelect({
  options,
  visibleCount,
  onChange,
}: {
  options: InternalOption[];
  visibleCount: number;
  onChange: (value: string) => void;
}): ReactNode {
  const { count, focus, from, focusNext, focusPrevious } = useScrollWindow(
    options.length,
    visibleCount
  );
  useInput((input, key) => {
    if (key.downArrow) return focusNext();
    if (key.upArrow) return focusPrevious();
    if (isReturn(input, key.return)) {
      const option = options[focus];
      if (option) onChange(option.value);
    }
  });
  const visible = options.slice(from, from + count);
  return (
    <Box flexDirection="column">
      {visible.map((option, index) => {
        const isFocused = from + index === focus;
        return (
          <Box key={option.value} gap={1} paddingLeft={isFocused ? 0 : 2}>
            {isFocused && <Text color={colors.primary}>❯</Text>}
            <Text {...(isFocused ? { color: colors.primary } : {})}>{option.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function OptionMultiSelect({
  options,
  visibleCount,
  defaultValue = [],
  onSubmit,
}: {
  options: InternalOption[];
  visibleCount: number;
  defaultValue?: string[];
  onSubmit: (values: string[]) => void;
}): ReactNode {
  const { count, focus, from, focusNext, focusPrevious } = useScrollWindow(
    options.length,
    visibleCount
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultValue));
  useInput((input, key) => {
    if (key.downArrow) return focusNext();
    if (key.upArrow) return focusPrevious();
    if (input === ' ') {
      const option = options[focus];
      if (!option) return;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
      return;
    }
    if (isReturn(input, key.return)) {
      if (selected.size) {
        onSubmit(
          options.filter((option) => selected.has(option.value)).map((option) => option.value)
        );
      }
    }
  });
  const visible = options.slice(from, from + count);
  return (
    <Box flexDirection="column">
      {visible.map((option, index) => {
        const isFocused = from + index === focus;
        const isSelected = selected.has(option.value);
        return (
          <Box key={option.value} gap={1} paddingLeft={isFocused ? 0 : 2}>
            {isFocused && <Text color={colors.primary}>❯</Text>}
            <Text color={isFocused || isSelected ? colors.primary : colors.muted}>
              {isSelected ? '●' : '○'}
            </Text>
            <Text {...(isFocused ? { color: colors.primary, bold: true } : {})}>
              {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
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
      <OptionSelect
        visibleCount={visibleOptionCount(stdout.rows ?? 24, label)}
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
  defaultValues = [],
  onSubmit,
}: {
  label?: string;
  options: Option<T>[];
  defaultValues?: T[];
  onSubmit: (values: T[]) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const inkOptions = useMemo(() => toInkOptions(options), [options]);
  const defaultValue = options.flatMap((option, index) =>
    defaultValues.includes(option.value) ? [String(index)] : []
  );
  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <OptionMultiSelect
        defaultValue={defaultValue}
        visibleCount={visibleOptionCount(stdout.rows ?? 24, label)}
        options={inkOptions}
        onSubmit={(values) => onSubmit(resolveOptionValues(options, values))}
      />
      <Text color={colors.muted}>Space/空格 勾选 · Enter 确认 · Esc 取消</Text>
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
    <Text>
      <Text color={colors.primary}>? </Text>
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
  const update = (next: string) => {
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
    const value = next.join('');
    update(value);
    return value;
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
    // ponytail: Ink 6 reports the usual terminal Backspace (DEL) as Delete too.
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
        borderColor={isActive ? colors.primary : colors.border}
        paddingX={1}
        width={resolvedWidth}
      >
        <Text>{isActive ? <>
            {parts.slice(0, cursor).join('')}
            <Text inverse>{parts[cursor] || ' '}</Text>
            {parts.slice(cursor + 1).join('')}
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
  const height = Math.max(3, (stdout.rows ?? 24) - 13);
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
    if (isReturn(input, key.return)) save('');
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
  enableArrowNav = true,
  focused = false,
}: {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isActive?: boolean;
  enableArrowNav?: boolean;
  focused?: boolean;
}): ReactNode {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));
  useInput(
    (_input, key) => {
      if (enableArrowNav) {
        if (key.leftArrow || (key.shift && key.tab)) {
          const previous = tabs[Math.max(0, activeIndex - 1)];
          if (previous) onTabChange(previous.key);
        }
        if (key.rightArrow || (key.tab && !key.shift)) {
          const next = tabs[Math.min(tabs.length - 1, activeIndex + 1)];
          if (next) onTabChange(next.key);
        }
        return;
      }
      if (key.tab && !key.shift) {
        const next = tabs[Math.min(tabs.length - 1, activeIndex + 1)];
        if (next) onTabChange(next.key);
      }
      if (key.shift && key.tab) {
        const previous = tabs[Math.max(0, activeIndex - 1)];
        if (previous) onTabChange(previous.key);
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
              inverse={focused && tab.key === activeTab}
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

export interface ImportReviewItem<T extends Skill> {
  skill: T;
  detail: string;
}

export interface ImportReviewResult {
  confirmed: boolean;
  tags: string[];
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
      {collectionStatusLabel(skill.collectionStatus) && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>收藏状态：</Text>
          <Text>{collectionStatusLabel(skill.collectionStatus)}</Text>
        </Box>
      )}
      <Text color={colors.muted}>Esc 返回 · Space 选择 · Enter 确认导入</Text>
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

  const nameColumnWidth = skillNameColumnWidth(options, stdout.columns ?? 80);
  const height = Math.max(3, (stdout.rows ?? 24) - 9);
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
            const status = collectionStatusLabel(option.skill.collectionStatus);
            const description = [option.skill.description, status].filter(Boolean).join(' · ');
            return (
              <Box key={option.skill.path} gap={1} width="100%">
                <Text {...(isCursor ? { color: colors.primary } : {})}>
                  {isSelected ? '●' : '○'}
                </Text>
                <Box width={nameColumnWidth} flexShrink={0}>
                  <Text wrap="truncate-end" bold={isCursor}>
                    {option.skill.name}
                  </Text>
                </Box>
                <Box flexGrow={1} overflow="hidden">
                  <Text wrap="truncate-end" color={colors.muted}>
                    {description}
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
            borderColor={tagFocus === 'list' ? colors.primary : colors.border}
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
