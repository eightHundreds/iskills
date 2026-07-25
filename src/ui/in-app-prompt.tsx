import { Box } from 'ink';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ReactNode } from 'react';
import type { CollectedSkill } from '../domain/types.js';
import type { InAppPromptRequest } from '../contracts/browser-app.js';
import type { InstallReviewResult, InstallReviewTarget } from '../contracts/install-review.js';
import { inAppPromptAtom } from './browser-app-store.js';
import { Select, TagEditor, TextInput } from './components/termcn.js';
import { InstallReview } from './reviews.js';

function PromptLayer({ request }: { request: InAppPromptRequest }): ReactNode {
  switch (request.type) {
    case 'text':
      return (
        <TextInput
          label={request.label}
          {...(request.initialValue !== undefined ? { initialValue: request.initialValue } : {})}
          onCancel={() => request.resolve(undefined)}
          onSubmit={(value) => request.resolve(value.trim())}
        />
      );
    case 'tags':
      return (
        <TagEditor
          title={request.title}
          tags={request.tags}
          initialValues={request.initialValues}
          onSubmit={request.resolve}
        />
      );
    case 'choose':
      return (
        <Select
          label={request.title}
          options={request.options}
          onSubmit={(value) => request.resolve(value)}
        />
      );
    case 'install-review':
      return (
        <InstallReview
          skills={request.skills}
          targets={request.targets}
          defaultProjectAgents={request.defaultProjectAgents}
          defaultGlobalAgents={request.defaultGlobalAgents}
          onSubmit={request.resolve}
        />
      );
    default:
      return null;
  }
}

export function InAppPromptHost(): ReactNode {
  const request = useAtomValue(inAppPromptAtom);
  if (!request) return null;
  return (
    <Box flexDirection="column">
      <PromptLayer request={request} />
    </Box>
  );
}

export function useInAppPromptActions(): {
  editInput: (label: string, initialValue: string) => Promise<string | undefined>;
  editTags: (tags: string[], initialValues: string[], title: string) => Promise<string[] | undefined>;
  chooseOne: (
    options: { label: string; value: string }[],
    title: string
  ) => Promise<string | undefined>;
  reviewInstall: (
    skills: CollectedSkill[],
    targets: InstallReviewTarget[],
    defaultProjectAgents: string[],
    defaultGlobalAgents: string[]
  ) => Promise<InstallReviewResult | undefined>;
} {
  const setPrompt = useSetAtom(inAppPromptAtom);
  return {
    editInput: (label, initialValue) =>
      new Promise((resolve) => {
        setPrompt({
          type: 'text',
          label,
          initialValue,
          resolve: (value) => {
            setPrompt(null);
            resolve(value);
          },
        });
      }),
    editTags: (tags, initialValues, title) =>
      new Promise((resolve) => {
        setPrompt({
          type: 'tags',
          title,
          tags,
          initialValues,
          resolve: (value) => {
            setPrompt(null);
            resolve(value);
          },
        });
      }),
    chooseOne: (options, title) =>
      new Promise((resolve) => {
        setPrompt({
          type: 'choose',
          title,
          options,
          resolve: (value) => {
            setPrompt(null);
            resolve(value);
          },
        });
      }),
    reviewInstall: (skills, targets, defaultProjectAgents, defaultGlobalAgents) =>
      new Promise((resolve) => {
        setPrompt({
          type: 'install-review',
          skills,
          targets,
          defaultProjectAgents,
          defaultGlobalAgents,
          resolve: (value) => {
            setPrompt(null);
            resolve(value?.confirmed ? value : undefined);
          },
        });
      }),
  };
}
