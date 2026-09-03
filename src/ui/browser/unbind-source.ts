import { t } from '../../i18n/index.js';
import { Modal } from '../overlay/static.js';

export async function confirmUnbindCollectedSource(name: string): Promise<boolean> {
  return Modal.confirm({
    title: t('browser.unbindSourceTitle'),
    message: t('browser.unbindSourceConfirm', { name }),
  });
}
