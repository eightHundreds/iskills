/**
 * Settings list UI — preference rows (label left, value right, ←→ cycle).
 * Changes persist immediately (no separate save step).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LocalePreference, UserConfig } from '../../domain/user-config.js';
import { applyLocalePreference, t } from '../../i18n/index.js';
import { termcnColors } from '../components/colors.js';
import { padColumns, textWidth } from '../components/terminal-layout.js';
import { useInput } from '../components/use-input.js';
import { Text, useModalChrome, useStdout } from '../tui/index.js';

type SettingId = 'locale';

interface EnumOption<T extends string> {
  value: T;
  label: string;
}

interface SettingRow {
  id: SettingId;
  label: string;
  options: EnumOption<string>[];
  value: string;
}

function localeOptions(): EnumOption<LocalePreference>[] {
  return [
    { value: 'system', label: t('config.localeSystem') },
    { value: 'zh', label: t('config.localeZh') },
    { value: 'en', label: t('config.localeEn') },
  ];
}

function cycleIndex(length: number, index: number, delta: number): number {
  if (length <= 0) return 0;
  return (index + delta + length * 8) % length;
}

function formatSettingLine(
  focused: boolean,
  label: string,
  value: string,
  width: number
): string {
  const marker = focused ? '› ' : '  ';
  const valueText = focused ? `‹ ${value} ›` : value;
  const gap = 2;
  const valueWidth = textWidth(valueText);
  const labelBudget = Math.max(8, width - valueWidth - gap - textWidth(marker));
  let left = label;
  if (textWidth(left) > labelBudget) {
    while (left.length > 1 && textWidth(`${left}…`) > labelBudget) {
      left = left.slice(0, -1);
    }
    left = `${left}…`;
  }
  const paddedLabel = padColumns(left, labelBudget);
  return padColumns(
    `${marker}${paddedLabel}${' '.repeat(gap)}${valueText}`,
    width
  );
}

/**
 * Framed settings list: one row per preference, value cycles with ←→.
 * Each change writes config immediately.
 */
export function SettingsPanel({
  initial,
  onPersist,
  onClose,
  width: preferredWidth = 56,
}: {
  initial: UserConfig;
  /** Persist full config after a change (immediate write). */
  onPersist: (config: UserConfig) => void | Promise<void>;
  onClose: () => void;
  width?: number;
}): ReactNode {
  const { stdout } = useStdout();
  const chrome = useModalChrome();
  const [config, setConfig] = useState<UserConfig>(initial);
  const [cursor, setCursor] = useState(0);
  // Bumps when locale preview changes so t() labels re-render.
  const [localeTick, setLocaleTick] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  const viewportWidth = stdout.columns ?? 80;
  const width = Math.min(preferredWidth, Math.max(40, viewportWidth - 8));
  const inner = Math.max(1, width - 4);

  const rows: SettingRow[] = useMemo(() => {
    void localeTick;
    return [
      {
        id: 'locale',
        label: t('config.localeTitle'),
        options: localeOptions(),
        value: config.locale,
      },
    ];
  }, [config.locale, localeTick]);

  const setRowValue = useCallback(
    (id: SettingId, value: string) => {
      if (id !== 'locale') return;
      const locale = value as LocalePreference;
      if (locale === configRef.current.locale) return;
      const next: UserConfig = { ...configRef.current, locale };
      setConfig(next);
      configRef.current = next;
      applyLocalePreference(locale);
      setLocaleTick((n) => n + 1);
      void onPersist(next);
    },
    [onPersist]
  );

  const cycleFocused = useCallback(
    (delta: number) => {
      const row = rows[cursor];
      if (!row || row.options.length === 0) return;
      const index = Math.max(
        0,
        row.options.findIndex((option) => option.value === row.value)
      );
      const next = row.options[cycleIndex(row.options.length, index, delta)];
      if (next) setRowValue(row.id, next.value);
    },
    [cursor, rows, setRowValue]
  );

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((current) => Math.min(rows.length - 1, current + 1));
      return;
    }
    if (key.leftArrow || input === 'h') {
      cycleFocused(-1);
      return;
    }
    if (key.rightArrow || input === 'l') {
      cycleFocused(1);
      return;
    }
  });

  const title = t('config.settingsTitle');
  const titleWidth = textWidth(title);
  const top = `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`;
  const bottom = `╰${'─'.repeat(Math.max(0, width - 2))}╯`;
  const panelBg = chrome.surface;
  const bodyFg = chrome.body;
  const muted = chrome.muted;

  return (
    <box flexDirection="column" backgroundColor={panelBg} paddingX={0}>
      <Text color={termcnColors.primary} backgroundColor={panelBg} bold>
        {top}
      </Text>
      <box flexDirection="row" backgroundColor={panelBg}>
        <Text color={termcnColors.primary} backgroundColor={panelBg}>
          │{' '}
        </Text>
        <Text color={muted} backgroundColor={panelBg}>
          {padColumns('', inner)}
        </Text>
        <Text color={termcnColors.primary} backgroundColor={panelBg}>
          {' '}
          │
        </Text>
      </box>
      {rows.map((row, index) => {
        const focused = index === cursor;
        const valueLabel =
          row.options.find((option) => option.value === row.value)?.label ??
          row.value;
        const line = formatSettingLine(focused, row.label, valueLabel, inner);
        return (
          <box
            key={row.id}
            flexDirection="row"
            backgroundColor={panelBg}
          >
            <Text color={termcnColors.primary} backgroundColor={panelBg}>
              │{' '}
            </Text>
            <Text
              color={focused ? termcnColors.selectionFg : bodyFg}
              backgroundColor={
                focused ? termcnColors.selectionBg : panelBg
              }
              bold={focused}
            >
              {line}
            </Text>
            <Text color={termcnColors.primary} backgroundColor={panelBg}>
              {' '}
              │
            </Text>
          </box>
        );
      })}
      <box flexDirection="row" backgroundColor={panelBg}>
        <Text color={termcnColors.primary} backgroundColor={panelBg}>
          │{' '}
        </Text>
        <Text color={muted} backgroundColor={panelBg}>
          {padColumns('', inner)}
        </Text>
        <Text color={termcnColors.primary} backgroundColor={panelBg}>
          {' '}
          │
        </Text>
      </box>
      <Text color={termcnColors.primary} backgroundColor={panelBg}>
        {bottom}
      </Text>
    </box>
  );
}
