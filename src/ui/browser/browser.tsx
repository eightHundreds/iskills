import { Box, Text, useInput, useStdout } from 'ink';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import type {
  BrowserFocus,
  BrowserResult,
  BrowserTab,
  BrowserViewInput,
  SkillGroup,
} from '../../contracts/browser.js';
import { matchesSkill } from '../../domain/skill-query.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import {
  browserNavigationAtom,
  browserSelectionAtom,
} from './browser-app-store.js';
import {
  browserFrameDimensions,
  detailFrameDimensions,
  masterDetailLayout,
  masterDetailSeparator,
  masterDetailViewportHeight,
  masterDetailWidths,
} from './browser-layout.js';
import {
  focusAfterDownFromAgents,
  focusAfterDownFromTabs,
  focusAfterUpFromList,
  focusAfterUpFromTags,
  nextAgent,
  nextMainTab,
} from './browser-intent.js';
import { skillFieldLabels } from '../skill-labels.js';
import {
  Modal,
  Select,
  Tabs,
  TextInput,
  termcnColors,
  type ModalBackgroundLine,
} from '../components/termcn.js';
import { padColumns, sliceColumns, textWidth, wrapColumns } from '../components/terminal-layout.js';

export {
  browserFrameDimensions,
  detailFrameDimensions,
  masterDetailLayout,
  type BrowserFrameDimensions,
} from './browser-layout.js';

interface BrowserConfirmation {
  title: string;
  message: string;
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}
type SkillRow =
  | { type: 'group'; name: string; skills: Skill[] }
  | { type: 'skill'; group: string; skill: Skill };

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % spinnerFrames.length);
    }, 80);
    return () => clearInterval(timer);
  }, [active]);
  return spinnerFrames[index] ?? '⠋';
}

const UNTAGGED_LABEL = '未标签';

function skillGroups(skill: Skill): string[] {
  return [...new Set(skill.tags?.length ? skill.tags : [UNTAGGED_LABEL])];
}

function groupedRows(skills: Skill[], query: string): SkillRow[] {
  if (query.trim()) {
    return skills
      .filter((skill) => matchesSkill(skill, query))
      .map((skill) => ({ type: 'skill', group: skillGroups(skill).join(' · '), skill }));
  }
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    for (const tag of skillGroups(skill)) {
      const group = groups.get(tag) ?? [];
      group.push(skill);
      groups.set(tag, group);
    }
  }
  const sorted = [...groups].sort(([left], [right]) => {
    if (left === right) return 0;
    return left === UNTAGGED_LABEL ? 1 : right === UNTAGGED_LABEL ? -1 : left.localeCompare(right);
  });
  if (sorted.length === 1 && sorted[0]?.[0] === UNTAGGED_LABEL) {
    return sorted[0][1].map((skill) => ({ type: 'skill', group: '', skill }));
  }
  const rows: SkillRow[] = [];
  for (const [name, group] of sorted) {
    rows.push({ type: 'group', name, skills: group });
    rows.push(...group.map((skill) => ({ type: 'skill' as const, group: name, skill })));
  }
  return rows;
}

function flatRows(skills: Skill[], query: string): SkillRow[] {
  return skills
    .filter((skill) => matchesSkill(skill, query))
    .map((skill) => ({ type: 'skill', group: '', skill }));
}

const TAG_FILTER_ALL = '__all__';

function skillsForTagFilter(skills: Skill[], tag: string): Skill[] {
  if (tag === TAG_FILTER_ALL) return skills;
  if (tag === UNTAGGED_LABEL) {
    return skills.filter((skill) => {
      const groups = skillGroups(skill);
      return groups.length === 1 && groups[0] === UNTAGGED_LABEL;
    });
  }
  return skills.filter((skill) => skillGroups(skill).includes(tag));
}

function tagFilterOptions(
  skills: Skill[],
  groups: Extract<SkillRow, { type: 'group' }>[]
): { key: string; label: string; skills: Skill[] }[] {
  return [
    { key: TAG_FILTER_ALL, label: '全部', skills },
    ...groups.map((group) => ({
      key: group.name,
      label: group.name,
      skills: group.skills,
    })),
  ];
}

function masterDetailBlankRow(
  tagWidth: number,
  listWidth: number,
  peekWidth: number
): ReactNode {
  const divider = '│';
  return (
    <Box flexDirection="row">
      <Box width={tagWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', tagWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </Box>
      <Box width={listWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', listWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </Box>
      <Box width={peekWidth}>
        <Text wrap="truncate-end">{padColumns('', peekWidth)}</Text>
      </Box>
    </Box>
  );
}

function listSkillSummary(skill: Skill, preferNote: boolean, maxColumns: number): string {
  const raw = (preferNote && skill.note?.trim()) || skill.description?.trim() || '';
  if (!raw || maxColumns <= 0) return '';
  if (textWidth(raw) <= maxColumns) return raw;
  return `${sliceColumns(raw, 0, Math.max(1, maxColumns - 1))}…`;
}

function selectableSkills(row: SkillRow): Skill[] {
  return row.type === 'group' ? row.skills : [row.skill];
}

interface DetailContentLine {
  label?: string;
  value: string;
  muted?: boolean;
}

function detailFieldLines(
  label: string,
  value: string,
  width: number,
  muted = false
): DetailContentLine[] {
  const labelText = `${label}  `;
  const indentation = ' '.repeat(textWidth(labelText));
  const valueWidth = Math.max(1, width - textWidth(labelText));
  return value
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapColumns(paragraph, valueWidth))
    .map((line, index) => index === 0
      ? { label: labelText, value: line, muted }
      : { value: `${indentation}${line}`, muted });
}

function detailContentLines(
  skill: Skill,
  metadata: SkillMetadata,
  links: SkillLink[],
  collection: boolean,
  source: string,
  frameWidth: number
): DetailContentLine[] {
  const width = Math.max(1, frameWidth - 4);
  const lines = detailFieldLines(skillFieldLabels.description, skill.description || '无描述', width, true);
  if (!collection) return [...lines, ...detailFieldLines(skillFieldLabels.location, skill.path, width)];

  lines.push(
    ...detailFieldLines(skillFieldLabels.tags, metadata.tags.length ? metadata.tags.join(', ') : '无', width),
    ...detailFieldLines(skillFieldLabels.note, metadata.note || '无', width),
    ...detailFieldLines(skillFieldLabels.source, source, width)
  );
  if (metadata.source.path) {
    lines.push(...detailFieldLines(skillFieldLabels.path, metadata.source.path, width));
  }
  lines.push({ label: skillFieldLabels.relatedLocations, value: '' });
  if (!links.length) return [...lines, { value: '  无', muted: true }];
  return [
    ...lines,
    ...links.flatMap((link) => detailFieldLines(
      link.kind === 'origin' ? '  原始' : link.kind === 'usage' ? '  使用' : '  依赖',
      link.path,
      width,
      true
    )),
  ];
}

function shortcutModalContent(): string[] {
  return [
    '↑/↓ 移动焦点或列表项',
    '←/→ 切换当前层级 Tab；收藏夹内 → 查看详情',
    'Space 选择当前技能或当前标签下全部技能',
    'Enter 查看、添加或提交当前选择',
    '/ 搜索技能',
    'g 跳转到分组（有分组时）',
    'i 加入收藏夹（当前项目/全局已选择本地技能时）',
    't 批量加标签（收藏夹已选择技能时）',
    's 同步 Git（收藏夹可同步时）',
    'u 更新可更新的已选技能；无选择时更新当前技能',
    'd/Delete 删除已选技能；无选择时删除当前技能',
    'm 更多操作（当前项目引用可转换时）',
    'q 退出 · Esc 取消当前上下文',
    '',
    'Esc 关闭',
  ];
}

function moreActionModalContent(scope: string): string[] {
  return [scope, '', '› 将引用转为副本'];
}

interface BrowserModal {
  title: string;
  content: string[];
  width: number;
  onEscape: () => void;
  muteLastContent?: boolean;
}

function SkillPane({
  rows,
  cursor,
  isActive,
  preferNote = false,
  compact = false,
  layout = 'default',
  columnWidth,
  showPagination = true,
  showSource = false,
  showReferences = false,
  showGroup = false,
  updates = new Set<string>(),
  updatingSkillName,
  modal,
  viewportHeight,
}: {
  rows: SkillRow[];
  cursor: number;
  isActive: boolean;
  preferNote?: boolean;
  compact?: boolean;
  layout?: 'default' | 'master';
  columnWidth?: number | undefined;
  showPagination?: boolean;
  showSource?: boolean;
  showReferences?: boolean;
  showGroup?: boolean;
  updates?: Set<string>;
  updatingSkillName?: string | undefined;
  modal?: BrowserModal | undefined;
  viewportHeight?: number | undefined;
}) {
  const { stdout } = useStdout();
  const selected = useAtomValue(browserSelectionAtom);
  const paneHeight = viewportHeight ?? Math.max(3, (stdout.rows ?? 24) - 8);
  const height = rows.length > paneHeight ? Math.max(3, paneHeight - (showPagination ? 1 : 0)) : paneHeight;
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  const paneWidth = columnWidth ?? Math.max(20, (stdout.columns ?? 80) - 4);
  const summaryWidth = Math.max(8, paneWidth - 4);
  const rowText = (row: SkillRow, index: number): string => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      return `${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`;
    }
    const skill = row.skill;
    const summary = compact || layout === 'master'
      ? ''
      : listSkillSummary(skill, preferNote, summaryWidth);
    const selectionMarker = selected.has(skill.path) ? '●' : '○';
    const name = showReferences && skill.isReference
      ? `引用 · ${skill.name}`
      : showSource && !skill.fromCollection
        ? `本地 · ${skill.name}`
        : skill.name;
    const group = showGroup && row.group ? `${row.group} / ` : '';
    const update = updatingSkillName === skill.name ? ' 更新中' : updates.has(skill.name) ? ' ↑' : '';
    return `  ${isActive && index === active ? '›' : ' '} ${selectionMarker} ${group}${name}${update}${summary ? ` — ${summary}` : ''}`;
  };
  const renderRow = (row: SkillRow, index: number) => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      return (
        <Text
          key={`group:${row.name}:${index}`}
          bold
          {...(isActive && index === active ? { color: termcnColors.primary } : {})}
        >
          {`${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`}
        </Text>
      );
    }
    const skill = row.skill;
    const current = isActive && index === active;
    const summary = compact || layout === 'master'
      ? ''
      : listSkillSummary(skill, preferNote, summaryWidth);
    const inlineSummary = summary;
    const selectionMarker = selected.has(skill.path) ? '●' : '○';
    const nameLine = (
      <>
        {`  ${current ? '›' : ' '} ${selectionMarker} `}
        {showGroup && row.group && (
          <Text color={termcnColors.muted}>{row.group} / </Text>
        )}
        {showReferences && skill.isReference ? (
          <>
            <Text color={termcnColors.muted}>引用 · </Text>
            <Text bold={current}>{skill.name}</Text>
          </>
        ) : showSource && !skill.fromCollection ? (
          `本地 · ${skill.name}`
        ) : (
          <Text bold={current}>{skill.name}</Text>
        )}
        {updatingSkillName === skill.name ? (
          <Text color={termcnColors.primary}> 更新中</Text>
        ) : updates.has(skill.name) ? (
          <Text color={termcnColors.primary}> ↑</Text>
        ) : null}
        {inlineSummary && (
          <Text color={termcnColors.muted}> — {inlineSummary}</Text>
        )}
      </>
    );
    return (
      <Text
        key={`${row.group}:${skill.path}:${index}`}
        wrap="truncate-end"
        {...(current ? { color: termcnColors.primary } : {})}
      >
        {nameLine}
      </Text>
    );
  };
  const backgroundLines: ModalBackgroundLine[] = visible.map((row, visibleIndex) => {
    const index = offset + visibleIndex;
    return { text: rowText(row, index), content: renderRow(row, index) };
  });
  return (
    <Box flexDirection="column" minHeight={3}>
      {modal ? (
        <Modal
          open
          title={modal.title}
          content={modal.content}
          width={modal.width}
          viewportWidth={paneWidth}
          viewportHeight={height}
          backgroundLines={backgroundLines}
          onEscape={modal.onEscape}
          {...(modal.muteLastContent ? { muteLastContent: true } : {})}
        />
      ) : rows.length ? (
        visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex))
      ) : (
        <Text color={termcnColors.muted}>没有匹配的技能</Text>
      )}
      {showPagination && rows.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, rows.length)} / {rows.length}
        </Text>
      )}
    </Box>
  );
}

function AgentTabs({
  groups,
  agent,
  focused,
}: {
  groups: SkillGroup[];
  agent: string;
  focused: boolean;
}) {
  return (
    <Box paddingLeft={1} gap={2}>
      {groups.map((group) => {
        const active = group.agent === agent;
        // Keyboard focus only: never use foreground/white for "current agent".
        // Unfocused row stays fully muted so switching main tabs does not look
        // like the agent row is already selected.
        const highlighted = focused && active;
        return (
          <Text
            key={group.agent}
            color={highlighted ? termcnColors.primary : termcnColors.muted}
            underline={highlighted}
          >
            {`${group.agent} ${group.skills.length}`}
          </Text>
        );
      })}
    </Box>
  );
}

function tagSidebarLine(
  current: boolean,
  marker: string,
  label: string,
  count: number,
  width: number
): string {
  const prefix = `${current ? '›' : ' '} ${marker} ${label}`;
  const countText = String(count);
  const gap = Math.max(1, width - textWidth(prefix) - textWidth(countText));
  return `${prefix}${' '.repeat(gap)}${countText}`;
}

function categorySidebarLine(
  current: boolean,
  label: string,
  count: number,
  width: number
): string {
  const prefix = current ? '› ' : '  ';
  const countText = String(count);
  const labelPart = `${prefix}${label}`;
  const gap = Math.max(1, width - textWidth(labelPart) - textWidth(countText));
  return padColumns(`${labelPart}${' '.repeat(gap)}${countText}`, width);
}

function collectionSourceLabel(skill: CollectedSkill): string {
  const source = skill.source;
  if (!source) return '未知';
  if (source.type === 'git' && source.url) return 'Git';
  if (source.type === 'local' || source.path) return '本地';
  if (source.type === 'unknown' && source.path) return '本地';
  if (source.type === 'unknown') return '本地';
  return source.type;
}

function collectionVersionLabel(skill: CollectedSkill): string | undefined {
  const version = skill.source?.commit ?? skill.source?.ref;
  return version?.trim() || undefined;
}

function collectionCategoryLines(
  options: { key: string; label: string; skills: Skill[] }[],
  cursor: number,
  isActive: boolean,
  width: number,
  viewportHeight: number
): string[] {
  const active = Math.max(0, Math.min(cursor, options.length - 1));
  const offset = Math.max(
    0,
    Math.min(active - Math.floor(viewportHeight / 2), options.length - viewportHeight)
  );
  const visible = options.slice(offset, offset + viewportHeight);
  const lines = visible.map((option, visibleIndex) => {
    const index = offset + visibleIndex;
    return categorySidebarLine(isActive && index === active, option.label, option.skills.length, width);
  });
  while (lines.length < viewportHeight) lines.push('');
  return lines.slice(0, viewportHeight);
}

function masterSkillNameLine(
  row: Extract<SkillRow, { type: 'skill' }>,
  index: number,
  active: number,
  isActive: boolean,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  showGroup: boolean
): string {
  const skill = row.skill;
  const current = isActive && index === active;
  const selectionMarker = selected.has(skill.path) ? '●' : '○';
  const update = updatingSkillName === skill.name
    ? ' 更新中'
    : updates.has(skill.name)
      ? ' ↑'
      : '';
  const group = showGroup && row.group ? `${row.group} / ` : '';
  return `${current ? '›' : ' '} ${selectionMarker} ${group}${skill.name}${update}`;
}

function masterTagColumnLines(
  options: { key: string; label: string; skills: Skill[] }[],
  _activeTag: string,
  cursor: number,
  isActive: boolean,
  selected: Set<string>,
  width: number,
  viewportHeight: number
): string[] {
  const active = Math.max(0, Math.min(cursor, options.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(viewportHeight / 2), options.length - viewportHeight));
  const visible = options.slice(offset, offset + viewportHeight);
  const lines = visible.map((option, visibleIndex) => {
    const index = offset + visibleIndex;
    const count = option.skills.filter((skill) => selected.has(skill.path)).length;
    const marker =
      count === 0 ? '○' : count === option.skills.length && option.skills.length ? '●' : '◐';
    const current = isActive && index === active;
    return tagSidebarLine(current, marker, option.label, option.skills.length, width);
  });
  while (lines.length < viewportHeight) lines.push('');
  return lines.slice(0, viewportHeight);
}

const COLLECTION_SKILL_PREFIX_WIDTH = 4;

function collectionSkillPrefix(current: boolean, picked: boolean): string {
  return `${current ? '›' : ' '} ${picked ? '▣' : ' '} `;
}

function collectionSkillNameLine(
  row: Extract<SkillRow, { type: 'skill' }>,
  index: number,
  active: number,
  isActive: boolean,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  listWidth: number
): string {
  const skill = row.skill;
  const current = isActive && index === active;
  const picked = selected.has(skill.path);
  const prefix = collectionSkillPrefix(current, picked);
  const badges = [
    updatingSkillName === skill.name ? '更新中' : updates.has(skill.name) ? '↑' : '',
  ].filter(Boolean);
  const badgeText = badges.length ? ` ${badges.join(' ')}` : '';
  return padColumns(`${prefix}${skill.name}${badgeText}`, listWidth);
}

function collectionListColumnLines(
  rows: SkillRow[],
  cursor: number,
  isActive: boolean,
  preferNote: boolean,
  listWidth: number,
  viewportHeight: number,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined
): { lines: string[]; skillOffset: number; activeLineIndexes: Set<number>; selectedLineIndexes: Set<number> } {
  const skillViewport = Math.max(1, Math.floor(viewportHeight / 2));
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const skillOffset = Math.max(
    0,
    Math.min(active - Math.floor(skillViewport / 2), Math.max(0, rows.length - skillViewport))
  );
  const visible = rows.slice(skillOffset, skillOffset + skillViewport);
  const summaryWidth = Math.max(8, listWidth - 2);
  const lines: string[] = [];
  const activeLineIndexes = new Set<number>();
  const selectedLineIndexes = new Set<number>();
  for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex += 1) {
    const row = visible[visibleIndex];
    if (row?.type !== 'skill') continue;
    const index = skillOffset + visibleIndex;
    const nameLineIndex = lines.length;
    lines.push(collectionSkillNameLine(
      row,
      index,
      active,
      isActive,
      selected,
      updates,
      updatingSkillName,
      listWidth
    ));
    const summary = listSkillSummary(row.skill, preferNote, summaryWidth);
    const summaryPrefix = ' '.repeat(COLLECTION_SKILL_PREFIX_WIDTH);
    lines.push(summary ? `${summaryPrefix}${summary}` : summaryPrefix);
    if (isActive && index === active) {
      activeLineIndexes.add(nameLineIndex);
      activeLineIndexes.add(nameLineIndex + 1);
    } else if (selected.has(row.skill.path)) {
      selectedLineIndexes.add(nameLineIndex);
    }
  }
  while (lines.length < viewportHeight) lines.push('');
  return {
    lines: lines.slice(0, viewportHeight),
    skillOffset,
    activeLineIndexes,
    selectedLineIndexes,
  };
}

function masterListColumnLines(
  rows: SkillRow[],
  cursor: number,
  isActive: boolean,
  preferNote: boolean,
  listWidth: number,
  viewportHeight: number,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  showGroup: boolean
): { lines: string[]; skillOffset: number } {
  const skillViewport = Math.max(1, Math.floor(viewportHeight / 2));
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const skillOffset = Math.max(
    0,
    Math.min(active - Math.floor(skillViewport / 2), Math.max(0, rows.length - skillViewport))
  );
  const visible = rows.slice(skillOffset, skillOffset + skillViewport);
  const summaryWidth = Math.max(8, listWidth - 2);
  const lines: string[] = [];
  for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex += 1) {
    const row = visible[visibleIndex];
    if (row?.type !== 'skill') continue;
    const index = skillOffset + visibleIndex;
    lines.push(masterSkillNameLine(
      row,
      index,
      active,
      isActive,
      selected,
      updates,
      updatingSkillName,
      showGroup
    ));
    const summary = listSkillSummary(row.skill, preferNote, summaryWidth);
    lines.push(summary ? `  ${summary}` : '  ');
  }
  while (lines.length < viewportHeight) lines.push('');
  return { lines: lines.slice(0, viewportHeight), skillOffset };
}

interface CollectionDetailRow {
  text: string;
  bold?: boolean;
  muted?: boolean;
  primary?: boolean;
}

function browseDetailRows(
  skill: Skill | undefined,
  width: number,
  viewportHeight: number,
  collection: boolean,
  updates: Set<string>,
  updatingSkillName: string | undefined
): CollectionDetailRow[] {
  if (!skill) {
    return [{ text: '选择技能查看', muted: true }];
  }
  const title = skill.isReference ? `引用 · ${skill.name}` : skill.name;
  const descriptionLines = peekFieldLines(
    '描述',
    skill.description || '无描述',
    width,
    Math.max(2, Math.floor(viewportHeight * 0.35))
  ).map((line) => ({ text: line, muted: true } satisfies CollectionDetailRow));
  const metadataRows: CollectionDetailRow[] = [
    {
      text: `${title}${
        updatingSkillName === skill.name
          ? ' 更新中'
          : updates.has(skill.name)
            ? ' ↑'
            : ''
      }`,
      bold: true,
      primary: true,
    },
    { text: '' },
  ];
  if (collection) {
    const collected = skill as CollectedSkill;
    const version = collectionVersionLabel(collected) ?? '--';
    metadataRows.push(
      ...peekFieldLines('来源', collectionSourceLabel(collected), width, 1).map((line) => ({
        text: line,
      })),
      ...peekFieldLines('版本', version, width, 1).map((line) => ({ text: line }))
    );
    const triggerTags = collected.tags?.length
      ? collected.tags.map((tag) => `[${tag}]`).join(' ')
      : '--';
    metadataRows.push(
      { text: '' },
      ...peekFieldLines('标签', triggerTags, width, 2).map((line) => ({
        text: line,
        muted: true,
      }))
    );
  } else {
    metadataRows.push(...peekFieldLines('位置', skill.path, width, 2).map((line) => ({ text: line })));
  }
  // 描述长度最不稳定，放在固定元数据之后，切换技能时上方字段位置不跳。
  // 不要用空行撑到视口底，否则看起来像「贴底」。
  return [...metadataRows, { text: '' }, ...descriptionLines].slice(0, viewportHeight);
}

function masterPeekColumnLines(
  skill: Skill | undefined,
  collection: boolean,
  width: number,
  viewportHeight: number
): string[] {
  if (!skill) {
    return Array.from({ length: viewportHeight }, (_, index) =>
      index === 0 ? '选择技能查看' : ''
    );
  }
  const tags = collection
    ? (skill as CollectedSkill).tags?.length
      ? (skill as CollectedSkill).tags!.join(', ')
      : '无'
    : skillGroups(skill).join(', ') || '无';
  const note = collection ? (skill as CollectedSkill).note?.trim() || '无' : '';
  const source = collection && (skill as CollectedSkill).source
    ? (skill as CollectedSkill).source!.url ?? (skill as CollectedSkill).source!.type
    : '';
  const descriptionBudget = Math.max(3, viewportHeight - (collection ? 8 : 6));
  const fields = [
    skill.name,
    ...peekFieldLines('描述', skill.description || '无描述', width, descriptionBudget),
    ...peekFieldLines('标签', tags, width, 1),
    ...(collection ? [
      ...peekFieldLines('备注', note, width, 1),
      ...peekFieldLines('来源', source || '无', width, 1),
    ] : [
      ...peekFieldLines('位置', skill.path, width, 2),
    ]),
    collection ? '→ 全屏详情 · Space 选中' : 'Enter 查看 · Space 选中',
  ];
  while (fields.length < viewportHeight) fields.push('');
  return fields.slice(0, viewportHeight);
}

function masterDetailColumnText(
  line: string,
  width: number,
  options: {
    color?: string;
    bold?: boolean;
    inverse?: boolean;
    muted?: boolean;
  } = {}
): ReactNode {
  const padded = padColumns(sliceColumns(line, 0, width), width);
  return (
    <Text
      wrap="truncate-end"
      {...(options.color ? { color: options.color } : {})}
      {...(options.bold ? { bold: true } : {})}
      {...(options.inverse ? { inverse: true } : {})}
      {...(options.muted ? { color: termcnColors.muted } : {})}
    >
      {padded}
    </Text>
  );
}

function MasterDetailBody({
  tagLines,
  listLines,
  peekLines,
  tagWidth,
  listWidth,
  peekWidth,
  tagActive,
  listActive,
  collectionHome = false,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
}: {
  tagLines: string[];
  listLines: string[];
  peekLines: string[];
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  tagActive: boolean;
  listActive: boolean;
  collectionHome?: boolean;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows?: CollectionDetailRow[];
}): ReactNode {
  const rows = Math.max(tagLines.length, listLines.length, peekLines.length);
  const divided = collectionHome;
  const divider = divided ? '│' : '';
  const tagColumnWidth = tagWidth + (divider ? 1 : 0);
  const listColumnWidth = listWidth + (divider ? 1 : 0);
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <Box key={`master-detail-row:${index}`} flexDirection="row">
          <Box width={tagColumnWidth} flexDirection="row">
            {masterDetailColumnText(tagLines[index] ?? '', tagWidth, {
              ...(tagActive && tagLines[index]?.startsWith('›')
                ? collectionHome
                  ? { inverse: true }
                  : { color: termcnColors.primary }
                : {}),
            })}
            {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
          </Box>
          <Box width={listColumnWidth} flexDirection="row">
            {masterDetailColumnText(listLines[index] ?? '', listWidth, {
              ...(listActiveLineIndexes?.has(index)
                ? { inverse: true }
                : listSelectedLineIndexes?.has(index)
                  ? { color: termcnColors.primary, bold: true }
                  : listActive && listLines[index]?.startsWith('›')
                    ? { color: termcnColors.primary, bold: true }
                    : index % 2 === 1 && listLines[index]?.trim()
                      ? { muted: true }
                      : {}),
            })}
            {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
          </Box>
          <Box width={peekWidth}>
            {detailRows?.[index] ? (
              <Text
                wrap="truncate-end"
                {...(detailRows[index]?.primary ? { color: termcnColors.primary } : {})}
                {...(detailRows[index]?.muted ? { color: termcnColors.muted } : {})}
                {...(detailRows[index]?.bold ? { bold: true } : {})}
              >
                {padColumns(sliceColumns(detailRows[index]?.text ?? '', 0, peekWidth), peekWidth)}
              </Text>
            ) : (
              <Text
                wrap="truncate-end"
                color={index === 0 && peekLines[index] !== '选择技能查看' ? termcnColors.primary : termcnColors.muted}
                bold={index === 0 && peekLines[index] !== '选择技能查看'}
              >
                {padColumns(sliceColumns(peekLines[index] ?? '', 0, peekWidth), peekWidth)}
              </Text>
            )}
          </Box>
        </Box>
      ))}
    </>
  );
}

function peekFieldLines(
  label: string,
  value: string,
  width: number,
  maxLines: number
): string[] {
  const labelWidth = 6;
  const valueWidth = Math.max(1, width - labelWidth);
  const lines = wrapColumns(value || '无', valueWidth).slice(0, maxLines);
  return lines.map((line, index) =>
    index === 0
      ? `${padColumns(`${label}`, labelWidth)}${line}`
      : `${' '.repeat(labelWidth)}${line}`
  );
}

function visibleAgentGroups(groups: SkillGroup[]): SkillGroup[] {
  return groups.filter((group) => group.skills.length > 0);
}

interface BrowserProps extends BrowserViewInput {
  confirmation?: BrowserConfirmation | undefined;
  finish: (result: BrowserResult) => void;
}

function BrowserContent({
  projectGroups,
  collection,
  globalGroups,
  canSync,
  status,
  transientStatus,
  checkUpdates,
  updatingSkillName,
  updatingProgress,
  workingAction = '更新',
  confirmation,
  finish,
}: Omit<BrowserProps, 'state'>) {
  const [navigation, setNavigationState] = useAtom(browserNavigationAtom);
  const [selected, setSelected] = useAtom(browserSelectionAtom);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  /** Keep ref in lockstep so multi-key stdin never reads a stale focus/tab. */
  const setNavigation = (
    value: Parameters<typeof setNavigationState>[0]
  ): void => {
    setNavigationState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      navigationRef.current = next;
      return next;
    });
  };
  const tab = navigation?.tab ?? 'project';
  const query = navigation?.query ?? '';
  const cursor = navigation?.cursor ?? 0;
  const agent = navigation?.agent ?? '';
  const focus = navigation?.focus ?? 'tabs';
  const [visibleStatus, setVisibleStatus] = useState(status);
  const visibleProjectGroups = useMemo(() => visibleAgentGroups(projectGroups), [projectGroups]);
  const visibleGlobalGroups = useMemo(() => visibleAgentGroups(globalGroups), [globalGroups]);
  const activeProjectAgent = visibleProjectGroups.some((group) => group.agent === agent)
    ? agent
    : visibleProjectGroups[0]?.agent ?? '';
  const activeGlobalAgent = visibleGlobalGroups.some((group) => group.agent === agent)
    ? agent
    : visibleGlobalGroups[0]?.agent ?? '';
  const activeAgent = tab === 'global' ? activeGlobalAgent : activeProjectAgent;
  const currentAgentGroups =
    tab === 'project' ? visibleProjectGroups : tab === 'global' ? visibleGlobalGroups : [];
  const hasAgentTabs = currentAgentGroups.length > 0;
  const project = projectGroups.flatMap((group) => group.skills);
  const projectGroup =
    visibleProjectGroups.find((group) => group.agent === activeProjectAgent) ??
    visibleProjectGroups[0];
  const projectRows = useMemo(
    () => groupedRows(projectGroup?.skills ?? [], query),
    [projectGroup, query]
  );
  const collectionRows = useMemo(() => groupedRows(collection, query), [collection, query]);
  const globalGroup =
    visibleGlobalGroups.find((group) => group.agent === activeGlobalAgent) ??
    visibleGlobalGroups[0];
  const globalRows = useMemo(
    () => flatRows(globalGroup?.skills ?? [], query),
    [globalGroup, query]
  );
  const rows = tab === 'project' ? projectRows : tab === 'global' ? globalRows : collectionRows;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const setTab = (value: BrowserTab): void => {
    setNavigation((current) => (current ? { ...current, tab: value } : current));
  };
  const setQuery = (value: string): void => {
    setNavigation((current) => (current ? { ...current, query: value } : current));
  };
  const setAgent = (value: string): void => {
    setNavigation((current) => (current ? { ...current, agent: value } : current));
  };
  const setFocus = (value: BrowserFocus): void => {
    setNavigation((current) => (current ? { ...current, focus: value } : current));
  };
  const setCursor = (value: SetStateAction<number>): void => {
    setNavigation((current) => {
      if (!current) return current;
      const nextCursor = typeof value === 'function' ? value(current.cursor) : value;
      cursorRef.current = nextCursor;
      return { ...current, cursor: nextCursor };
    });
  };
  const [searching, setSearching] = useState(false);
  const [choosingGroup, setChoosingGroup] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [removeConfirmation, setRemoveConfirmation] = useState<{
    scope: 'collection' | 'location';
    skills: Skill[];
  } | undefined>();
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(query);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
  const [updateCheck, setUpdateCheck] = useState<{
    checking: boolean;
    updates: Set<string>;
    failed: number;
  }>({ checking: false, updates: new Set(), failed: 0 });
  const updateSpinner = useSpinner(Boolean(updatingSkillName));
  useEffect(() => {
    setVisibleStatus(status);
    if (!status || !transientStatus) return undefined;
    const timer = setTimeout(() => setVisibleStatus(''), 3500);
    return () => clearTimeout(timer);
  }, [status, transientStatus]);
  const selectedCollection = collection.filter((skill) => selected.has(skill.path));
  const selectedUpdates = selectedCollection.filter((skill) => updateCheck.updates.has(skill.name));
  const selectedProject = project.filter((skill) => selected.has(skill.path));
  const selectedGlobal = globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path))
  );
  const selectedProjectLocal = project.filter(
    (skill) => selected.has(skill.path) && !skill.fromCollection
  );
  const selectedGlobalLocal = globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path) && !skill.fromCollection)
  );
  const global = globalGroups.flatMap((group) => group.skills);
  const groupRows = useMemo(
    () => groupedRows(
      tab === 'project' ? project : tab === 'global' ? global : collection,
      ''
    ),
    [collection, global, project, tab]
  );
  const groups = groupRows.filter(
    (row): row is Extract<SkillRow, { type: 'group' }> => row.type === 'group'
  );
  const { stdout } = useStdout();
  const useBrowseHome =
    masterDetailLayout(stdout.columns, stdout.rows) &&
    !query.trim();
  const useMasterDetail = useBrowseHome;
  const tabSkills =
    tab === 'collection'
      ? collection
      : tab === 'project'
        ? projectGroup?.skills ?? []
        : tab === 'global'
          ? globalGroup?.skills ?? []
          : [];
  const tagOptions = useMemo(
    () => tagFilterOptions(tabSkills, groups),
    [groups, tabSkills]
  );
  const [tagFilter, setTagFilter] = useState(TAG_FILTER_ALL);
  const [tagCursor, setTagCursor] = useState(0);
  const masterDetailSkills = useMemo(
    () => skillsForTagFilter(tabSkills, tagFilter),
    [tabSkills, tagFilter]
  );
  const masterDetailRows = useMemo(
    () => flatRows(masterDetailSkills, query),
    [masterDetailSkills, query]
  );
  const listRows = useMasterDetail ? masterDetailRows : rows;
  const currentRow = listRows[cursor];
  const actionSkills = tab === 'project'
    ? selectedProject.length
      ? selectedProject
      : currentRow?.type === 'skill'
        ? [currentRow.skill]
        : []
    : [];
  const canOpenActions =
    !updatingSkillName &&
    focus === 'list' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) {
      setCursor(0);
      setSelected(new Set());
      setTagFilter(TAG_FILTER_ALL);
      setTagCursor(0);
      previousTab.current = tab;
    }
  }, [tab]);
  const previousAgent = useRef(agent);
  useEffect(() => {
    if (previousAgent.current !== agent) {
      setCursor(0);
      previousAgent.current = agent;
    }
  }, [agent]);
  useEffect(() => {
    if (focus === 'agents' && !hasAgentTabs) setFocus(useMasterDetail ? 'tags' : 'list');
  }, [focus, hasAgentTabs, useMasterDetail]);
  const checkedUpdates = useRef(false);
  useEffect(() => {
    if (tab !== 'collection' || checkedUpdates.current) return;
    checkedUpdates.current = true;
    let active = true;
    setUpdateCheck((current) => ({ ...current, checking: true }));
    void checkUpdates(collection)
      .then(({ updates, failed }) => {
        if (active) setUpdateCheck({ checking: false, updates, failed });
      })
      .catch(() => {
        if (active) setUpdateCheck({ checking: false, updates: new Set(), failed: collection.length });
      });
    return () => {
      active = false;
    };
  }, [checkUpdates, collection, tab]);

  const openDetail = (skill: Skill, collection: boolean) =>
    finish({
      type: 'open',
      skill,
      collection,
      frameHeight: frame.frameHeight,
      frameWidth: frame.frameWidth,
    });
  const localConfirmation: BrowserConfirmation | undefined = removeConfirmation
    ? removeConfirmation.scope === 'collection'
      ? {
          title: '删除收藏',
          message: removeConfirmation.skills.length === 1
            ? `从收藏夹移除 ${removeConfirmation.skills[0]?.name ?? ''} 吗？`
            : `从收藏夹移除 ${removeConfirmation.skills.length} 个技能吗？`,
          details: removeConfirmation.skills.length > 1
            ? [`技能：${removeConfirmation.skills.map((skill) => skill.name).join(', ')}`]
            : [],
          onConfirm: () => {
            const skills = removeConfirmation.skills as CollectedSkill[];
            setRemoveConfirmation(undefined);
            finish({ type: 'removeCollection', skills });
          },
          onCancel: () => setRemoveConfirmation(undefined),
        }
      : {
          title: '删除技能',
          message: removeConfirmation.skills.length === 1
            ? `删除 ${removeConfirmation.skills[0]?.name ?? ''} 的当前位置吗？`
            : `删除所选 ${removeConfirmation.skills.length} 个技能位置吗？`,
          details: [
            '将永久删除以下位置；收藏夹内容（如有）保留。',
            ...removeConfirmation.skills.map((skill) => skill.path),
          ],
          onConfirm: () => {
            const skills = removeConfirmation.skills;
            setRemoveConfirmation(undefined);
            finish({ type: 'removeLocations', skills });
          },
          onCancel: () => setRemoveConfirmation(undefined),
        }
    : undefined;
  const activeConfirmation = confirmation ?? localConfirmation;
  const frame = browserFrameDimensions({
    rows: stdout.rows,
    columns: stdout.columns,
    projectRows: projectRows.length,
    globalRows: globalRows.length,
    collectionRows: collectionRows.length,
    hasProjectAgents: visibleProjectGroups.length > 0,
    hasGlobalAgents: visibleGlobalGroups.length > 0,
  });
  const agentPaneViewportHeight = Math.max(3, frame.frameHeight - 3);
  const collectionPaneViewportHeight = Math.max(3, frame.frameHeight - 2);
  const masterDetailInnerWidth = Math.max(40, frame.frameWidth - 2);
  const masterDetailColumns = masterDetailWidths(masterDetailInnerWidth, useBrowseHome);
  const masterDetailBrowseHeight = (withAgents: boolean): number =>
    masterDetailViewportHeight(stdout.rows, 1 + 2 + 3 + (withAgents ? 1 : 0));
  const browseViewportHeight = (withAgents: boolean): number =>
    useMasterDetail
      ? masterDetailBrowseHeight(withAgents)
      : withAgents
        ? agentPaneViewportHeight
        : collectionPaneViewportHeight;
  const masterListVisibleHeight = Math.max(1, Math.floor(masterDetailBrowseHeight(false) / 2));
  const masterListOffset = useMasterDetail
    ? Math.max(
        0,
        Math.min(
          cursor - Math.floor(masterListVisibleHeight / 2),
          Math.max(0, listRows.length - masterListVisibleHeight)
        )
      )
    : 0;
  const listScrollHint = useBrowseHome && listRows.length
    ? `${cursor + 1}/${listRows.length}`
    : useMasterDetail && listRows.length > masterListVisibleHeight
      ? `${masterListOffset + 1}–${Math.min(masterListOffset + masterListVisibleHeight, listRows.length)} / ${listRows.length}`
      : '';
  const peekSkill =
    focus === 'list' && currentRow?.type === 'skill' ? currentRow.skill : undefined;
  const modal: BrowserModal | undefined = activeConfirmation
    ? {
        title: ` ${activeConfirmation.title} `,
        content: [
          activeConfirmation.message,
          ...(activeConfirmation.details?.length ? activeConfirmation.details : []),
          '(y/N)',
        ],
        width: Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6)),
        onEscape: activeConfirmation.onCancel,
        muteLastContent: true,
      }
    : showActions
      ? {
          title: ' 更多操作 ',
          content: moreActionModalContent(
            selectedProject.length
              ? `已选择 ${actionSkills.length} 个技能`
              : `技能：${actionSkills[0]?.name ?? ''}`
          ),
          width: Math.min(64, Math.max(36, (stdout.columns ?? 80) - 6)),
          onEscape: () => setShowActions(false),
        }
      : showShortcuts
        ? {
            title: ' 完整快捷键 ',
            content: shortcutModalContent(),
            width: Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6)),
            onEscape: () => setShowShortcuts(false),
          }
        : undefined;
  useInput(
    (input, key) => {
      const choice = input.trim().toLowerCase();
      if (choice === 'y') return activeConfirmation?.onConfirm();
      if (choice === 'n' || key.return) {
        return activeConfirmation?.onCancel();
      }
    },
    { isActive: Boolean(activeConfirmation) }
  );
  useInput(
    (input, key) => {
      if (key.return || input.includes('\r') || input.includes('\n')) {
        setShowActions(false);
        return finish({ type: 'materialize', skills: actionSkills });
      }
    },
    { isActive: showActions && !activeConfirmation }
  );
  useEffect(() => {
    if (focus === 'tags' && !useMasterDetail) setFocus('list');
  }, [focus, useMasterDetail, setFocus]);
  useInput(
    (input, key) => {
      const live = navigationRef.current;
      const liveFocus = live?.focus ?? 'tabs';
      const liveTab = live?.tab ?? 'project';
      if (input === '?') return setShowShortcuts(true);
      if (key.escape || input === 'q') return finish({ type: 'quit' });
      if (input === '/') {
        setQueryBeforeSearch(query);
        setCursorBeforeSearch(cursorRef.current);
        return setSearching(true);
      }
      if (input === 'g' && groups.length) {
        return setChoosingGroup(true);
      }
      if (input === 's' && liveTab === 'collection' && canSync) {
        return finish({ type: 'sync' });
      }
      // Focus ladder + tab/agent switching: always branch on the live ref so
      // multi-key stdin batches each advance from the latest navigation.
      if (key.downArrow || key.upArrow || key.leftArrow || key.rightArrow) {
        if (liveFocus === 'tabs' || liveFocus === 'agents' || liveFocus === 'tags') {
          const direction = key.leftArrow ? -1 : key.rightArrow ? 1 : 0;
          setNavigation((current) => {
            if (!current) return current;
            const groups =
              current.tab === 'project'
                ? visibleProjectGroups
                : current.tab === 'global'
                  ? visibleGlobalGroups
                  : [];
            const hasAgents = groups.length > 0;
            const names = groups.map((group) => group.agent);
            if (current.focus === 'tabs') {
              if (key.downArrow) {
                return {
                  ...current,
                  focus: focusAfterDownFromTabs(hasAgents, useMasterDetail),
                };
              }
              if (key.leftArrow || key.rightArrow) {
                const next = nextMainTab(current.tab, direction as -1 | 1);
                return next ? { ...current, tab: next } : current;
              }
              return current;
            }
            if (current.focus === 'agents') {
              if (key.upArrow) return { ...current, focus: 'tabs' };
              if (key.downArrow) {
                return {
                  ...current,
                  focus: focusAfterDownFromAgents(useMasterDetail),
                };
              }
              if (key.leftArrow || key.rightArrow) {
                const next = nextAgent(names, current.agent || names[0] || '', direction as -1 | 1);
                return next ? { ...current, agent: next } : current;
              }
              return current;
            }
            if (current.focus === 'tags') {
              if (key.downArrow) return { ...current, focus: 'list' };
              if (key.upArrow) return { ...current, focus: focusAfterUpFromTags(hasAgents) };
              if (key.leftArrow) return { ...current, focus: focusAfterUpFromTags(hasAgents) };
              if (key.rightArrow) return { ...current, focus: 'list' };
            }
            return current;
          });
          // Tag index moves stay on the tags-local path below when still on tags.
          if (liveFocus !== 'tags' || key.leftArrow || key.rightArrow) return;
          if (key.downArrow || key.upArrow) {
            // After functional update, live ref may already be list/tabs.
            if (navigationRef.current?.focus !== 'tags') return;
          }
        }
      }
      if (liveFocus === 'tabs' || liveFocus === 'agents') {
        return;
      }
      if (liveFocus === 'tags' || focus === 'tags') {
        const selectTag = (index: number): void => {
          const option = tagOptions[index];
          if (!option) return;
          setTagFilter(option.key);
          setTagCursor(index);
          setCursor(0);
        };
        if (key.upArrow) {
          if (tagCursor === 0) return setFocus(focusAfterUpFromTags(hasAgentTabs));
          selectTag(tagCursor - 1);
          return;
        }
        if (key.downArrow) {
          if (tagCursor >= tagOptions.length - 1) return setFocus('list');
          selectTag(tagCursor + 1);
          return;
        }
        if (key.leftArrow) return setFocus(focusAfterUpFromTags(hasAgentTabs));
        if (key.rightArrow) {
          selectTag(tagCursor);
          return setFocus('list');
        }
        const tagOption = tagOptions[tagCursor];
        if (input === ' ' && tagOption) {
          const paths = tagOption.skills.map((skill) => skill.path);
          return setSelected((previous) => {
            const next = new Set(previous);
            const allSelected = paths.every((path) => previous.has(path));
            for (const path of paths) allSelected ? next.delete(path) : next.add(path);
            return next;
          });
        }
        if (key.return || input.includes('\r') || input.includes('\n')) {
          selectTag(tagCursor);
          return setFocus('list');
        }
        return;
      }
      if ((navigationRef.current?.focus ?? focus) !== 'list') return;
      const row = listRows[cursorRef.current];
      if (input === 'm' && canOpenActions) return setShowActions(true);
      if (input === 'u' && (navigationRef.current?.tab ?? tab) === 'collection') {
        const updateable = selectedCollection.length
          ? selectedUpdates
          : row?.type === 'skill' && updateCheck.updates.has(row.skill.name)
            ? [row.skill as CollectedSkill]
            : [];
        if (updateable.length) {
          return finish({ type: 'update', skills: updateable });
        }
      }
      if (input === 't' && tab === 'collection' && selectedCollection.length) {
        return finish({ type: 'tags', skills: selectedCollection });
      }
      const removableCollection = tab === 'collection'
        ? selectedCollection.length
          ? selectedCollection
          : row?.type === 'skill'
            ? [row.skill as CollectedSkill]
            : []
        : [];
      const removableLocations = tab === 'project'
        ? selectedProject.length
          ? selectedProject
          : row?.type === 'skill'
            ? [row.skill]
            : []
        : tab === 'global'
          ? selectedGlobal.length
            ? selectedGlobal
            : row?.type === 'skill'
              ? [row.skill]
              : []
          : [];
      if ((input === 'd' || key.delete) && removableCollection.length) {
        setShowShortcuts(false);
        return setRemoveConfirmation({ scope: 'collection', skills: removableCollection });
      }
      if ((input === 'd' || key.delete) && removableLocations.length) {
        setShowShortcuts(false);
        return setRemoveConfirmation({ scope: 'location', skills: removableLocations });
      }
      const selectedLocal = tab === 'project' ? selectedProjectLocal : selectedGlobalLocal;
      if (input === 'i' && tab !== 'collection' && selectedLocal.length) {
        return finish({ type: 'import', skills: selectedLocal });
      }
      if (key.leftArrow && useMasterDetail) return setFocus('tags');
      if (key.upArrow) {
        if (cursorRef.current === 0) {
          return setFocus(focusAfterUpFromList(useMasterDetail, hasAgentTabs));
        }
        return setCursor((index) => index - 1);
      }
      if (key.downArrow) {
        return setCursor((index) => Math.min(Math.max(0, listRows.length - 1), index + 1));
      }
      if (input === ' ' && row) {
        const paths = selectableSkills(row).map((skill) => skill.path);
        if (!paths.length) return;
        return setSelected((previous) => {
          const next = new Set(previous);
          const allSelected = paths.every((path) => previous.has(path));
          for (const path of paths) allSelected ? next.delete(path) : next.add(path);
          return next;
        });
      }
      if (key.rightArrow && row?.type === 'skill' && !useBrowseHome) {
        if (tab === 'collection') return openDetail(row.skill, true);
        if (row.skill.fromCollection) return openDetail(row.skill, true);
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ type: 'add', skills: selectedCollection });
        }
        if (tab === 'collection' && row?.type === 'skill') {
          return openDetail(row.skill, true);
        }
        if (tab !== 'collection') {
          if (row?.type === 'skill') openDetail(row.skill, false);
        }
      }
    },
    {
      isActive:
        !searching &&
        !choosingGroup &&
        !modal &&
        !updatingSkillName &&
        !activeConfirmation,
    }
  );
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        setChoosingGroup(false);
      }
    },
    { isActive: choosingGroup }
  );

  const renderBrowsePane = (
    paneRows: SkillRow[],
    viewportHeight: number,
    options: {
      preferNote?: boolean;
      showSource?: boolean;
      showReferences?: boolean;
      showGroup?: boolean;
      collection?: boolean;
      updates?: Set<string>;
      updatingSkillName?: string | undefined;
    } = {}
  ): ReactNode => {
    if (useBrowseHome) {
      const { tagWidth, listWidth, peekWidth } = masterDetailColumns;
      const chromeHeight = viewportHeight + 3;
      const selectedPaths = selected;
      if (modal) {
        return (
          <Modal
            open
            title={modal.title}
            content={modal.content}
            width={modal.width}
            viewportWidth={masterDetailInnerWidth}
            viewportHeight={chromeHeight}
            backgroundLines={Array.from({ length: chromeHeight }, (_, index) => ({
              text: '',
              content: <Text key={`master-detail-modal-bg:${index}`}> </Text>,
            }))}
            onEscape={modal.onEscape}
            {...(modal.muteLastContent ? { muteLastContent: true } : {})}
          />
        );
      }
      const tagLines = collectionCategoryLines(
        tagOptions,
        tagCursor,
        focus === 'tags',
        tagWidth,
        viewportHeight
      );
      const {
        lines: listLines,
        activeLineIndexes: listActiveLineIndexes,
        selectedLineIndexes: listSelectedLineIndexes,
      } = collectionListColumnLines(
        paneRows,
        cursor,
        focus === 'list',
        options.preferNote ?? false,
        listWidth,
        viewportHeight,
        selectedPaths,
        options.updates ?? new Set<string>(),
        options.updatingSkillName
      );
      const detailRows = browseDetailRows(
        peekSkill,
        peekWidth,
        viewportHeight,
        options.collection ?? false,
        options.updates ?? new Set<string>(),
        options.updatingSkillName
      );
      const headerLine = (left: string, middle: string, right: string): ReactNode => (
        <Box flexDirection="row">
          <Box width={tagWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(left, tagWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </Box>
          <Box width={listWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(middle, listWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </Box>
          <Box width={peekWidth}>
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(right, peekWidth)}
            </Text>
          </Box>
        </Box>
      );
      return (
        <Box flexDirection="column">
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'top', true)}
          </Text>
          {headerLine('标签', '技能', '详情')}
          {masterDetailBlankRow(tagWidth, listWidth, peekWidth)}
          <MasterDetailBody
            tagLines={tagLines}
            listLines={listLines}
            peekLines={[]}
            tagWidth={tagWidth}
            listWidth={listWidth}
            peekWidth={peekWidth}
            tagActive={focus === 'tags'}
            listActive={focus === 'list'}
            collectionHome
            {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
            {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
            detailRows={detailRows}
          />
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'bottom', true)}
          </Text>
        </Box>
      );
    }
    return (
      <SkillPane
        rows={paneRows}
        cursor={cursor}
        isActive={focus === 'list'}
        viewportHeight={viewportHeight}
        modal={modal}
        {...options}
      />
    );
  };

  const tabs = [
    {
      key: 'project',
      label: `当前项目 ${project.length}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleProjectGroups}
            agent={activeProjectAgent}
            focused={!searching && !modal && focus === 'agents'}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showReferences: true,
            showGroup: Boolean(query.trim()),
          })}
        </Box>
      ),
    },
    {
      key: 'global',
      label: `全局 ${globalGroups.reduce((count, group) => count + group.skills.length, 0)}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleGlobalGroups}
            agent={activeGlobalAgent}
            focused={!searching && !modal && focus === 'agents'}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showGroup: Boolean(query.trim()),
          })}
        </Box>
      ),
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          {renderBrowsePane(listRows, browseViewportHeight(false), {
            preferNote: true,
            collection: true,
            showGroup: Boolean(query.trim()),
            updates: updateCheck.updates,
            updatingSkillName,
          })}
        </Box>
      ),
    },
  ];

  if (choosingGroup) {
    return (
      <Select
        label="跳转到分组："
        numbered
        options={groups.map((group) => ({
          label: `${group.name} (${group.skills.length})`,
          value: group.name,
        }))}
        onSubmit={(name) => {
          if (useMasterDetail) {
            const index = tagOptions.findIndex((option) => option.key === name);
            setTagFilter(name);
            setTagCursor(Math.max(0, index));
            setCursor(0);
            setFocus('list');
          } else {
            setQuery('');
            setCursor(groupRows.findIndex((row) => row.type === 'group' && row.name === name));
            setFocus('list');
          }
          setChoosingGroup(false);
        }}
      />
    );
  }

  const canViewWithRightArrow =
    currentRow?.type === 'skill' && (tab === 'collection' || currentRow.skill.fromCollection);
  const canViewWithEnter =
    currentRow?.type === 'skill' && tab !== 'collection' && !canViewWithRightArrow;
  const canDelete =
    (tab === 'collection' && selectedCollection.length > 0) ||
    (tab === 'project' && selectedProject.length > 0) ||
    (tab === 'global' && selectedGlobal.length > 0) ||
    currentRow?.type === 'skill';
  const actions = updatingSkillName ? [] : [
    canOpenActions ? 'm 更多操作' : '',
    tab === 'project' && selectedProjectLocal.length ? 'i 加入收藏夹' : '',
    tab === 'global' && selectedGlobalLocal.length ? 'i 加入收藏夹' : '',
    tab === 'collection' && selectedCollection.length ? 'Enter 添加 · t 批量加标签' : '',
    tab === 'collection' && !updatingSkillName && selectedCollection.length && selectedUpdates.length
      ? `u 更新可更新的已选技能 (${selectedUpdates.length})`
      : tab === 'collection' && !updatingSkillName && !selectedCollection.length
        && currentRow?.type === 'skill' && updateCheck.updates.has(currentRow.skill.name)
      ? 'u 更新当前技能'
      : '',
  ].filter(Boolean);
  const activity = [
    updatingSkillName
      ? `${updateSpinner} 正在${workingAction}${updatingProgress &&
        (workingAction === '转换' || updatingProgress.total > 1)
        ? ` ${updatingProgress.current}/${updatingProgress.total}`
        : ''}：${updatingSkillName}`
      : '',
    updateCheck.checking ? '正在检查更新…' : '',
    !updateCheck.checking && updateCheck.failed ? `${updateCheck.failed} 个技能检查失败` : '',
    visibleStatus,
    query ? `搜索：${query}` : '',
  ].filter(Boolean);
  const navigationHint = updatingSkillName
    ? `正在${workingAction} · 请稍候`
    : activeConfirmation
      ? '等待确认'
      : showActions
        ? 'Enter 执行 · Esc 返回'
        : showShortcuts
          ? 'Esc 关闭'
          : focus === 'tabs'
            ? `←/→ 切换 Tab · ↓ 进入 · / 筛选 · ?`
            : focus === 'agents'
              ? `←/→ 切换 Agent · ↑ 返回 · ↓ 进入 · / 筛选 · ?`
              : focus === 'tags'
                ? useBrowseHome
                  ? `↑/↓ 标签 · Space 选中此标签 · → 列表 · / 搜索 · ?`
                  : `↑/↓ 标签 · Space 选中此标签 · → 列表 · / 筛选 · ?`
                : useBrowseHome && focus === 'list'
                  ? tab === 'collection' && selectedCollection.length
                    ? `↑↓ 移动 · Enter 添加 · Space 选中 · d 删除 · / 搜索 · ?`
                    : `↑↓ 移动 · Enter 详情 · Space 选中 · d 删除 · / 搜索 · ?`
                  : useMasterDetail && canViewWithRightArrow
                  ? `← 标签 · Space 选中 · → 全屏详情 · d 删除 · / 筛选 · ?`
                  : useMasterDetail && canViewWithEnter
                    ? `← 标签 · Space 选中 · Enter 查看 · d 删除 · / 筛选 · ?`
                    : useMasterDetail
                      ? `← 标签 · Space 选中 · d 删除 · / 筛选 · ?`
                      : currentRow?.type === 'group'
                        ? `↑/↓ 移动 · Space 选中组 · / 筛选 · ?`
                        : canViewWithRightArrow
                          ? `↑/↓ 移动 · Space 选中 · → 查看 · d 删除 · / 筛选 · ?`
                          : canViewWithEnter
                            ? `↑/↓ 移动 · Space 选中 · Enter 查看 · d 删除 · / 筛选 · ?`
                            : canDelete
                              ? `↑/↓ 移动 · Space 选中 · d 删除 · / 筛选 · ?`
                              : focus === 'list'
                                ? `↑/↓ 移动 · Space 选中 · / 筛选 · ?`
                                : `/ 筛选 · ?`;
  const footerBody = [
    listScrollHint,
    navigationHint,
    selected.size ? `已选 ${selected.size}` : '',
    ...actions,
  ].filter(Boolean).join(' · ');
  const footerHint = footerBody ? `${footerBody} · q 退出` : 'q 退出';
  const statusHint = activity.filter(Boolean).join(' · ');

  return (
    <Box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as BrowserTab)}
        isActive={!searching && !modal && focus === 'tabs'}
        enableArrowNav={false}
        focused={!searching && !modal && focus === 'tabs'}
        width={frame.frameWidth}
        bordered={false}
        chip={useBrowseHome}
        trailing={
          useMasterDetail && !searching && !modal ? (
            <Text color={termcnColors.muted}>/ 搜索技能…</Text>
          ) : undefined
        }
      />
      {searching ? (
        <TextInput
          label="搜索技能（Enter 确认，Esc 取消）"
          initialValue={query}
          onChange={(value) => {
            setQuery(value);
            setCursor(0);
          }}
          onCancel={() => {
            setQuery(queryBeforeSearch);
            setCursor(cursorBeforeSearch);
            setSearching(false);
          }}
          onSubmit={(value) => {
            setQuery(value);
            setSearching(false);
          }}
        />
      ) : (
        <Box flexDirection="column">
          <Text color={termcnColors.muted} wrap="truncate-end">
            {footerHint}
          </Text>
          {statusHint ? (
            <Text
              color={updateCheck.failed ? termcnColors.error : termcnColors.muted}
              wrap="truncate-end"
            >
              {statusHint}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

/**
 * Pure browser view. Navigation/selection must live in a parent Jotai Provider
 * (BrowserApp store). Does not create a nested store.
 */
export function Browser({ state: _state, ...props }: BrowserProps) {
  return <BrowserContent {...props} />;
}

export type DetailAction = 'note' | 'tags' | 'source' | 'back';

export function Detail({
  skill,
  metadata,
  links,
  collection,
  frameHeight,
  frameWidth,
  finish,
}: {
  skill: Skill;
  metadata: SkillMetadata;
  links: SkillLink[];
  collection: boolean;
  frameHeight: number;
  frameWidth: number;
  finish: (action: DetailAction) => void;
}) {
  const { stdout } = useStdout();
  const detailFrame = detailFrameDimensions(frameHeight, frameWidth, stdout.rows);
  const [detailOffset, setDetailOffset] = useState(0);
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  const lines = detailContentLines(skill, metadata, links, collection, source, detailFrame.width);
  const viewportHeight = Math.max(1, detailFrame.height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(detailOffset, maxOffset);
  const visibleLines = lines.slice(offset, offset + viewportHeight);
  useInput((input, key) => {
    if (key.upArrow && maxOffset) {
      setDetailOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow && maxOffset) {
      setDetailOffset((current) => Math.min(maxOffset, current + 1));
      return;
    }
    if (
      key.escape ||
      key.leftArrow ||
      input === 'b' ||
      input === 'q'
    ) {
      return finish('back');
    }
    if (collection && input === 'n') return finish('note');
    if (collection && input === 't') return finish('tags');
    if (collection && input === 's') return finish('source');
  });
  return (
    <Box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {skill.name}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={termcnColors.border}
        paddingX={1}
        height={detailFrame.height}
        width={detailFrame.width}
        overflow="hidden"
      >
        {visibleLines.map((line, index) => (
          <Text
            key={`${offset + index}:${line.label ?? ''}:${line.value}`}
            {...(line.muted ? { color: termcnColors.muted } : {})}
          >
            {line.label && <Text bold>{line.label}</Text>}{line.value}
          </Text>
        ))}
      </Box>
      <Text color={termcnColors.muted}>
        {`${maxOffset ? '↑/↓ 滚动 · ' : ''}${collection ? 'n 备注 · t 标签 · s 来源 · Esc 返回' : 'Esc 返回'}`}
      </Text>
    </Box>
  );
}

