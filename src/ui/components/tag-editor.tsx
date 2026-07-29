import { Box, Text, useStdout } from '../tui/index.js';
import { useInput } from './use-input.js';
import { useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { TextInput } from './text-input.js';
import { isReturn } from './text.js';

export function TagEditor({
  tags,
  initialValues,
  title = '编辑标签',
  onSubmit,
  onCancel,
}: {
  tags: string[];
  initialValues: string[];
  title?: string;
  onSubmit: (tags: string[]) => void;
  onCancel?: () => void;
}): ReactNode {
  const { stdout } = useStdout();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialValues));
  const [focus, setFocus] = useState<'list' | 'input'>(tags.length ? 'list' : 'input');
  const [cursor, setCursor] = useState(0);
  const height = Math.max(3, (stdout.rows ?? 24) - 13);
  const offset = Math.max(0, Math.min(cursor - Math.floor(height / 2), tags.length - height));
  const visible = tags.slice(offset, offset + height);
  const save = (input: string): void => onSubmit([
    ...new Set([
      ...selected,
      ...input.split(',').map((tag) => tag.trim()).filter(Boolean),
    ]),
  ]);

  useInput((input, key) => {
    if (key.escape) return onCancel?.();
    if (key.tab) {
      return setFocus((value) => tags.length && value === 'input' ? 'list' : 'input');
    }
    if (focus !== 'list') return;
    if (key.upArrow) return setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) {
      return setCursor((value) => Math.min(Math.max(0, tags.length - 1), value + 1));
    }
    if (input === ' ') {
      const tag = tags[cursor];
      if (!tag) return;
      return setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      });
    }
    if (isReturn(input, key.return)) save('');
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title} · 已选 {selected.size}</Text>
      <Text bold>已有标签</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={termcnColors.border}
        paddingX={1}
      >
        {visible.length ? visible.map((tag, index) => {
          const active = offset + index === cursor;
          return (
            <Text key={tag} {...(active && focus === 'list' ? { color: termcnColors.primary } : {})}>
              {`${active ? '›' : ' '} ${selected.has(tag) ? '●' : '○'} ${tag}`}
            </Text>
          );
        }) : <Text color={termcnColors.muted}>暂无已有标签</Text>}
      </Box>
      <TextInput
        label="新增标签（逗号分隔）"
        isActive={focus === 'input'}
        onSubmit={save}
        {...(onCancel ? { onCancel } : {})}
      />
      <Text color={termcnColors.muted}>
        ↑/↓ 移动 · Space 选择 · Tab 切换区域 · Enter 保存 · Esc 取消
      </Text>
    </Box>
  );
}
