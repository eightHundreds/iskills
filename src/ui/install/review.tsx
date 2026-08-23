import type { Skill } from '../../domain/types.js';
import { t } from '../../i18n/index.js';
import { DestinationReview } from './destination-review.js';
import type { InstallReviewResult, InstallReviewTarget } from './types.js';
import type { ReactNode } from 'react';

export function InstallReview({
  skills,
  targets,
  defaultProjectAgents,
  defaultGlobalAgents,
  onSubmit,
}: {
  skills: Skill[];
  targets: InstallReviewTarget[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
  onSubmit: (result: InstallReviewResult) => void;
}): ReactNode {
  return (
    <DestinationReview
      title={t('install.title')}
      itemLine={t('install.skillLine', { names: skills.map((skill) => skill.name).join(', ') })}
      targetsTabLabel={t('install.targetDirs')}
      targetsConfirmLine={(labels) => t('install.targetsLine', { value: labels })}
      method={{
        confirmLine: (copy) => t('install.methodLine', { value: copy ? t('common.copy') : t('common.symlink') }),
      }}
      targets={targets}
      defaultProjectAgents={defaultProjectAgents}
      defaultGlobalAgents={defaultGlobalAgents}
      onSubmit={onSubmit}
    />
  );
}
