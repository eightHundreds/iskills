/**
 * Settings list UI — preference rows (label left, value right).
 * Enum: ←→ cycle. Free-text (remote): Enter / ←→ open prompt.
 * Changes persist immediately (no separate save step).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LocalePreference, UserConfig } from '../../domain/user-config.js';
import { applyLocalePreference, formatErrorWithLog, t } from '../../i18n/index.js';
import { termcnColors } from '../components/colors.js';
import { padColumns, textWidth } from '../components/terminal-layout.js';
import { useInput } from '../components/use-input.js';
import { useModal } from '../overlay/host.js';
import { Modal } from '../overlay/static.js';
import { promptText } from '../prompts/present.js';
import { Text, usePanelColors, useStdout } from '../tui/index.js';

type SettingId = 'locale' | 'mcpSecretsInGit' | 'remote';

interface EnumOption<T extends string> {
  value: T;
  label: string;
}

interface SettingRow {
  id: SettingId;
  kind: 'enum' | 'text';
  label: string;
  options: EnumOption<string>[];
  value: string;
  /** Display string (may truncate / use unset label). */
  display: string;
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

/** Prefer keeping the end of long paths/URLs (repo name stays visible). */
function truncateDisplay(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (textWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  let out = text;
  while (out.length > 1 && textWidth(`…${out}`) > maxWidth) {
    out = out.slice(1);
  }
  return `…${out}`;
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
 * Framed settings list: one row per preference.
 * Enum values cycle with ←→; text values open a prompt via Enter / ←→.
 */
export function SettingsPanel({
  initial,
  initialRemote = '',
  onPersist,
  onPersistRemote,
  onClose,
  width: preferredWidth = 56,
}: {
  initial: UserConfig;
  initialRemote?: string;
  /** Persist full config after a change (immediate write). */
  onPersist: (config: UserConfig) => void | Promise<void>;
  /** Persist remote URL; empty clears. Returns the stored URL. */
  onPersistRemote?: (remote: string) => void | Promise<string>;
  onClose: () => void;
  width?: number;
}): ReactNode {
  const { stdout } = useStdout();
  const panel = usePanelColors();
  // Layer content stays mounted under Modal; freeze keys while a modal is on top.
  const { isOpen: modalOpen } = useModal();
  const [config, setConfig] = useState<UserConfig>(initial);
  const [remote, setRemote] = useState(initialRemote);
  const [cursor, setCursor] = useState(0);
  // Bumps when locale preview changes so t() labels re-render.
  const [localeTick, setLocaleTick] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  const viewportWidth = stdout.columns ?? 80;
  const width = Math.min(preferredWidth, Math.max(40, viewportWidth - 8));
  const inner = Math.max(1, width - 4);

  const rows: SettingRow[] = useMemo(() => {
    void localeTick;
    const remoteDisplay = remote
      ? truncateDisplay(remote, Math.max(12, Math.floor(inner * 0.55)))
      : t('config.remoteUnset');
    return [
      {
        id: 'locale',
        kind: 'enum',
        label: t('config.localeTitle'),
        options: localeOptions(),
        value: config.locale,
        display:
          localeOptions().find((option) => option.value === config.locale)
            ?.label ?? config.locale,
      },
      {
        id: 'mcpSecretsInGit',
        kind: 'enum',
        label: t('config.mcpSecretsTitle'),
        options: [
          { value: 'false', label: t('config.mcpSecretsNo') },
          { value: 'true', label: t('config.mcpSecretsYes') },
        ],
        value: config.mcpSecretsInGit ? 'true' : 'false',
        display: config.mcpSecretsInGit
          ? t('config.mcpSecretsYes')
          : t('config.mcpSecretsNo'),
      },
      {
        id: 'remote',
        kind: 'text',
        label: t('config.remoteTitle'),
        options: [],
        value: remote,
        display: remoteDisplay,
      },
    ];
  }, [config.locale, config.mcpSecretsInGit, remote, localeTick, inner]);

  const setRowValue = useCallback(
    (id: SettingId, value: string) => {
      if (id === 'locale') {
        const locale = value as LocalePreference;
        if (locale === configRef.current.locale) return;
        const next: UserConfig = { ...configRef.current, locale };
        setConfig(next);
        configRef.current = next;
        applyLocalePreference(locale);
        setLocaleTick((n) => n + 1);
        void onPersist(next);
        return;
      }
      if (id === 'mcpSecretsInGit') {
        const mcpSecretsInGit = value === 'true';
        if (mcpSecretsInGit === Boolean(configRef.current.mcpSecretsInGit)) return;
        const next: UserConfig = { ...configRef.current, mcpSecretsInGit };
        setConfig(next);
        configRef.current = next;
        void onPersist(next);
      }
    },
    [onPersist]
  );

  const cycleFocused = useCallback(
    (delta: number) => {
      const row = rows[cursor];
      if (!row || row.kind !== 'enum' || row.options.length === 0) return;
      const index = Math.max(
        0,
        row.options.findIndex((option) => option.value === row.value)
      );
      const next = row.options[cycleIndex(row.options.length, index, delta)];
      if (next) setRowValue(row.id, next.value);
    },
    [cursor, rows, setRowValue]
  );

  const editRemote = useCallback(async () => {
    if (!onPersistRemote) return;
    const next = await promptText(
      t('git.remoteAddressPrompt'),
      remoteRef.current,
      t('config.remoteTitle'),
      { clearOnCtrlC: true }
    );
    if (next === undefined) return;
    try {
      const stored = (await onPersistRemote(next)) ?? next.trim();
      setRemote(stored);
      remoteRef.current = stored;
    } catch (error) {
      await Modal.info({
        title: t('config.remoteTitle'),
        content: (await formatErrorWithLog(error)).split('\n'),
      });
    }
  }, [onPersistRemote]);

  useInput(
    (input, key) => {
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
      const row = rows[cursor];
      if (!row) return;
      if (row.kind === 'text') {
        if (key.return || key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
          void editRemote();
        }
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
    },
    { isActive: !modalOpen }
  );

  const title = t('config.settingsTitle');
  const titleWidth = textWidth(title);
  const top = `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`;
  const bottom = `╰${'─'.repeat(Math.max(0, width - 2))}╯`;
  const panelBg = panel.surface;
  const bodyFg = panel.body;
  const muted = panel.muted;

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
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
          const line = formatSettingLine(focused, row.label, row.display, inner);
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
    </box>
  );
}
