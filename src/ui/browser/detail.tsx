import { Text, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSetAtom, useStore } from 'jotai';
import type { Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import { t } from '../../i18n/index.js';
import { useLayer, useOverlayBusy } from '../overlay/host.js';
import { termcnColors } from '../components/termcn.js';
import { Clickable } from '../components/mouse/clickable.js';
import { isReturn } from '../components/text.js';
import { centerStart } from '../components/terminal-layout.js';
import { copySkillDiskPath } from './copy-path.js';
import { DetailActionChipRow } from './detail-action-chips.js';
import { detailActionChipsWidth, peekActionChips } from './detail-actions.js';
import { confirmUnbindCollectedSource } from './unbind-source.js';
import {
  clampDetailOffsetToLine,
  detailContentLines,
  detailEntryFieldIndex,
  fieldsInDetailLines,
  firstLineIndexForField,
  isGitHubSourceUrl,
  reduceFullscreenDetailNav,
  relatedLocationLines,
} from './format.js';
import { detailFrameDimensions } from './layout.js';
import { browserDetailFieldAtom, type BrowserAppStore } from './store.js';
import type { DetailFieldId } from './types.js';

export type DetailAction = 'note' | 'tags' | 'source' | 'openSource' | 'unbindSource' | 'back';

function fieldAction(field: DetailFieldId): DetailAction | undefined {
  if (field === 'source') return 'openSource';
  if (field === 'tags') return 'tags';
  if (field === 'note') return 'note';
  return undefined;
}

/** Fullscreen skill detail phase view. */
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
  const store = useStore() as BrowserAppStore;
  const layer = useLayer();
  const setDetailField = useSetAtom(browserDetailFieldAtom);
  const detailFrame = detailFrameDimensions(frameHeight, frameWidth, stdout.rows);
  const [detailOffset, setDetailOffset] = useState(0);
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  const canOpenSource = collection && isGitHubSourceUrl(metadata.source.url);
  const lines = detailContentLines(skill, metadata, links, collection, source, detailFrame.width);
  const fields = fieldsInDetailLines(lines);
  const [fieldIndex, setFieldIndex] = useState(() => detailEntryFieldIndex(fields));
  const fieldIndexRef = useRef(fieldIndex);
  const offsetRef = useRef(detailOffset);
  fieldIndexRef.current = fieldIndex;
  const viewportHeight = Math.max(1, detailFrame.height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(detailOffset, maxOffset);
  offsetRef.current = offset;
  const clampedFieldIndex =
    fields.length > 0 ? Math.max(0, Math.min(fields.length - 1, fieldIndex)) : 0;
  const activeField = fields[clampedFieldIndex];
  const visibleLines = lines.slice(offset, offset + viewportHeight);
  const shellBusy = useOverlayBusy();
  const actionChips = peekActionChips(collection, metadata.source);
  const actionBarWidth = Math.max(1, detailActionChipsWidth(actionChips));
  const actionBarLead = centerStart(actionBarWidth, detailFrame.width);
  const copyPath = (): void => {
    void copySkillDiskPath(store, skill.path);
  };
  const unbindSource = (): void => {
    void confirmUnbindCollectedSource(skill.name).then((ok) => {
      if (ok) finish('unbindSource');
    });
  };
  const focusField = (field: DetailFieldId): void => {
    const index = fields.indexOf(field);
    if (index < 0) return;
    fieldIndexRef.current = index;
    setFieldIndex(index);
    const lineIndex = firstLineIndexForField(lines, field);
    const nextOffset = clampDetailOffsetToLine(
      lineIndex,
      offsetRef.current,
      viewportHeight,
      maxOffset
    );
    offsetRef.current = nextOffset;
    setDetailOffset(nextOffset);
  };
  const openRelatedLocations = (): void => {
    if (!links.length) return;
    void layer.open({
      footerItems: [{ key: 'Esc', label: t('common.back') }],
      content: (close) => (
        <RelatedLocationsPane
          links={links}
          frameHeight={frameHeight}
          frameWidth={frameWidth}
          onBack={() => close(undefined)}
        />
      ),
    });
  };
  const activate = (field: DetailFieldId): void => {
    focusField(field);
    if (field === 'relatedLocations') {
      openRelatedLocations();
      return;
    }
    if (field === 'location') {
      void copySkillDiskPath(store, skill.path);
      return;
    }
    const action = fieldAction(field);
    if (action) finish(action);
  };
  useEffect(() => {
    setDetailField(activeField);
  }, [activeField, setDetailField]);
  useEffect(() => {
    return () => setDetailField(undefined);
  }, [setDetailField]);
  useEffect(() => {
    if (fields.length > 0 && fieldIndex >= fields.length) {
      setFieldIndex(fields.length - 1);
    }
  }, [fieldIndex, fields.length]);
  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow) {
        const arrow = key.upArrow ? 'up' : 'down';
        const next = reduceFullscreenDetailNav({
          fieldIndex: fieldIndexRef.current,
          fieldCount: fields.length,
          offset: offsetRef.current,
          maxOffset,
          arrow,
        });
        if (next.fieldChanged) {
          const field = fields[next.fieldIndex];
          fieldIndexRef.current = next.fieldIndex;
          setFieldIndex(next.fieldIndex);
          if (field) {
            const lineIndex = firstLineIndexForField(lines, field);
            const shown = clampDetailOffsetToLine(
              lineIndex,
              offsetRef.current,
              viewportHeight,
              maxOffset
            );
            offsetRef.current = shown;
            setDetailOffset(shown);
          }
          return;
        }
        offsetRef.current = next.offset;
        setDetailOffset(next.offset);
        return;
      }
      if (key.rightArrow) {
        if (links.length) openRelatedLocations();
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
      if (collection && input === 'n') {
        focusField('note');
        return finish('note');
      }
      if (collection && input === 't') {
        focusField('tags');
        return finish('tags');
      }
      if (collection && input === 's') return finish('source');
      if (isReturn(input, key.return)) {
        const field = fields[fieldIndexRef.current];
        if (field) return activate(field);
      }
    },
    { isActive: !shellBusy }
  );
  return (
    <box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {skill.name}</Text>
      <box border
        flexDirection="column"
        borderStyle="rounded"
        borderColor={termcnColors.border}
        paddingX={1}
        height={detailFrame.height}
        width={detailFrame.width}
        overflow="hidden"
      >
        {visibleLines.map((line, index) => {
          const selected = Boolean(activeField && line.field === activeField);
          const text = renderDetailLine(
            line,
            selected,
            `${offset + index}:${line.label ?? ''}:${line.value}`
          );
          const field = line.field;
          if (field === 'source' && canOpenSource) {
            return (
              <Clickable
                key={`${offset + index}:source`}
                onClick={() => activate('source')}
              >
                {text}
              </Clickable>
            );
          }
          if (
            field === 'tags' ||
            field === 'note' ||
            field === 'relatedLocations' ||
            field === 'location'
          ) {
            return (
              <Clickable
                key={`${offset + index}:${field}`}
                onClick={() => activate(field)}
              >
                {text}
              </Clickable>
            );
          }
          return text;
        })}
      </box>
      <box flexDirection="row" width={detailFrame.width}>
        {actionBarLead > 0 ? <Text>{' '.repeat(actionBarLead)}</Text> : null}
        <DetailActionChipRow
          chips={actionChips}
          onChip={(chip) => {
            if (chip === 'copyPath') copyPath();
            else if (chip === 'unbindSource') unbindSource();
          }}
        />
      </box>
    </box>
  );
}

function RelatedLocationsPane({
  links,
  frameHeight,
  frameWidth,
  onBack,
}: {
  links: SkillLink[];
  frameHeight: number;
  frameWidth: number;
  onBack: () => void;
}): ReactNode {
  const { stdout } = useStdout();
  const detailFrame = detailFrameDimensions(frameHeight, frameWidth, stdout.rows);
  const [listOffset, setListOffset] = useState(0);
  const lines = relatedLocationLines(links, detailFrame.width);
  const viewportHeight = Math.max(1, detailFrame.height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(listOffset, maxOffset);
  const visibleLines = lines.slice(offset, offset + viewportHeight);
  useInput((input, key) => {
    if (key.upArrow && maxOffset) {
      setListOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow && maxOffset) {
      setListOffset((current) => Math.min(maxOffset, current + 1));
      return;
    }
    if (key.escape || key.leftArrow || input === 'b' || input === 'q') onBack();
  });
  return (
    <box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {t('common.relatedLocations')}</Text>
      <box
        border
        flexDirection="column"
        borderStyle="rounded"
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
      </box>
    </box>
  );
}

function renderDetailLine(
  line: { label?: string; value: string; muted?: boolean },
  selected: boolean,
  key: string
): ReactNode {
  if (selected) {
    return (
      <Text
        key={key}
        color={termcnColors.selectionFg}
        backgroundColor={termcnColors.selectionBg}
        bold
      >
        {line.label ?? ''}{line.value}
      </Text>
    );
  }
  return (
    <Text key={key} {...(line.muted ? { color: termcnColors.muted } : {})}>
      {line.label && <Text bold>{line.label}</Text>}{line.value}
    </Text>
  );
}
