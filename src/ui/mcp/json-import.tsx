import { useRef, useState, type ReactNode } from 'react';
import type { TextareaRenderable } from '@opentui/core';
import { t } from '../../i18n/index.js';
import { Text, usePanelColors } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { ModalPanel, termcnColors } from '../components/termcn.js';
import { toggleSelection } from '../components/options.js';
import { isReturn } from '../components/text.js';
import { Layer, Modal } from '../overlay/static.js';
import { promptText } from '../prompts/present.js';
import {
  runMcpJsonImportFlow,
  type JsonImportFlowResult,
  type JsonImportReviewItem,
} from './json-import-flow.js';
import { readClipboardText } from './read-clipboard.js';

export type { JsonImportFlowHost, JsonImportFlowResult, JsonImportReviewItem } from './json-import-flow.js';
export { runMcpJsonImportFlow, resolveJsonSource } from './json-import-flow.js';

export async function presentMcpJsonImport(): Promise<JsonImportFlowResult | undefined> {
  return runMcpJsonImportFlow({
    readClipboard: readClipboardText,
    promptFallback: promptJsonSource,
    promptName: (initial) => promptText(t('mcp.namePrompt'), initial ?? ''),
    review: promptJsonImportReview,
    confirmReplace: (name) =>
      Modal.confirm({
        title: t('common.confirm'),
        message: t('mcp.replaceConfirm', { name }),
        defaultValue: false,
      }),
  });
}

const jsonSourceKeyBindings = [
  { name: 'return', action: 'submit' as const },
  { name: 'kpenter', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
];

export function promptJsonSource(): Promise<string | undefined> {
  return Modal.open<string | undefined>({
    footerItems: [
      { key: 'Enter', label: t('common.confirm') },
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <ModalPanel title={` ${t('mcp.jsonReviewTitle')} `} width="80%">
        <JsonSourcePrompt
          onSubmit={(value) => close(value.trim() ? value.trim() : undefined)}
          onCancel={() => close(undefined)}
        />
      </ModalPanel>
    ),
  });
}

export function JsonSourcePrompt({
  onSubmit,
  onCancel,
}: {
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): ReactNode {
  const panel = usePanelColors();
  const ref = useRef<TextareaRenderable>(null);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  return (
    <box flexDirection="column" gap={1}>
      <Text bold color={panel.body}>
        {t('mcp.jsonSourcePrompt')}
      </Text>
      <textarea
        ref={ref}
        focused
        height={12}
        initialValue=""
        keyBindings={jsonSourceKeyBindings}
        textColor={panel.body}
        backgroundColor={panel.surface}
        focusedBackgroundColor={panel.surface}
        focusedTextColor={panel.body}
        onSubmit={() => onSubmit(ref.current?.plainText ?? '')}
      />
    </box>
  );
}

export function promptJsonImportReview(
  items: JsonImportReviewItem[]
): Promise<string[] | undefined> {
  return Layer.open<string[] | undefined>({
    footerItems: [
      { key: 'Space', label: t('common.select') },
      { key: 'Enter', label: t('common.confirm') },
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <JsonImportReview
        items={items}
        onSubmit={(names) => close(names)}
        onCancel={() => close(undefined)}
      />
    ),
  });
}

export function JsonImportReview({
  items,
  onSubmit,
  onCancel,
}: {
  items: JsonImportReviewItem[];
  onSubmit: (names: string[]) => void;
  onCancel: () => void;
}): ReactNode {
  const panel = usePanelColors();
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.defaultSelected).map((item) => item.name))
  );
  const clamped = Math.max(0, Math.min(cursor, Math.max(0, items.length - 1)));
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((current) => Math.min(items.length - 1, current + 1));
      return;
    }
    if (input === ' ') {
      const item = items[clamped];
      if (!item?.selectable) return;
      setSelected((previous) => toggleSelection(previous, item.name));
      return;
    }
    if (isReturn(input, key.return)) {
      if (!selected.size) onCancel();
      else onSubmit([...selected]);
    }
  });
  return (
    <box flexDirection="column" padding={1} gap={1}>
      <Text bold color={panel.body}>
        {t('mcp.jsonReviewTitle')}
      </Text>
      {items.length === 0 ? (
        <Text color={panel.muted}>{t('mcp.jsonNoneSelectable')}</Text>
      ) : (
        items.map((item, index) => {
          const focused = index === clamped;
          const checked = selected.has(item.name);
          const mark = item.selectable ? (checked ? '●' : '○') : '·';
          const color = focused
            ? termcnColors.selectionFg
            : item.selectable
              ? checked
                ? termcnColors.primary
                : panel.body
              : panel.muted;
          return (
            <box
              key={`${item.name}:${index}`}
              flexDirection="row"
              gap={1}
              paddingLeft={focused ? 0 : 2}
              {...(focused ? { backgroundColor: termcnColors.selectionBg } : {})}
            >
              {focused ? (
                <Text color={termcnColors.selectionFg} backgroundColor={termcnColors.selectionBg}>
                  ›
                </Text>
              ) : null}
              <Text
                color={color}
                {...(focused ? { backgroundColor: termcnColors.selectionBg, bold: true } : {})}
              >
                {`${mark} ${item.title}${item.hint ? `  ${item.hint}` : ''}`}
              </Text>
            </box>
          );
        })
      )}
    </box>
  );
}
