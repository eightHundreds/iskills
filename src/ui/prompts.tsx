import {
  Confirm,
  MultiSelect,
  Select,
  TagEditor,
  TextInput,
} from './components/termcn.js';
import {
  InstallReview,
  ImportReview,
  SkillMultiSelect,
  type ImportReviewItem,
  type ImportReviewResult,
} from './reviews.js';
import type {
  InstallReviewResult,
  InstallReviewTarget,
} from './install-review.js';
import { runScreen } from './run.js';
import type { Choice, Skill } from '../domain/types.js';

export function input(message: string): Promise<string | undefined> {
  return runScreen<string | undefined>(
    undefined,
    (finish) => (
      <TextInput
        label={message}
        onCancel={() => finish(undefined)}
        onSubmit={(value) => finish(value.trim())}
      />
    ),
    false
  );
}

export function editInput(
  message: string,
  initialValue: string
): Promise<string | undefined> {
  return runScreen<string | undefined>(undefined, (finish) => (
    <TextInput
      key={message}
      label={message}
      initialValue={initialValue}
      onCancel={() => finish(undefined)}
      onSubmit={(value) => finish(value.trim())}
    />
  ), false);
}

export function confirm(message: string, defaultValue = false): Promise<boolean> {
  return runScreen(false, (finish) => (
    <Confirm message={message} defaultValue={defaultValue} onSubmit={finish} />
  ));
}

export function chooseMany<T extends Skill>(skills: T[], title: string): Promise<T[]> {
  return runScreen<T[]>([], (finish) => (
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
  title: string
): Promise<T[]> {
  return runScreen<T[]>(
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
    false
  );
}

export function chooseOne<T extends string>(
  options: Choice<T>[],
  title: string,
  numbered = false
): Promise<T | undefined> {
  return runScreen<T | undefined>(undefined, (finish) => (
    <Select<T> label={title} options={options} onSubmit={finish} numbered={numbered} />
  ));
}

export function chooseOptionsMany<T extends string>(
  options: Choice<T>[],
  title: string,
  defaultValues: T[] = []
): Promise<T[]> {
  return runScreen<T[]>([], (finish) => (
    <MultiSelect<T>
      label={title}
      options={options}
      defaultValues={defaultValues}
      onSubmit={finish}
    />
  ));
}

export function reviewImport<T extends Skill>(
  items: ImportReviewItem<T>[],
  existingTags: string[]
): Promise<ImportReviewResult | undefined> {
  return runScreen<ImportReviewResult | undefined>(undefined, (finish) => (
    <ImportReview<T>
      items={items}
      existingTags={existingTags}
      onSubmit={(result) => finish(result.confirmed ? result : undefined)}
    />
  ));
}

export function reviewInstall(
  skills: Skill[],
  targets: InstallReviewTarget[],
  defaultProjectAgents: string[],
  defaultGlobalAgents: string[]
): Promise<InstallReviewResult | undefined> {
  return runScreen<InstallReviewResult | undefined>(undefined, (finish) => (
    <InstallReview
      skills={skills}
      targets={targets}
      defaultProjectAgents={defaultProjectAgents}
      defaultGlobalAgents={defaultGlobalAgents}
      onSubmit={(result) => finish(result.confirmed ? result : undefined)}
    />
  ));
}

export function editTags(
  tags: string[],
  initialValues: string[],
  title = '编辑标签'
): Promise<string[] | undefined> {
  return runScreen<string[] | undefined>(undefined, (finish) => (
    <TagEditor tags={tags} initialValues={initialValues} title={title} onSubmit={finish} />
  ));
}
