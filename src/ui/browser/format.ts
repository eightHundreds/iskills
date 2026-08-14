/**
 * Pure view formatting + focus ladder (no React TUI components).
 * Column/row strings, filters, modal copy, detail text model.
 */
import type { BrowserFocus, BrowserTab, DetailFieldId, SkillGroup } from './types.js';
import { matchesSkill } from '../../domain/skill-query.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import { skillFieldLabels } from '../skill-labels.js';
import { t } from '../../i18n/index.js';
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
export function untaggedLabel(): string {
  return t('common.untagged');
}

export function skillGroups(skill: Skill): string[] {
  return [...new Set(skill.tags?.length ? skill.tags : [untaggedLabel()])];
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
    return left === untaggedLabel() ? 1 : right === untaggedLabel() ? -1 : left.localeCompare(right);
  });
  if (sorted.length === 1 && sorted[0]?.[0] === untaggedLabel()) {
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
  if (tag === untaggedLabel()) {
    return skills.filter((skill) => {
      const groups = skillGroups(skill);
      return groups.length === 1 && groups[0] === untaggedLabel();
    });
  }
  return skills.filter((skill) => skillGroups(skill).includes(tag));
}

export function tagFilterOptions(
  skills: Skill[],
  groups: Extract<SkillRow, { type: 'group' }>[]
): { key: string; label: string; skills: Skill[] }[] {
  return [
    { key: TAG_FILTER_ALL, label: t('common.all'), skills },
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
  const lines = detailFieldLines(skillFieldLabels().description, skill.description || t('common.noDescription'), width, true);
  if (!collection) {
    return [
      ...lines,
      ...detailFieldLines(skillFieldLabels().location, skill.path, width),
      ...detailFieldLines(
        skillFieldLabels().collectionStatus,
        skill.fromCollection ? t('browser.inCollection') : t('browser.notInCollection'),
        width
      ),
    ];
  }

  lines.push(
    ...detailFieldLines(skillFieldLabels().tags, metadata.tags.length ? metadata.tags.join(', ') : t('common.none'), width),
    ...detailFieldLines(skillFieldLabels().note, metadata.note || t('common.none'), width),
    ...detailFieldLines(skillFieldLabels().source, source, width)
  );
  if (metadata.source.path) {
    lines.push(...detailFieldLines(skillFieldLabels().path, metadata.source.path, width));
  }
  lines.push({ label: skillFieldLabels().relatedLocations, value: '' });
  if (!links.length) return [...lines, { value: t('common.noneIndented'), muted: true }];
  return [
    ...lines,
    ...links.flatMap((link) => detailFieldLines(
      link.kind === 'origin' ? t('common.originIndented') : link.kind === 'usage' ? t('common.usageIndented') : t('common.dependentIndented'),
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
      title: t('browser.helpNav'),
      items: [
        { label: t('browser.helpNavMove'), keys: '↑/↓' },
        { label: t('browser.helpNavTab'), keys: '←/→' },
        { label: t('browser.helpNavDetail'), keys: '→' },
        { label: t('browser.helpNavFilter'), keys: '/' },
        { label: t('browser.helpNavGroup'), keys: 'g' },
      ],
    },
    {
      id: 'select',
      title: t('browser.helpSelect'),
      items: [
        { label: t('browser.helpSelectToggle'), keys: 'Space' },
        { label: t('browser.helpSelectEnter'), keys: 'Enter' },
      ],
    },
    {
      id: 'collect',
      title: t('browser.helpCollect'),
      items: [
        { label: t('browser.helpCollectImport'), keys: 'i' },
      ],
    },
    {
      id: 'maintain',
      title: t('browser.helpMaintain'),
      items: [
        { label: t('browser.helpMaintainTag'), keys: 't' },
        { label: t('browser.helpMaintainUpdate'), keys: 'u' },
        { label: t('browser.helpMaintainMore'), keys: 'm' },
        { label: t('browser.helpMaintainSync'), keys: 's' },
        { label: t('browser.helpMaintainDelete'), keys: 'd' },
      ],
    },
    {
      id: 'global',
      title: t('browser.helpGlobal'),
      items: [
        { label: t('browser.helpGlobalHelp'), keys: '?' },
        { label: t('browser.helpGlobalQuit'), keys: 'q' },
        { label: t('browser.helpGlobalEsc'), keys: 'Esc' },
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
  return [scope, '', `› ${t('browser.materializeAction')}`];
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

const GIT_HOST_BRANDS: Readonly<Record<string, string>> = {
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'bitbucket.org': 'Bitbucket',
  'codeberg.org': 'Codeberg',
  'gitee.com': 'Gitee',
};

/**
 * Compact git origin for peek panel, e.g. `GitHub: mattpocock/skills`.
 * Falls back to plain `Git` when the URL cannot be parsed into host + path.
 */
export function formatGitSourceLabel(url: string): string {
  const scp = !url.includes('://') ? url.match(/^(?:[^@]+@)?([^:]+):(.+)$/) : null;
  const candidate = scp ? `ssh://${scp[1]}/${scp[2]}` : url;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'file:') {
      const filePath = decodeURIComponent(parsed.pathname).replace(/\.git\/?$/i, '').replace(/\/$/, '');
      return filePath ? `file: ${filePath}` : t('common.git');
    }
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    let path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!host || !path) return t('common.git');
    // GitHub repos are always owner/repo; drop tree/blob/extra segments if present.
    if (host === 'github.com') {
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) path = `${parts[0]}/${parts[1]}`;
    }
    const brand = GIT_HOST_BRANDS[host] ?? host;
    return `${brand}: ${path}`;
  } catch {
    return t('common.git');
  }
}

export function collectionSourceLabel(skill: CollectedSkill): string {
  const source = skill.source;
  if (!source) return t('common.unknown');
  if (source.type === 'git' && source.url) return formatGitSourceLabel(source.url);
  if (source.type === 'local' || source.path) return t('common.local');
  if (source.type === 'unknown' && source.path) return t('common.local');
  if (source.type === 'unknown') return t('common.local');
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
    const lines = [padColumns(t('browser.noMatchingSkills'), listWidth)];
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

/**
 * Fixed label column width for the master-detail peek pane.
 * Must fit the longest field label in the active locale (en: "Description")
 * plus a gap so label and value do not run together.
 */
export function detailLabelWidth(): number {
  const labels = [
    t('common.source'),
    t('common.version'),
    t('common.tags'),
    t('common.note'),
    t('common.location'),
    t('common.collectionStatus'),
    t('common.description'),
  ];
  return Math.max(6, ...labels.map((label) => textWidth(label))) + 1;
}

/** Label + value rows for the master-detail peek column (label column is fixed-width). */
export function peekFieldRows(
  label: string,
  value: string,
  width: number,
  maxLines: number,
  options: { mutedValue?: boolean; field?: DetailFieldId } = {}
): CollectionDetailRow[] {
  const valueWidth = Math.max(1, width - detailLabelWidth());
  const lines = wrapColumns(value || t('common.none'), valueWidth).slice(0, maxLines);
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
    return [{ text: t('browser.selectSkillToView'), muted: true }];
  }
  const title = skill.isReference ? t('browser.referenceName', { name: skill.name }) : skill.name;
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
    const note = collected.note?.trim() || t('common.none');
    // Compact metadata block: no interstitial blanks so fields share one visual group.
    rows.push(
      ...peekFieldRows(t('common.source'), collectionSourceLabel(collected), width, 1),
      ...peekFieldRows(t('common.version'), version, width, 1),
      ...peekFieldRows(t('common.tags'), triggerTags, width, 2, { field: 'tags' }),
      ...peekFieldRows(t('common.note'), note, width, 2, { field: 'note' })
    );
  } else {
    // Project / global: location + whether this path is already in the collection (realpath).
    rows.push(
      ...peekFieldRows(t('common.location'), skill.path, width, 2),
      ...peekFieldRows(
        t('common.collectionStatus'),
        skill.fromCollection ? t('browser.inCollection') : t('browser.notInCollection'),
        width,
        1
      )
    );
  }
  // One blank before description; description is secondary and length-variable.
  // 不要用空行撑到视口底，否则看起来像「贴底」。
  const descriptionBudget = Math.max(2, Math.floor(viewportHeight * 0.35));
  return [
    ...rows,
    { text: '' },
    ...peekFieldRows(t('common.description'), skill.description || t('common.noDescription'), width, descriptionBudget, {
      mutedValue: true,
    }),
  ].slice(0, viewportHeight);
}

export function visibleAgentGroups(groups: SkillGroup[]): SkillGroup[] {
  return groups.filter((group) => group.skills.length > 0);
}
