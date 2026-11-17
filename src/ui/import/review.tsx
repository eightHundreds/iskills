import { Text, usePanelColors, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { TextInput, termcnColors } from '../components/termcn.js';
import { isReturn } from '../components/text.js';
import type { ImportReviewItem, ImportReviewResult } from './types.js';
import { t } from '../../i18n/index.js';


export function ImportReview<T extends Skill>({
  label = t('import.confirmTitle'),
  items,
  existingTags,
  initialPrivate = false,
  namespaceEnabled = false,
  initialNamespace = '',
  namespaceMembers = [],
  onSubmit,
}: {
  label?: string;
  items: ImportReviewItem<T>[];
  existingTags: string[];
  initialPrivate?: boolean;
  namespaceEnabled?: boolean;
  initialNamespace?: string;
  namespaceMembers?: Array<{ name: string; originalName: string }>;
  onSubmit: (result: ImportReviewResult) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const panel = usePanelColors();
  const colors = {
    primary: termcnColors.primary,
    border: termcnColors.border,
    muted: panel.muted,
    body: panel.body,
  };
  const [activeTab, setActiveTab] = useState<'tags' | 'namespace' | 'confirm'>('tags');
  const [namespace, setNamespace] = useState(initialNamespace);
  const [tagFocus, setTagFocus] = useState<'list' | 'input'>(existingTags.length ? 'list' : 'input');
  const [cursor, setCursor] = useState(0);
  const [isPrivate, setPrivate] = useState(initialPrivate);
  const [changeOffset, setChangeOffset] = useState(0);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  const height = Math.max(3, (stdout.rows ?? 24) - 15);
  const clampedCursor = Math.max(0, Math.min(cursor, Math.max(0, existingTags.length - 1)));
  const offset = Math.max(
    0,
    Math.min(clampedCursor - Math.floor(height / 2), Math.max(0, existingTags.length - height))
  );
  const visibleTags = existingTags.slice(offset, offset + height);
  const pendingChanges = namespace.trim() && namespace.trim() !== initialNamespace ? namespaceMembers : [];
  const changeHeight = Math.max(1, Math.floor(((stdout.rows ?? 24) - 14) / 2));
  const changeStart = Math.min(changeOffset, Math.max(0, pendingChanges.length - changeHeight));
  const visibleChanges = pendingChanges.slice(changeStart, changeStart + changeHeight);
  const visibleItems = items.slice(0, Math.max(1, Math.min(items.length, (stdout.rows ?? 24) - 13 - visibleChanges.length)));

  const submit = (confirmed: boolean) => {
    onSubmit({ confirmed, tags: [...selectedTags], private: isPrivate, ...(namespaceEnabled && namespace.trim() ? { namespace: namespace.trim() } : {}) });
  };
  const addTags = (input: string) => {
    const tags = input.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) {
      setSelectedTags((previous) => new Set([...previous, ...tags]));
    }
    setActiveTab(namespaceEnabled ? 'namespace' : 'confirm');
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
      if (key.upArrow) { setChangeOffset((value) => Math.max(0, value - 1)); return; }
      if (key.downArrow) { setChangeOffset((value) => Math.min(Math.max(0, pendingChanges.length - changeHeight), value + 1)); return; }
      if (input.trim().toLowerCase() === 'p') {
        setPrivate((value) => !value);
        return;
      }
      if (key.leftArrow) {
        setActiveTab(namespaceEnabled ? 'namespace' : 'tags');
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

    if (activeTab === 'namespace') {
      if (key.leftArrow) setActiveTab('tags');
      return;
    }
    if (tagFocus === 'list' && key.rightArrow) {
      setActiveTab(namespaceEnabled ? 'namespace' : 'confirm');
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
      setActiveTab(namespaceEnabled ? 'namespace' : 'confirm');
    }
  });

  return (
    <box flexDirection="column">
      <Text bold color={colors.body}>
        {label}
      </Text>
      <box flexDirection="row" paddingLeft={1}>
        {(namespaceEnabled ? ['tags', 'namespace', 'confirm'] as const : ['tags', 'confirm'] as const).map((tab, index) => (
          <box flexDirection="row" key={tab}>
            <Text
              color={activeTab === tab ? colors.primary : colors.muted}
              bold={activeTab === tab}
              underline={activeTab === tab}
            >
              {tab === 'tags' ? t('import.selectGroups') : tab === 'namespace' ? t('import.namespace') : t('common.confirm')}
            </Text>
            {index < (namespaceEnabled ? 2 : 1) && <Text color={colors.border}> │ </Text>}
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
            backgroundColor={panel.surface}
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
                    backgroundColor={panel.surface}
                  >
                    {`${active ? '›' : ' '} ${selectedTags.has(tag) ? '●' : '○'} ${tag}`}
                  </Text>
                );
              })
            ) : (
              <Text color={colors.muted} backgroundColor={panel.surface}>
                {t('import.noExistingGroups')}
              </Text>
            )}
          </box>
          <TextInput
            label={t('import.newGroupsComma')}
            isActive={tagFocus === 'input'}
            onSubmit={addTags}
          />
        </box>
      ) : activeTab === 'namespace' ? (
        <TextInput label={t('import.namespaceOptional')} initialValue={namespace} onChange={setNamespace} onSubmit={(value) => { setNamespace(value); setActiveTab('confirm'); }} />
      ) : (
        <box flexDirection="column">
          <Text color={colors.body}>
            {namespaceEnabled ? `${t('import.namespace')}: ${namespace || '—'}` : ''}
          </Text>
          <Text color={colors.body}>
            {t('import.willImport', { count: items.length })}
            {selectedTags.size ? [...selectedTags].join(', ') : t('common.none')}
          </Text>
          <Text color={colors.body}>{t('import.privateToggle', { value: isPrivate ? 'ON' : 'OFF' })}</Text>
          {pendingChanges.length > 0 && (
            <box flexDirection="column">
              <Text color={colors.body}>{t('import.namespaceExistingChanges')}</Text>
              {visibleChanges.map((member) => (
                <Text key={member.name} color={colors.muted}>{`${member.name} → ${namespace.trim()}-${member.originalName}`}</Text>
              ))}
              {pendingChanges.length > visibleChanges.length && <Text color={colors.muted}>{t('import.namespaceScroll', { start: changeStart + 1, end: changeStart + visibleChanges.length, total: pendingChanges.length })}</Text>}
            </box>
          )}
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
        </box>
      )}
    </box>
  );
}
