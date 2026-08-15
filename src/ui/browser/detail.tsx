import { Text, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useState } from 'react';
import type { Skill, SkillLink, SkillMetadata } from '../../domain/types.js';
import { useOverlayBusy } from '../overlay/host.js';
import { termcnColors } from '../components/termcn.js';
import { detailContentLines } from './format.js';
import { detailFrameDimensions } from './layout.js';

export type DetailAction = 'note' | 'tags' | 'source' | 'back';

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
  const shellBusy = useOverlayBusy();
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
