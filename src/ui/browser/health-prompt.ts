/**
 * Agent-handoff text for collection health issues.
 * Built for pasting into another agent; the TUI only exposes a copy action.
 */
import { join } from 'node:path';
import {
  listSourceConflictUnmergedFiles,
  type CollectionHealthIssue,
} from '../../domain/collection-health.js';
import { collectionPaths } from '../../domain/core.js';
import { t } from '../../i18n/index.js';

export interface HealthRepairPromptContext {
  collectionRoot: string;
  collectionSkills: string;
  unmergedFiles: (workspace: string) => string[];
}

function incomingSource(issue: Extract<CollectionHealthIssue, { kind: 'source-conflict' }>): string {
  const ref = issue.sourceRef ? ` @ ${issue.sourceRef}` : '';
  const commit = issue.sourceCommit ? ` (${issue.sourceCommit})` : '';
  return `${issue.sourceUrl}${ref}${commit}`;
}

function formatIssue(
  issue: CollectionHealthIssue,
  ctx: HealthRepairPromptContext
): string[] {
  switch (issue.kind) {
    case 'source-conflict': {
      const lines = [
        t('health.repairSourceTitle', { skill: issue.skill }),
        t('health.repairSourceWorkspace', { path: issue.path }),
        t('health.repairSourceLive', { path: join(ctx.collectionSkills, issue.skill) }),
        t('health.repairSourceShape'),
      ];
      if (issue.sourceUrl) {
        lines.push(t('health.repairSourceIncoming', { source: incomingSource(issue) }));
      }
      const unmerged = ctx.unmergedFiles(issue.path);
      if (unmerged.length) {
        lines.push(t('health.repairSourceUnmerged'));
        for (const file of unmerged) {
          lines.push(`- ${file}`);
        }
      }
      lines.push(t('health.repairSourceDone'));
      return lines;
    }
    case 'git-rebase':
      return [
        t('health.gitRebase'),
        t('health.repairGitRebaseDone', { root: ctx.collectionRoot }),
      ];
    case 'git-merge':
      return [
        t('health.gitMerge'),
        t('health.repairGitMergeDone', { root: ctx.collectionRoot }),
      ];
    case 'git-diverged':
      return [
        t('health.gitDiverged', { branch: issue.branch }),
        t('health.repairGitDivergedDone', { root: ctx.collectionRoot }),
      ];
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}

export function formatHealthRepairPrompt(
  issues: CollectionHealthIssue[],
  ctx: HealthRepairPromptContext
): string {
  if (!issues.length) return '';
  const sections = [
    t('health.repairIntro'),
    t('health.repairCollection', { root: ctx.collectionRoot }),
  ];
  for (const issue of issues) {
    sections.push('');
    sections.push(...formatIssue(issue, ctx));
  }
  return sections.join('\n');
}

export function buildHealthRepairPrompt(issues: CollectionHealthIssue[]): string {
  const paths = collectionPaths();
  return formatHealthRepairPrompt(issues, {
    collectionRoot: paths.root,
    collectionSkills: paths.skills,
    unmergedFiles: listSourceConflictUnmergedFiles,
  });
}
