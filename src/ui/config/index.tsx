/**
 * Config UI package: settings list present helper.
 */
import '../shell/run.js';
import type { UserConfig } from '../../domain/user-config.js';
import { t } from '../../i18n/index.js';
import { Modal } from '../overlay/static.js';
import { SettingsPanel } from './settings.js';

export { SettingsPanel } from './settings.js';

/** Open framed settings list. Changes persist immediately; Esc/q closes. */
export function presentSettings(input: {
  initial: UserConfig;
  onPersist: (config: UserConfig) => void | Promise<void>;
}): Promise<void> {
  return Modal.open<void>({
    destroyValue: undefined,
    footerItems: [
      { key: '↑↓', label: t('common.move') },
      { key: '←→', label: t('config.changeValue') },
      { key: 'Esc', label: t('common.close') },
    ],
    content: (close) => (
      <SettingsPanel
        initial={input.initial}
        onPersist={input.onPersist}
        onClose={() => close(undefined)}
      />
    ),
  });
}
