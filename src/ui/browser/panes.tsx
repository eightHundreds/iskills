/**
 * Shared browse panes used by the skill collection and MCP collection.
 * Presentational only — callers own data, focus, and actions.
 */
import type { MouseEvent } from '@opentui/core';
import { Text, useStdout } from '../tui/index.js';
import { useCallback, type ReactNode } from 'react';
import type { DetailActionId, DetailFieldId } from './types.js';
import {
  collectionCategoryLines,
  detailLabelWidth,
  listSkillSummary,
  type BrowseListItem,
  type BrowseTagOption,
  type CollectionDetailFieldRow,
  type CollectionDetailRow,
  type SkillRow,
} from './format.js';
import { DetailActionChipRow } from './detail-action-chips.js';
import { detailActionChipsWidth } from './detail-actions.js';
import { browseTagOffset } from './browse-session.js';
import { listViewportBudget, masterDetailSeparator } from './layout.js';
import { t } from '../../i18n/index.js';
import { Clickable } from '../components/mouse/clickable.js';
import { centerStart, padColumns, sliceColumns, textWidth } from '../components/terminal-layout.js';
import { termcnColors, WorkingSpinner } from '../components/termcn.js';

export function masterDetailBlankRow(
  tagWidth: number,
  listWidth: number,
  peekWidth: number
): ReactNode {
  const divider = '│';
  return (
    <box flexDirection="row">
      <box width={tagWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', tagWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </box>
      <box width={listWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', listWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </box>
      <box flexDirection="row" width={peekWidth}>
        <Text wrap="truncate-end">{padColumns('', peekWidth)}</Text>
      </box>
    </box>
  );
}

export function SkillPane({
  rows,
  cursor,
  isActive,
  selected,
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
  viewportHeight,
  onRowClick,
  onCursorDelta,
}: {
  rows: SkillRow[];
  cursor: number;
  isActive: boolean;
  selected: Set<string>;
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
  viewportHeight?: number | undefined;
  onRowClick?: (index: number) => void;
  onCursorDelta?: (delta: number) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const budget = listViewportBudget(stdout.columns, stdout.rows);
  const useCompact = compact || budget.compact;
  const paneHeight = viewportHeight ?? Math.max(budget.minVisible, (stdout.rows ?? 24) - budget.reservedRows);
  const paginate = showPagination && !useCompact;
  const height = rows.length > paneHeight
    ? Math.max(budget.minVisible, paneHeight - (paginate ? 1 : 0))
    : paneHeight;
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  const paneWidth = columnWidth ?? Math.max(20, (stdout.columns ?? 80) - 4);
  const summaryWidth = Math.max(8, paneWidth - 4);
  const onMouseScroll = useCallback(
    (event: MouseEvent) => {
      const info = event.scroll;
      if (!info || !onCursorDelta) return;
      const steps = Math.max(1, Math.abs(info.delta) || 1);
      if (info.direction === 'up') onCursorDelta(-steps);
      else if (info.direction === 'down') onCursorDelta(steps);
      event.stopPropagation();
    },
    [onCursorDelta]
  );
  const renderRow = (row: SkillRow, index: number) => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      const body = (
        <Text
          bold
          {...(isActive && index === active ? { color: termcnColors.primary } : {})}
        >
          {`${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`}
        </Text>
      );
      if (!onRowClick) return <box key={`group:${row.name}:${index}`} flexDirection="row">{body}</box>;
      return (
        <Clickable key={`group:${row.name}:${index}`} onClick={() => onRowClick(index)}>
          {body}
        </Clickable>
      );
    }
    const skill = row.skill;
    const current = isActive && index === active;
    const summary = useCompact || layout === 'master'
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
            <Text color={termcnColors.muted}>{t('browser.referencePrefix')}</Text>
            <Text bold={current}>{skill.name}</Text>
          </>
        ) : showSource && !skill.fromCollection ? (
          t('browser.localSkill', { name: skill.name })
        ) : (
          <Text bold={current}>{skill.name}</Text>
        )}
        {updatingSkillName === skill.name ? (
          <WorkingSpinner />
        ) : updates.has(skill.name) ? (
          <Text color={termcnColors.primary}> ↑</Text>
        ) : null}
        {inlineSummary && (
          <Text color={termcnColors.muted}> — {inlineSummary}</Text>
        )}
      </>
    );
    const body = (
      <Text
        wrap="truncate-end"
        {...(current
          ? {
              color: termcnColors.selectionFg,
              backgroundColor: termcnColors.selectionBg,
              bold: true,
            }
          : {})}
      >
        {nameLine}
      </Text>
    );
    if (!onRowClick) {
      return (
        <box key={`${row.group}:${skill.path}:${index}`} flexDirection="row">
          {body}
        </box>
      );
    }
    return (
      <Clickable
        key={`${row.group}:${skill.path}:${index}`}
        onClick={() => onRowClick(index)}
      >
        {body}
      </Clickable>
    );
  };
  return (
    <box flexDirection="column" minHeight={budget.minVisible} onMouseScroll={onMouseScroll}>
      {rows.length ? (
        visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex))
      ) : (
        <Text color={termcnColors.muted}>{t('browser.noMatchingSkills')}</Text>
      )}
      {paginate && rows.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, rows.length)} / {rows.length}
        </Text>
      )}
    </box>
  );
}

export function AgentTabs({
  groups,
  agent,
  focused,
  onSelect,
}: {
  groups: { agent: string; count: number }[];
  agent: string;
  focused: boolean;
  onSelect: (agent: string) => void;
}): ReactNode {
  return (
    <box flexDirection="row" paddingLeft={1} gap={2} height={1} flexWrap="no-wrap">
      {groups.map((group) => {
        const active = group.agent === agent;
        const keyboardHere = focused && active;
        return (
          <Clickable key={group.agent} onClick={() => onSelect(group.agent)}>
            <Text
              wrap="truncate-end"
              color={
                keyboardHere
                  ? termcnColors.selectionFg
                  : active
                    ? termcnColors.primary
                    : termcnColors.muted
              }
              {...(keyboardHere
                ? { backgroundColor: termcnColors.selectionBg, bold: true }
                : active
                  ? { bold: true, underline: true }
                  : {})}
            >
              {`${group.agent} ${group.count}`}
            </Text>
          </Clickable>
        );
      })}
    </box>
  );
}

export function BrowseListPane({
  items,
  cursor,
  isActive,
  selected,
  compact = false,
  viewportHeight,
  onRowClick,
  onCursorDelta,
}: {
  items: BrowseListItem[];
  cursor: number;
  isActive: boolean;
  selected: Set<string>;
  compact?: boolean;
  viewportHeight?: number | undefined;
  onRowClick?: (index: number) => void;
  onCursorDelta?: (delta: number) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const budget = listViewportBudget(stdout.columns, stdout.rows);
  const useCompact = compact || budget.compact;
  const paneHeight = viewportHeight ?? Math.max(budget.minVisible, (stdout.rows ?? 24) - budget.reservedRows);
  const height = items.length > paneHeight
    ? Math.max(budget.minVisible, paneHeight - (useCompact ? 0 : 1))
    : paneHeight;
  const active = Math.max(0, Math.min(cursor, items.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), items.length - height));
  const visible = items.slice(offset, offset + height);
  const onMouseScroll = useCallback(
    (event: MouseEvent) => {
      const info = event.scroll;
      if (!info || !onCursorDelta) return;
      const steps = Math.max(1, Math.abs(info.delta) || 1);
      if (info.direction === 'up') onCursorDelta(-steps);
      else if (info.direction === 'down') onCursorDelta(steps);
      event.stopPropagation();
    },
    [onCursorDelta]
  );
  const renderRow = (item: BrowseListItem, index: number): ReactNode => {
    const current = isActive && index === active;
    const body = (
      <Text
        wrap="truncate-end"
        {...(current
          ? {
              color: termcnColors.selectionFg,
              backgroundColor: termcnColors.selectionBg,
              bold: true,
            }
          : {})}
      >
        {`  ${current ? '›' : ' '} ${selected.has(item.id) ? '●' : '○'} `}
        {item.mark ? <Text color={termcnColors.muted}>{item.mark}</Text> : null}
        <Text bold={current}>{item.name}</Text>
        {!useCompact && item.summary ? <Text color={termcnColors.muted}> — {item.summary}</Text> : null}
      </Text>
    );
    if (!onRowClick) {
      return (
        <box key={item.id} flexDirection="row">
          {body}
        </box>
      );
    }
    return (
      <Clickable key={item.id} onClick={() => onRowClick(index)}>
        {body}
      </Clickable>
    );
  };
  return (
    <box flexDirection="column" minHeight={budget.minVisible} onMouseScroll={onMouseScroll}>
      {items.length ? (
        visible.map((item, visibleIndex) => renderRow(item, offset + visibleIndex))
      ) : (
        <Text color={termcnColors.muted}>{t('browser.noMatchingSkills')}</Text>
      )}
      {!useCompact && items.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, items.length)} / {items.length}
        </Text>
      )}
    </box>
  );
}

function masterDetailColumnText(
  line: string,
  width: number,
  options: {
    color?: string;
    bold?: boolean;
    selected?: boolean;
    muted?: boolean;
  } = {}
): ReactNode {
  const padded = padColumns(sliceColumns(line, 0, width), width);
  if (options.selected) {
    return (
      <Text
        wrap="truncate-end"
        color={termcnColors.selectionFg}
        backgroundColor={termcnColors.selectionBg}
        bold
      >
        {padded}
      </Text>
    );
  }
  return (
    <Text
      wrap="truncate-end"
      {...(options.muted
        ? { color: termcnColors.muted }
        : options.color
          ? { color: options.color }
          : {})}
      {...(options.bold ? { bold: true } : {})}
    >
      {padded}
    </Text>
  );
}

function DetailColumnRow({
  row,
  width,
  selected = false,
  labelWidth,
}: {
  row: CollectionDetailFieldRow;
  width: number;
  selected?: boolean;
  labelWidth: number;
}): ReactNode {
  if (selected) {
    return (
      <Text
        wrap="truncate-end"
        color={termcnColors.selectionFg}
        backgroundColor={termcnColors.selectionBg}
        bold
      >
        {padColumns(
          sliceColumns(
            row.label !== undefined
              ? `${padColumns(row.label, labelWidth)}${row.text}`
              : row.text,
            0,
            width
          ),
          width
        )}
      </Text>
    );
  }
  if (row.label !== undefined) {
    const valueWidth = Math.max(1, width - labelWidth);
    return (
      <Text wrap="truncate-end">
        <Text color={termcnColors.muted}>{padColumns(row.label, labelWidth)}</Text>
        <Text
          {...(row.muted ? { color: termcnColors.muted } : {})}
          {...(row.bold ? { bold: true } : {})}
          {...(row.primary ? { color: termcnColors.primary } : {})}
        >
          {padColumns(sliceColumns(row.text, 0, valueWidth), valueWidth)}
        </Text>
      </Text>
    );
  }
  return (
    <Text
      wrap="truncate-end"
      {...(row.primary ? { color: termcnColors.primary } : {})}
      {...(row.muted ? { color: termcnColors.muted } : {})}
      {...(row.bold ? { bold: true } : {})}
    >
      {padColumns(sliceColumns(row.text, 0, width), width)}
    </Text>
  );
}

export function MasterDetailBody({
  tagLines,
  listLines,
  peekLines,
  tagWidth,
  listWidth,
  peekWidth,
  tagActive,
  listActive,
  detailActive = false,
  detailActiveField,
  collectionHome = false,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
  detailLabelWidth,
  emptyPeekHint,
  onTagLineClick,
  onListLineClick,
  onDetailLineClick,
  onDetailChipClick,
  onListScroll,
}: {
  tagLines: string[];
  listLines: string[];
  peekLines: string[];
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  tagActive: boolean;
  listActive: boolean;
  detailActive?: boolean;
  detailActiveField?: DetailFieldId;
  collectionHome?: boolean;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows?: CollectionDetailRow[];
  detailLabelWidth: number;
  emptyPeekHint: string;
  onTagLineClick?: (visibleIndex: number) => void;
  onListLineClick?: (visibleIndex: number) => void;
  onDetailLineClick?: (visibleIndex: number) => void;
  onDetailChipClick?: (chip: DetailActionId) => void;
  onListScroll?: (delta: number) => void;
}): ReactNode {
  const rows = Math.max(tagLines.length, listLines.length);
  const divided = collectionHome;
  const divider = divided ? '│' : '';
  const tagColumnWidth = tagWidth + (divider ? 1 : 0);
  const listColumnWidth = listWidth + (divider ? 1 : 0);
  const onListColumnScroll = useCallback(
    (event: MouseEvent) => {
      const info = event.scroll;
      if (!info || !onListScroll) return;
      const steps = Math.max(1, Math.abs(info.delta) || 1);
      if (info.direction === 'up') onListScroll(-steps);
      else if (info.direction === 'down') onListScroll(steps);
      event.stopPropagation();
    },
    [onListScroll]
  );
  const swallowScroll = useCallback((event: MouseEvent) => {
    if (event.scroll) event.stopPropagation();
  }, []);
  return (
    <box flexDirection="column">
      {Array.from({ length: rows }, (_, index) => {
        const tagCell = masterDetailColumnText(tagLines[index] ?? '', tagWidth, {
          ...(tagActive && tagLines[index]?.startsWith('›')
            ? collectionHome
              ? { selected: true }
              : { color: termcnColors.primary, bold: true }
            : {}),
        });
        const listCell = masterDetailColumnText(listLines[index] ?? '', listWidth, {
          ...(listActiveLineIndexes?.has(index)
            ? { selected: true }
            : listSelectedLineIndexes?.has(index)
              ? { color: termcnColors.primary, bold: true }
              : listActive && listLines[index]?.startsWith('›')
                ? { color: termcnColors.primary, bold: true }
                : index % 2 === 1 && listLines[index]?.trim()
                  ? { muted: true }
                  : {}),
        });
        const tagInteractive =
          onTagLineClick && (tagLines[index] ?? '').trim().length > 0;
        const listInteractive =
          onListLineClick && (listLines[index] ?? '').trim().length > 0;
        return (
          <box key={`master-detail-row:${index}`} flexDirection="row">
            <box
              width={tagColumnWidth}
              flexDirection="row"
              onMouseScroll={swallowScroll}
            >
              {tagInteractive ? (
                <Clickable onClick={() => onTagLineClick(index)}>{tagCell}</Clickable>
              ) : (
                tagCell
              )}
              {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
            </box>
            <box
              width={listColumnWidth}
              flexDirection="row"
              onMouseScroll={onListColumnScroll}
            >
              {listInteractive ? (
                <Clickable onClick={() => onListLineClick(index)}>{listCell}</Clickable>
              ) : (
                listCell
              )}
              {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
            </box>
            <box
              flexDirection="row"
              width={peekWidth}
              onMouseScroll={swallowScroll}
            >
              {detailRows?.[index] ? (
                (() => {
                  const detailRow = detailRows[index]!;
                  if (detailRow.action === true) {
                    const chips = detailRow.chips;
                    const barWidth = Math.max(
                      1,
                      Math.min(peekWidth, detailActionChipsWidth(chips) || 1)
                    );
                    const lead = centerStart(barWidth, peekWidth);
                    return (
                      <box flexDirection="row" width={peekWidth}>
                        {lead > 0 ? <Text>{' '.repeat(lead)}</Text> : null}
                        <DetailActionChipRow
                          chips={chips}
                          onChip={(chip) => onDetailChipClick?.(chip)}
                        />
                      </box>
                    );
                  }
                  const fieldSelected =
                    detailActive &&
                    detailRow.field !== undefined &&
                    detailRow.field === detailActiveField;
                  const cell = (
                    <DetailColumnRow
                      row={detailRow}
                      width={peekWidth}
                      selected={fieldSelected}
                      labelWidth={detailLabelWidth}
                    />
                  );
                  return onDetailLineClick && detailRow.field ? (
                    <Clickable onClick={() => onDetailLineClick(index)}>{cell}</Clickable>
                  ) : (
                    cell
                  );
                })()
              ) : (
                <Text
                  wrap="truncate-end"
                  color={index === 0 && peekLines[index] !== emptyPeekHint ? termcnColors.primary : termcnColors.muted}
                  bold={index === 0 && peekLines[index] !== emptyPeekHint}
                >
                  {padColumns(sliceColumns(peekLines[index] ?? '', 0, peekWidth), peekWidth)}
                </Text>
              )}
            </box>
          </box>
        );
      })}
    </box>
  );
}

/** Full 3-column collection panes: separator, 标签|技能|详情, blank, body. */
export function MasterDetailHome({
  tagWidth,
  listWidth,
  peekWidth,
  tagLines,
  listLines,
  peekLines = [],
  tagActive,
  listActive,
  detailActive = false,
  detailActiveField,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
  detailLabelWidth,
  onTagLineClick,
  onListLineClick,
  onDetailLineClick,
  onDetailChipClick,
  onListScroll,
}: {
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  tagLines: string[];
  listLines: string[];
  peekLines?: string[];
  tagActive: boolean;
  listActive: boolean;
  detailActive?: boolean;
  detailActiveField?: DetailFieldId;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows: CollectionDetailRow[];
  detailLabelWidth: number;
  onTagLineClick?: (visibleIndex: number) => void;
  onListLineClick?: (visibleIndex: number) => void;
  onDetailLineClick?: (visibleIndex: number) => void;
  onDetailChipClick?: (chip: DetailActionId) => void;
  onListScroll?: (delta: number) => void;
}): ReactNode {
  const headerLine = (left: string, middle: string, right: string): ReactNode => (
    <box flexDirection="row">
      <box width={tagWidth + 1} flexDirection="row">
        <Text bold color={termcnColors.muted} wrap="truncate-end">
          {padColumns(left, tagWidth)}
        </Text>
        <Text color={termcnColors.border}>│</Text>
      </box>
      <box width={listWidth + 1} flexDirection="row">
        <Text bold color={termcnColors.muted} wrap="truncate-end">
          {padColumns(middle, listWidth)}
        </Text>
        <Text color={termcnColors.border}>│</Text>
      </box>
      <box flexDirection="row" width={peekWidth}>
        <Text bold color={termcnColors.muted} wrap="truncate-end">
          {padColumns(right, peekWidth)}
        </Text>
      </box>
    </box>
  );
  return (
    <box flexDirection="column">
      <Text color={termcnColors.border} wrap="truncate-end">
        {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'top', true)}
      </Text>
      {headerLine(t('common.tags'), t('common.skill'), t('common.detail'))}
      {masterDetailBlankRow(tagWidth, listWidth, peekWidth)}
      <MasterDetailBody
        tagLines={tagLines}
        listLines={listLines}
        peekLines={peekLines}
        tagWidth={tagWidth}
        listWidth={listWidth}
        peekWidth={peekWidth}
        tagActive={tagActive}
        listActive={listActive}
        detailActive={detailActive}
        {...(detailActiveField ? { detailActiveField } : {})}
        collectionHome
        {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
        {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
        detailRows={detailRows}
        detailLabelWidth={detailLabelWidth}
        emptyPeekHint={t('browser.selectSkillToView')}
        {...(onTagLineClick ? { onTagLineClick } : {})}
        {...(onListLineClick ? { onListLineClick } : {})}
        {...(onDetailLineClick ? { onDetailLineClick } : {})}
        {...(onDetailChipClick ? { onDetailChipClick } : {})}
        {...(onListScroll ? { onListScroll } : {})}
      />
      <Text color={termcnColors.border} wrap="truncate-end">
        {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'bottom', true)}
      </Text>
    </box>
  );
}

/** Wide 3-column browse body: tag sidebar + paired list lines + detail. */
export function BrowseHomePane({
  tagOptions,
  tagCursor,
  listLines,
  skillOffset,
  listLength,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
  detailActiveField,
  tagWidth,
  listWidth,
  peekWidth,
  viewportHeight,
  tagActive,
  listActive,
  detailActive,
  onTagIndex,
  onListIndex,
  onDetailLine,
  onDetailChipClick,
  onListScroll,
}: {
  tagOptions: BrowseTagOption[];
  tagCursor: number;
  listLines: string[];
  skillOffset: number;
  listLength: number;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows: CollectionDetailRow[];
  detailActiveField?: DetailFieldId;
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  viewportHeight: number;
  tagActive: boolean;
  listActive: boolean;
  detailActive: boolean;
  onTagIndex: (index: number) => void;
  onListIndex: (index: number) => void;
  onDetailLine: (visibleIndex: number) => void;
  onDetailChipClick?: (chip: DetailActionId) => void;
  onListScroll: (delta: number) => void;
}): ReactNode {
  const tagOffset = browseTagOffset(tagCursor, tagOptions.length, viewportHeight);
  const tagLines = collectionCategoryLines(
    tagOptions.map((option) => ({ label: option.label, count: option.ids.length })),
    tagCursor,
    true,
    tagWidth,
    viewportHeight
  );
  return (
    <MasterDetailHome
      tagWidth={tagWidth}
      listWidth={listWidth}
      peekWidth={peekWidth}
      tagLines={tagLines}
      listLines={listLines}
      tagActive={tagActive}
      listActive={listActive}
      detailActive={detailActive}
      {...(detailActiveField ? { detailActiveField } : {})}
      {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
      {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
      detailRows={detailRows}
      detailLabelWidth={detailLabelWidth()}
      onTagLineClick={(visibleIndex) => {
        const absolute = tagOffset + visibleIndex;
        if (absolute < 0 || absolute >= tagOptions.length) return;
        onTagIndex(absolute);
      }}
      onListLineClick={(visibleIndex) => {
        const index = skillOffset + Math.floor(visibleIndex / 2);
        if (index < 0 || index >= listLength) return;
        onListIndex(index);
      }}
      onDetailLineClick={onDetailLine}
      {...(onDetailChipClick ? { onDetailChipClick } : {})}
      onListScroll={onListScroll}
    />
  );
}
