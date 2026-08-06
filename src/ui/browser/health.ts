/**
 * Browser health alerts: live probe → footer ⚠ → Modal details.
 */
import { probeCollectionHealth, type CollectionHealthIssue } from '../../domain/collection-health.js';
import { Modal } from '../overlay/static.js';
import { t } from '../../i18n/index.js';

export interface BrowserHealthAlert {
  id: string;
  title: string;
  detail: string;
}

export function formatHealthIssue(issue: CollectionHealthIssue): BrowserHealthAlert {
  switch (issue.kind) {
    case 'git-rebase':
      return {
        id: issue.id,
        title: t('health.gitRebase'),
        detail: t('health.gitRebaseDetail'),
      };
    case 'git-merge':
      return {
        id: issue.id,
        title: t('health.gitMerge'),
        detail: t('health.gitMergeDetail'),
      };
    case 'git-diverged':
      return {
        id: issue.id,
        title: t('health.gitDiverged', { branch: issue.branch }),
        detail: t('health.gitDivergedDetail'),
      };
    case 'source-conflict':
      return {
        id: issue.id,
        title: t('health.sourceConflict', { skill: issue.skill }),
        detail: t('health.sourceConflictDetail'),
      };
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

export async function presentHealthAlerts(alerts: BrowserHealthAlert[]): Promise<void> {
  if (!alerts.length) {
    await Modal.info({
      title: t('browser.healthTitle'),
      content: [t('browser.healthEmpty')],
    });
    return;
  }
  const content: string[] = [];
  for (const [index, alert] of alerts.entries()) {
    if (index > 0) content.push('');
    content.push(alert.title);
    content.push(`  ${alert.detail}`);
  }
  await Modal.info({
    title: t('browser.healthTitle'),
    content,
  });
}
