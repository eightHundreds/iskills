/**
 * Config UI package: settings list present helper.
 */
import '../shell/run.js';
import type { UserConfig } from '../../domain/user-config.js';
import { t } from '../../i18n/index.js';
import { Layer } from '../overlay/static.js';
import { SettingsPanel } from './settings.js';

export { SettingsPanel } from './settings.js';

/** Open framed settings list. Changes persist immediately; Esc/q closes. */
export function presentSettings(input: {
  initial: UserConfig;
  /** Current collection git origin URL (empty when unset). */
  initialRemote?: string;
  onPersist: (config: UserConfig) => void | Promise<void>;
  /** Persist remote URL; empty string clears origin. Returns stored URL. */
  onPersistRemote?: (remote: string) => void | Promise<string>;
}): Promise<void> {
  return Layer.open<void>({
    destroyValue: undefined,
    footerItems: [
      { key: '↑↓', label: t('common.move') },
      { key: '←→', label: t('config.changeValue') },
      { key: 'Enter', label: t('config.editValue') },
      { key: 'Esc', label: t('common.close') },
    ],
    content: (close) => (
      <SettingsPanel
        initial={input.initial}
        initialRemote={input.initialRemote ?? ''}
        onPersist={input.onPersist}
        {...(input.onPersistRemote
          ? { onPersistRemote: input.onPersistRemote }
          : {})}
        onClose={() => close(undefined)}
      />
    ),
  });
}
