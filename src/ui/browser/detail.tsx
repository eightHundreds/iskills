import { Text, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useState } from 'react';
import { useStore } from 'jotai';
import type { Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import { t } from '../../i18n/index.js';
import { useOverlayBusy } from '../overlay/host.js';
import { termcnColors } from '../components/termcn.js';
import { Clickable } from '../components/mouse/clickable.js';
import { isReturn } from '../components/text.js';
import { copySkillDiskPath } from './copy-path.js';
import { detailContentLines, isGitHubSourceUrl } from './format.js';
import { detailFrameDimensions } from './layout.js';
import type { BrowserAppStore } from './store.js';

export type DetailAction = 'note' | 'tags' | 'source' | 'openSource' | 'back';

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
  const detailFrame = detailFrameDimensions(frameHeight, frameWidth, stdout.rows);
  const [detailOffset, setDetailOffset] = useState(0);
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  const canOpenSource = collection && isGitHubSourceUrl(metadata.source.url);
  const lines = detailContentLines(skill, metadata, links, collection, source, detailFrame.width);
  const viewportHeight = Math.max(1, detailFrame.height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(detailOffset, maxOffset);
  const visibleLines = lines.slice(offset, offset + viewportHeight);
  const shellBusy = useOverlayBusy();
  const copyPath = (): void => {
    void copySkillDiskPath(store, skill.path);
  };
  useInput(
    (input, key) => {
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
      if (canOpenSource && isReturn(input, key.return)) return finish('openSource');
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
          const text = (
            <Text
              key={`${offset + index}:${line.label ?? ''}:${line.value}`}
              {...(line.muted ? { color: termcnColors.muted } : {})}
            >
              {line.label && <Text bold>{line.label}</Text>}{line.value}
            </Text>
          );
          if (line.field === 'source' && canOpenSource) {
            return (
              <Clickable
                key={`${offset + index}:source`}
                onClick={() => finish('openSource')}
              >
                {text}
              </Clickable>
            );
          }
          return text;
        })}
      </box>
      <Clickable onClick={copyPath}>
        <Text color={termcnColors.primary} bold>
          {t('browser.copyPath')}
        </Text>
      </Clickable>
    </box>
  );
}
