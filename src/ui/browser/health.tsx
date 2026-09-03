/**
 * Browser health alerts: live probe → footer ⚠ → Modal details.
 */
import { probeCollectionHealth, type CollectionHealthIssue } from '../../domain/collection-health.js';
import { t } from '../../i18n/index.js';
import { writeClipboardText } from '../../util/clipboard.js';
import { Modal } from '../overlay/static.js';
import { HealthAlertsPanel } from './health-panel.js';
import { buildHealthRepairPrompt } from './health-prompt.js';
import { setBrowserStatus, type BrowserAppStore } from './store.js';

export interface BrowserHealthAlert {
  id: string;
  title: string;
  detail: string;
  issue: CollectionHealthIssue;
}

function healthAlert(
  issue: CollectionHealthIssue,
  title: string,
  detail: string
): BrowserHealthAlert {
  return { id: issue.id, title, detail, issue };
}

export function formatHealthIssue(issue: CollectionHealthIssue): BrowserHealthAlert {
  switch (issue.kind) {
    case 'git-rebase':
      return healthAlert(issue, t('health.gitRebase'), t('health.gitRebaseDetail'));
    case 'git-merge':
      return healthAlert(issue, t('health.gitMerge'), t('health.gitMergeDetail'));
    case 'git-diverged':
      return healthAlert(
        issue,
        t('health.gitDiverged', { branch: issue.branch }),
        t('health.gitDivergedDetail')
      );
    case 'source-conflict':
      return healthAlert(
        issue,
        t('health.sourceConflict', { skill: issue.skill }),
        t('health.sourceConflictDetail')
      );
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}

/** Async live probe for footer health atom. Never throws. */
export async function loadHealthAlerts(): Promise<BrowserHealthAlert[]> {
  try {
    const issues = await probeCollectionHealth();
    return issues.map(formatHealthIssue);
  } catch {
    return [];
  }
}

export async function copyHealthRepairPrompt(
  text: string,
  store: BrowserAppStore | undefined,
  write: (value: string) => Promise<boolean> = writeClipboardText
): Promise<boolean> {
  const ok = Boolean(text) && (await write(text).catch(() => false));
  if (store) {
    setBrowserStatus(
      store,
      ok ? t('browser.copyForAgentCopied') : t('browser.copyForAgentFailed'),
      true,
      ok ? 'normal' : 'error'
    );
  }
  return ok;
}

export async function presentHealthAlerts(
  alerts: BrowserHealthAlert[],
  store?: BrowserAppStore
): Promise<void> {
  if (!alerts.length) {
    await Modal.info({
      title: t('browser.healthTitle'),
      content: [t('browser.healthEmpty')],
    });
    return;
  }
  await Modal.open({
    footerItems: [
      { key: 'c', label: t('browser.copyForAgent') },
      { key: 'Esc', label: t('common.close') },
    ],
    content: (close) => (
      <HealthAlertsPanel
        alerts={alerts}
        onCopy={() => {
          void (async () => {
            const text = buildHealthRepairPrompt(alerts.map((alert) => alert.issue));
            await copyHealthRepairPrompt(text, store);
            close(undefined);
          })();
        }}
        onClose={() => close(undefined)}
      />
    ),
  });
}
