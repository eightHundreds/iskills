import { Box, Text, useInput, useStdout } from 'ink';
import { useState, type ReactNode } from 'react';
import type { Skill } from '../../domain/types.js';
import { TextInput, termcnColors } from '../components/termcn.js';
import type { ImportReviewItem, ImportReviewResult } from './types.js';

const colors = termcnColors;

function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
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
            borderColor={colors.border}
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
