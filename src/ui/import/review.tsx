import { Text, useModalChrome, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { TextInput, termcnColors } from '../components/termcn.js';
import type { ImportReviewItem, ImportReviewResult } from './types.js';
import { t } from '../../i18n/index.js';

function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
}

export function ImportReview<T extends Skill>({
  label = t('import.confirmTitle'),
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
  const chrome = useModalChrome();
  const colors = {
    primary: termcnColors.primary,
    border: termcnColors.border,
    muted: chrome.muted,
    body: chrome.body,
  };
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
    if (key.escape) {
      submit(false);
      return;
    }
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
    <box flexDirection="column">
      <Text bold color={colors.body}>
        {label}
      </Text>
      <box flexDirection="row" paddingLeft={1}>
        {(['tags', 'confirm'] as const).map((tab, index) => (
          <box flexDirection="row" key={tab}>
            <Text
              color={activeTab === tab ? colors.primary : colors.muted}
              bold={activeTab === tab}
              underline={activeTab === tab}
            >
              {tab === 'tags' ? t('import.selectGroups') : t('common.confirm')}
            </Text>
            {index === 0 && <Text color={colors.border}> │ </Text>}
          </box>
        ))}
      </box>
      {activeTab === 'tags' ? (
        <box flexDirection="column">
          <Text color={colors.muted}>
            {t('import.selectedGroups', { tags: selectedTags.size ? [...selectedTags].join(', ') : t('common.none') })}
          </Text>
          <box border
            flexDirection="column"
            borderStyle="rounded"
            borderColor={colors.border}
            backgroundColor={chrome.surface}
            paddingX={1}
          >
            {visibleTags.length ? (
              visibleTags.map((tag, visibleIndex) => {
                const index = offset + visibleIndex;
                const active = tagFocus === 'list' && index === clampedCursor;
                return (
                  <Text
                    key={tag}
                    color={active ? colors.primary : colors.body}
                    backgroundColor={chrome.surface}
                  >
                    {`${active ? '›' : ' '} ${selectedTags.has(tag) ? '●' : '○'} ${tag}`}
                  </Text>
                );
              })
            ) : (
              <Text color={colors.muted} backgroundColor={chrome.surface}>
                {t('import.noExistingGroups')}
              </Text>
            )}
          </box>
          <TextInput
            label={t('import.newGroupsComma')}
            isActive={tagFocus === 'input'}
            onSubmit={addTags}
          />
          <Text color={colors.muted}>
            {tagFocus === 'input'
              ? t('import.groupInputFooter')
              : t('import.groupListFooter')}
          </Text>
        </box>
      ) : (
        <box flexDirection="column">
          <Text color={colors.body}>
            {t('import.willImport', { count: items.length })}
            {selectedTags.size ? [...selectedTags].join(', ') : t('common.none')}
          </Text>
          <box flexDirection="column" marginTop={1}>
            {visibleItems.map((item) => (
              <Text key={item.skill.path} color={colors.muted} wrap="truncate-end">
                - {item.skill.name}: {item.detail}
              </Text>
            ))}
            {items.length > visibleItems.length && (
              <Text color={colors.muted}>{t('import.moreItems', { count: items.length - visibleItems.length })}</Text>
            )}
          </box>
          <Text color={colors.muted}>{t('import.confirmFooter')}</Text>
        </box>
      )}
    </box>
  );
}
