import { t } from '../../i18n/index.js';
import { writeClipboardText } from '../../util/clipboard.js';
import { setBrowserStatus, type BrowserAppStore } from './store.js';

export async function copySkillDiskPath(
  store: BrowserAppStore,
  path: string,
  write: (text: string) => Promise<boolean> = writeClipboardText
): Promise<boolean> {
  const ok = Boolean(path) && (await write(path).catch(() => false));
  setBrowserStatus(
    store,
    ok ? t('browser.pathCopied') : t('browser.copyPathFailed'),
    true,
    ok ? 'normal' : 'error'
  );
  return ok;
}
