import type { ReactNode } from 'react';
import {
  Confirm,
  MultiSelect,
  Select,
  TagEditor,
  TextInput,
} from './termcn.js';
import {
  InstallReview,
  ImportReview,
  SkillMultiSelect,
  type ImportReviewItem,
  type ImportReviewResult,
  type InstallReviewResult,
  type InstallReviewTarget,
} from './reviews.js';
import { InkSession } from './session.js';
import type { Choice, Skill } from '../domain/types.js';

const defaultSession = new InkSession();

function runPrompt<T>(
  cancelledValue: T,
  component: (finish: (value: T) => void) => ReactNode,
  session?: InkSession,
  cancelOnEscape = true
): Promise<T> {
  return (session || defaultSession).show(cancelledValue, component, cancelOnEscape);
}

export function closePrompts(): void {
  defaultSession.close();
}

export function input(message: string): Promise<string | undefined> {
  return runPrompt<string | undefined>(
    undefined,
    (finish) => (
      <TextInput
        label={message}
        onCancel={() => finish(undefined)}
        onSubmit={(value) => finish(value.trim())}
      />
    ),
    undefined,
    false
  );
}

export function editInput(
  message: string,
  initialValue: string,
  session?: InkSession
): Promise<string | undefined> {
  return runPrompt<string | undefined>(undefined, (finish) => (
    <TextInput
      key={message}
      label={message}
      initialValue={initialValue}
      onCancel={() => finish(undefined)}
      onSubmit={(value) => finish(value.trim())}
    />
  ), session, false);
}

export function confirm(message: string, defaultValue = false): Promise<boolean> {
  return runPrompt(false, (finish) => (
    <Confirm message={message} defaultValue={defaultValue} onSubmit={finish} />
  ));
}

export function chooseMany<T extends Skill>(skills: T[], title: string): Promise<T[]> {
  return runPrompt<T[]>([], (finish) => (
    <MultiSelect<T>
      label={title}
      options={skills.map((skill) => ({
        label: skill.name,
        value: skill,
        ...(skill.description ? { hint: skill.description } : {}),
      }))}
      onSubmit={finish}
    />
  ));
}

export async function chooseSkillMany<T extends Skill>(
  groups: { agent: string; skills: T[] }[],
  title: string,
  options: {
    session?: InkSession;
  } = {}
): Promise<T[]> {
  return runPrompt<T[]>(
    [],
    (finish) => (
      <SkillMultiSelect<T>
        groups={groups.map((group) => ({
          agent: group.agent,
          options: group.skills.map((skill) => ({ skill, agent: group.agent })),
        }))}
        label={title}
        onCancel={() => finish([])}
        onSubmit={finish}
      />
    ),
    options.session,
    false
  );
}

export function chooseOne<T extends string>(
  options: Choice<T>[],
  title: string,
  numbered = false,
  session?: InkSession
): Promise<T | undefined> {
  return runPrompt<T | undefined>(undefined, (finish) => (
    <Select<T> label={title} options={options} onSubmit={finish} numbered={numbered} />
  ), session);
}

export function chooseOptionsMany<T extends string>(
  options: Choice<T>[],
  title: string,
  session?: InkSession,
  defaultValues: T[] = []
): Promise<T[]> {
  return runPrompt<T[]>([], (finish) => (
    <MultiSelect<T>
      label={title}
      options={options}
      defaultValues={defaultValues}
      onSubmit={finish}
    />
  ), session);
}

export function reviewImport<T extends Skill>(
  items: ImportReviewItem<T>[],
  existingTags: string[],
  session?: InkSession
): Promise<ImportReviewResult | undefined> {
  return runPrompt<ImportReviewResult | undefined>(undefined, (finish) => (
    <ImportReview<T>
      items={items}
      existingTags={existingTags}
      onSubmit={(result) => finish(result.confirmed ? result : undefined)}
    />
  ), session);
}

export function reviewInstall(
  skills: Skill[],
  targets: InstallReviewTarget[],
  defaultProjectAgents: string[],
  defaultGlobalAgents: string[],
  session: InkSession
): Promise<InstallReviewResult | undefined> {
  return runPrompt<InstallReviewResult | undefined>(undefined, (finish) => (
    <InstallReview
      skills={skills}
      targets={targets}
      defaultProjectAgents={defaultProjectAgents}
      defaultGlobalAgents={defaultGlobalAgents}
      onSubmit={(result) => finish(result.confirmed ? result : undefined)}
    />
  ), session);
}

export function editTags(
  tags: string[],
  initialValues: string[],
  session: InkSession,
  title = '编辑标签'
): Promise<string[] | undefined> {
  return runPrompt<string[] | undefined>(undefined, (finish) => (
    <TagEditor tags={tags} initialValues={initialValues} title={title} onSubmit={finish} />
  ), session);
}
