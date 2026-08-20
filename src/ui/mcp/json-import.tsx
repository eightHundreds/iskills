import { useState, type ReactNode } from 'react';
import { t } from '../../i18n/index.js';
import { Text, usePanelColors } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { termcnColors } from '../components/termcn.js';
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
    promptFallback: () => promptText(t('mcp.jsonSourcePrompt')),
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
