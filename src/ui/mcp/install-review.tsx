import type { ReactNode } from 'react';
import type { McpInstallReviewOptions, McpScope } from '../../domain/mcp/index.js';
import { scanContext } from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { DestinationReview } from '../install/destination-review.js';
import { Layer } from '../overlay/static.js';
import { labeledMcpInstallTargets } from './format.js';

export interface McpInstallReviewResult {
  confirmed: boolean;
  destination: McpScope;
  agents: string[];
}

export function promptMcpInstallReview(
  names: string[],
  options: McpInstallReviewOptions
): Promise<{ destination: McpScope; agents: string[] } | undefined> {
  return Layer.open<{ destination: McpScope; agents: string[] } | undefined>({
    footerItems: [
      { key: '↑↓', label: t('common.move') },
      { key: 'Space', label: t('common.select') },
      { key: 'Enter', label: t('common.confirm') },
      { key: '←', label: t('common.back') },
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <McpInstallReview
        names={names}
        targets={labeledMcpInstallTargets(options.targets, scanContext())}
        defaultProjectAgents={options.defaultProjectAgents}
        defaultGlobalAgents={options.defaultGlobalAgents}
        onSubmit={(result) => close(result.confirmed ? {
          destination: result.destination,
          agents: result.agents,
        } : undefined)}
      />
    ),
  });
}

export function McpInstallReview({
  names,
  targets,
  defaultProjectAgents,
  defaultGlobalAgents,
  onSubmit,
}: {
  names: string[];
  targets: { value: string; projectLabel?: string; globalLabel?: string }[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
  onSubmit: (result: McpInstallReviewResult) => void;
}): ReactNode {
  return (
    <DestinationReview
      title={t('mcp.installTitle')}
      itemLine={t('mcp.mcpLine', { names: names.join(', ') })}
      targetsTabLabel={t('mcp.targetsTab')}
      targetsConfirmLine={(labels) => t('mcp.targetsLine', { value: labels })}
      targets={targets}
      defaultProjectAgents={defaultProjectAgents}
      defaultGlobalAgents={defaultGlobalAgents}
      onSubmit={(result) => onSubmit({
        confirmed: result.confirmed,
        destination: result.destination,
        agents: result.agents,
      })}
    />
  );
}
