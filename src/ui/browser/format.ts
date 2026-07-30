/**
 * Pure view formatting + focus ladder (no React TUI components).
 * Column/row strings, filters, modal copy, detail text model.
 */
import type { BrowserFocus, BrowserTab, DetailFieldId, SkillGroup } from './types.js';
import { matchesSkill } from '../../domain/skill-query.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import { skillFieldLabels } from '../skill-labels.js';
import { padColumns, sliceColumns, textWidth, wrapColumns } from '../components/terminal-layout.js';


// ─── focus ladder (was browser-intent) ──────────────────────────────────────

export type BrowseFocusLevel = BrowserFocus;

export function focusAfterDownFromTabs(hasAgentTabs: boolean, useMasterDetail: boolean): BrowserFocus {
  if (hasAgentTabs) return 'agents';
  if (useMasterDetail) return 'tags';
  return 'list';
}

export function focusAfterUpFromList(useMasterDetail: boolean, hasAgentTabs: boolean): BrowserFocus {
  if (useMasterDetail) return 'tags';
  return hasAgentTabs ? 'agents' : 'tabs';
}

export function focusAfterUpFromTags(hasAgentTabs: boolean): BrowserFocus {
  return hasAgentTabs ? 'agents' : 'tabs';
}

export function focusAfterDownFromAgents(useMasterDetail: boolean): BrowserFocus {
  return useMasterDetail ? 'tags' : 'list';
}

/** Editable fields in the right peek column (collection only). */
export function detailEditableFields(collection: boolean): DetailFieldId[] {
  return collection ? ['tags', 'note'] : [];
}

export function nextMainTab(tab: BrowserTab, direction: -1 | 1): BrowserTab | undefined {
  const order: BrowserTab[] = ['project', 'global', 'collection'];
  const index = order.indexOf(tab);
  return order[index + direction];
}

export function nextAgent(
  agents: string[],
  current: string,
  direction: -1 | 1
): string | undefined {
  const index = agents.indexOf(current);
  if (index < 0) return agents[0];
  return agents[index + direction];
}

// ─── list / column formatting ───────────────────────────────────────────────

export type SkillRow =
  | { type: 'group'; name: string; skills: Skill[] }
  | { type: 'skill'; group: string; skill: Skill };
export const UNTAGGED_LABEL = '未标签';

export function skillGroups(skill: Skill): string[] {
  return [...new Set(skill.tags?.length ? skill.tags : [UNTAGGED_LABEL])];
}

export function groupedRows(skills: Skill[], query: string): SkillRow[] {
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

export function flatRows(skills: Skill[], query: string): SkillRow[] {
  return skills
    .filter((skill) => matchesSkill(skill, query))
    .map((skill) => ({ type: 'skill', group: '', skill }));
}

export const TAG_FILTER_ALL = '__all__';

export function skillsForTagFilter(skills: Skill[], tag: string): Skill[] {
  if (tag === TAG_FILTER_ALL) return skills;
  if (tag === UNTAGGED_LABEL) {
    return skills.filter((skill) => {
      const groups = skillGroups(skill);
      return groups.length === 1 && groups[0] === UNTAGGED_LABEL;
    });
  }
  return skills.filter((skill) => skillGroups(skill).includes(tag));
}

export function tagFilterOptions(
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
export function listSkillSummary(skill: Skill, preferNote: boolean, maxColumns: number): string {
  const raw = (preferNote && skill.note?.trim()) || skill.description?.trim() || '';
  if (!raw || maxColumns <= 0) return '';
  if (textWidth(raw) <= maxColumns) return raw;
  return `${sliceColumns(raw, 0, Math.max(1, maxColumns - 1))}…`;
}

export function selectableSkills(row: SkillRow): Skill[] {
  return row.type === 'group' ? row.skills : [row.skill];
}

export interface DetailContentLine {
  label?: string;
  value: string;
  muted?: boolean;
}

export function detailFieldLines(
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

export function detailContentLines(
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

/** One shortcut binding for the interactive help panel. */
export interface ShortcutHelpItem {
  label: string;
  keys: string;
}

/** Expandable group in the shortcut help tree. */
export interface ShortcutHelpSection {
  id: string;
  title: string;
  items: ShortcutHelpItem[];
}

/**
 * Shortcut help catalog (description left / keys right in the panel).
 * Style: ◆/› groups with expand-collapse, like common TUI shortcut browsers.
 */
export function shortcutHelpSections(): ShortcutHelpSection[] {
  return [
    {
      id: 'nav',
      title: '导航',
      items: [
        { label: '移动焦点或列表项', keys: '↑/↓' },
        { label: '切换当前层级 Tab', keys: '←/→' },
        { label: '窄屏打开详情（三栏右栏即预览，不进全屏）', keys: '→' },
        { label: '筛选技能', keys: '/' },
        { label: '跳转分组（有分组时）', keys: 'g' },
      ],
    },
    {
      id: 'select',
      title: '选择',
      items: [
        { label: '切换选中（标签列：该标签下全部）', keys: 'Space' },
        { label: '添加已选；窄屏打开详情（三栏右栏即预览）', keys: 'Enter' },
      ],
    },
    {
      id: 'collect',
      title: '收藏与安装',
      items: [
        { label: '加入收藏夹（项目 / 全局已选本地技能）', keys: 'i' },
      ],
    },
    {
      id: 'maintain',
      title: '维护',
      items: [
        { label: '批量加标签（收藏夹已选）', keys: 't' },
        { label: '更新：已选可更新者，否则当前项', keys: 'u' },
        { label: '更多操作 · 引用转副本（项目软链）', keys: 'm' },
        { label: '同步收藏夹 Git（可同步时）', keys: 's' },
        { label: '删除已选；无已选则删除当前项', keys: 'd' },
      ],
    },
    {
      id: 'global',
      title: '全局',
      items: [
        { label: '打开本帮助', keys: '?' },
        { label: '退出浏览器', keys: 'q' },
        { label: '取消最内层上下文', keys: 'Esc' },
      ],
    },
  ];
}

/** Flat lines for simple info panels / tests (expanded, no tree chrome). */
export function shortcutModalContent(): string[] {
  const lines: string[] = [];
  for (const section of shortcutHelpSections()) {
    lines.push(`${section.title} ${'─'.repeat(Math.max(4, 40 - section.title.length))}`);
    for (const item of section.items) {
      lines.push(` ${item.keys.padEnd(8)} ${item.label}`);
    }
  }
  return lines;
}

export function moreActionModalContent(scope: string): string[] {
  return [scope, '', '› 将引用转为副本'];
}
export function tagSidebarLine(
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

export function categorySidebarLine(
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

export function collectionSourceLabel(skill: CollectedSkill): string {
  const source = skill.source;
  if (!source) return '未知';
  if (source.type === 'git' && source.url) return 'Git';
  if (source.type === 'local' || source.path) return '本地';
  if (source.type === 'unknown' && source.path) return '本地';
  if (source.type === 'unknown') return '本地';
  return source.type;
}

export function collectionVersionLabel(skill: CollectedSkill): string | undefined {
  const version = skill.source?.commit ?? skill.source?.ref;
  return version?.trim() || undefined;
}

export function collectionCategoryLines(
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

export function masterSkillNameLine(
  row: Extract<SkillRow, { type: 'skill' }>,
  index: number,
  active: number,
  isActive: boolean,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  showGroup: boolean,
  /** Animated spinner glyph when `updatingSkillName` matches (e.g. "⠋"). */
  updatingFrame = '⠋'
): string {
  const skill = row.skill;
  const current = isActive && index === active;
  const selectionMarker = selected.has(skill.path) ? '●' : '○';
  const update = updatingSkillName === skill.name
    ? ` ${updatingFrame}`
    : updates.has(skill.name)
      ? ' ↑'
      : '';
  const group = showGroup && row.group ? `${row.group} / ` : '';
  return `${current ? '›' : ' '} ${selectionMarker} ${group}${skill.name}${update}`;
}

export function masterTagColumnLines(
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

export const COLLECTION_SKILL_PREFIX_WIDTH = 4;

export function collectionSkillPrefix(current: boolean, picked: boolean): string {
  return `${current ? '›' : ' '} ${picked ? '▣' : ' '} `;
}

export function collectionSkillNameLine(
  row: Extract<SkillRow, { type: 'skill' }>,
  index: number,
  active: number,
  isActive: boolean,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  listWidth: number,
  updatingFrame = '⠋'
): string {
  const skill = row.skill;
  const current = isActive && index === active;
  const picked = selected.has(skill.path);
  const prefix = collectionSkillPrefix(current, picked);
  const badges = [
    updatingSkillName === skill.name ? updatingFrame : updates.has(skill.name) ? '↑' : '',
  ].filter(Boolean);
  const badgeText = badges.length ? ` ${badges.join(' ')}` : '';
  return padColumns(`${prefix}${skill.name}${badgeText}`, listWidth);
}

export function collectionListColumnLines(
  rows: SkillRow[],
  cursor: number,
  isActive: boolean,
  preferNote: boolean,
  listWidth: number,
  viewportHeight: number,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  updatingFrame = '⠋'
): { lines: string[]; skillOffset: number; activeLineIndexes: Set<number>; selectedLineIndexes: Set<number> } {
  const activeLineIndexes = new Set<number>();
  const selectedLineIndexes = new Set<number>();
  if (rows.length === 0) {
    const lines = [padColumns('没有匹配的技能', listWidth)];
    while (lines.length < viewportHeight) lines.push('');
    return {
      lines: lines.slice(0, viewportHeight),
      skillOffset: 0,
      activeLineIndexes,
      selectedLineIndexes,
    };
  }
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
    const nameLineIndex = lines.length;
    lines.push(collectionSkillNameLine(
      row,
      index,
      active,
      isActive,
      selected,
      updates,
      updatingSkillName,
      listWidth,
      updatingFrame
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

export function masterListColumnLines(
  rows: SkillRow[],
  cursor: number,
  isActive: boolean,
  preferNote: boolean,
  listWidth: number,
  viewportHeight: number,
  selected: Set<string>,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  showGroup: boolean,
  updatingFrame = '⠋'
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
      showGroup,
      updatingFrame
    ));
    const summary = listSkillSummary(row.skill, preferNote, summaryWidth);
    lines.push(summary ? `  ${summary}` : '  ');
  }
  while (lines.length < viewportHeight) lines.push('');
  return { lines: lines.slice(0, viewportHeight), skillOffset };
}

export interface CollectionDetailRow {
  /** Value text, or full-line text when `label` is omitted. */
  text: string;
  /** Optional field label; rendered muted and left-padded to a fixed width. */
  label?: string;
  bold?: boolean;
  /** Mute the value (or whole line when no label). Labels are always muted. */
  muted?: boolean;
  primary?: boolean;
  /** Marks a focusable field row in the right column (all wrapped lines share id). */
  field?: DetailFieldId;
}

export const DETAIL_LABEL_WIDTH = 6;

/** Label + value rows for the master-detail peek column (label column is fixed-width). */
export function peekFieldRows(
  label: string,
  value: string,
  width: number,
  maxLines: number,
  options: { mutedValue?: boolean; field?: DetailFieldId } = {}
): CollectionDetailRow[] {
  const valueWidth = Math.max(1, width - DETAIL_LABEL_WIDTH);
  const lines = wrapColumns(value || '无', valueWidth).slice(0, maxLines);
  return lines.map((line, index) => ({
    text: line,
    label: index === 0 ? label : '',
    ...(options.mutedValue ? { muted: true } : {}),
    ...(options.field ? { field: options.field } : {}),
  }));
}

export function browseDetailRows(
  skill: Skill | undefined,
  width: number,
  viewportHeight: number,
  collection: boolean,
  updates: Set<string>,
  updatingSkillName: string | undefined,
  updatingFrame = '⠋'
): CollectionDetailRow[] {
  if (!skill) {
    return [{ text: '选择技能查看', muted: true }];
  }
  const title = skill.isReference ? `引用 · ${skill.name}` : skill.name;
  const rows: CollectionDetailRow[] = [
    {
      text: `${title}${
        updatingSkillName === skill.name
          ? ` ${updatingFrame}`
          : updates.has(skill.name)
            ? ' ↑'
            : ''
      }`,
      bold: true,
      ...(updatingSkillName === skill.name ? { primary: true } : {}),
    },
  ];
  if (collection) {
    const collected = skill as CollectedSkill;
    const version = collectionVersionLabel(collected) ?? '--';
    const triggerTags = collected.tags?.length
      ? collected.tags.map((tag) => `[${tag}]`).join(' ')
      : '--';
    const note = collected.note?.trim() || '无';
    // Compact metadata block: no interstitial blanks so fields share one visual group.
    rows.push(
      ...peekFieldRows('来源', collectionSourceLabel(collected), width, 1),
      ...peekFieldRows('版本', version, width, 1),
      ...peekFieldRows('标签', triggerTags, width, 2, { field: 'tags' }),
      ...peekFieldRows('备注', note, width, 2, { field: 'note' })
    );
  } else {
    rows.push(...peekFieldRows('位置', skill.path, width, 2));
  }
  // One blank before description; description is secondary and length-variable.
  // 不要用空行撑到视口底，否则看起来像「贴底」。
  const descriptionBudget = Math.max(2, Math.floor(viewportHeight * 0.35));
  return [
    ...rows,
    { text: '' },
    ...peekFieldRows('描述', skill.description || '无描述', width, descriptionBudget, {
      mutedValue: true,
    }),
  ].slice(0, viewportHeight);
}

export function masterPeekColumnLines(
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
    collection ? 'Space 选中' : 'Enter 查看 · Space 选中',
  ];
  while (fields.length < viewportHeight) fields.push('');
  return fields.slice(0, viewportHeight);
}
export function peekFieldLines(
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

export function visibleAgentGroups(groups: SkillGroup[]): SkillGroup[] {
  return groups.filter((group) => group.skills.length > 0);
}
