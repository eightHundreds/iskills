/**
 * Imperative present helpers built on static {@link Modal} / {@link Layer}.
 *
 * Shared by Browser actions and CLI commands — no React hooks, no PromptPort.
 * Side-effect: loads shell so CLI bootstrap is registered when no host is mounted.
 */
import '../shell/run.js';
import {
  MultiSelect,
  Select,
  TagEditor,
  TextInput,
} from '../components/termcn.js';
import { ImportReview, SkillMultiSelect } from '../import/index.js';
import type { ImportReviewItem, ImportReviewResult } from '../import/types.js';
import { InstallReview } from '../install/index.js';
import type { InstallReviewResult, InstallReviewTarget } from '../install/types.js';
import { Layer, Modal } from '../overlay/static.js';
import type { Choice, CollectedSkill, Skill } from '../../domain/types.js';

/** Single-line text — absolute modal (antd-style small form). */
export function promptText(
  label: string,
  initialValue = ''
): Promise<string | undefined> {
  return Modal.open<string | undefined>({
    content: (close) => (
      <TextInput
        key={label}
        label={label}
        initialValue={initialValue}
        onCancel={() => close(undefined)}
        onSubmit={(value) => close(value.trim())}
      />
    ),
  });
}

/** Tag editor — full-page layer. */
export function promptTags(
  tags: string[],
  initialValues: string[],
  title: string
): Promise<string[] | undefined> {
  return Layer.open<string[] | undefined>({
    content: (close) => (
      <TagEditor
        key={title}
        title={title}
        tags={tags}
        initialValues={initialValues}
        onSubmit={(value) => close(value)}
        onCancel={() => close(undefined)}
      />
    ),
  });
}

/** Single choice — full-page layer. */
export function promptChoice<T extends string>(
  options: Choice<T>[],
  title: string,
  numbered = false
): Promise<T | undefined> {
  return Layer.open<T | undefined>({
    content: (close) => (
      <Select<T>
        key={title}
        label={title}
        options={options}
        numbered={numbered}
        onSubmit={(value) => close(value)}
        onCancel={() => close(undefined)}
      />
    ),
  });
}

/** Multi choice (string options) — full-page layer. */
export function promptChoicesMany<T extends string>(
  options: Choice<T>[],
  title: string,
  defaultValues: T[] = []
): Promise<T[]> {
  return Layer.open<T[]>({
    destroyValue: [],
    content: (close) => (
      <MultiSelect<T>
        key={title}
        label={title}
        options={options}
        defaultValues={defaultValues}
        onSubmit={close}
        onCancel={() => close([])}
      />
    ),
  });
}

/** Multi choice among skills — full-page layer. */
export function promptSkills<T extends Skill>(
  skills: T[],
  title: string
): Promise<T[]> {
  return Layer.open<T[]>({
    destroyValue: [],
    content: (close) => (
      <MultiSelect<T>
        key={title}
        label={title}
        options={skills.map((skill) => ({
          label: skill.name,
          value: skill,
          ...(skill.description ? { hint: skill.description } : {}),
        }))}
        onSubmit={close}
        onCancel={() => close([])}
      />
    ),
  });
}

/** Grouped skill multi-select — full-page layer. */
export function promptSkillGroups<T extends Skill>(
  groups: { agent: string; skills: T[] }[],
  title: string
): Promise<T[]> {
  return Layer.open<T[]>({
    destroyValue: [],
    content: (close) => (
      <SkillMultiSelect<T>
        key={title}
        groups={groups.map((group) => ({
          agent: group.agent,
          options: group.skills.map((skill) => ({ skill, agent: group.agent })),
        }))}
        label={title}
        onCancel={() => close([])}
        onSubmit={close}
      />
    ),
  });
}

/** Install destination review — full-page layer. */
export function promptInstallReview(
  skills: CollectedSkill[],
  targets: InstallReviewTarget[],
  defaultProjectAgents: string[],
  defaultGlobalAgents: string[]
): Promise<InstallReviewResult | undefined> {
  return Layer.open<InstallReviewResult | undefined>({
    content: (close) => (
      <InstallReview
        key={skills.map((skill) => skill.name).join('\0')}
        skills={skills}
        targets={targets}
        defaultProjectAgents={defaultProjectAgents}
        defaultGlobalAgents={defaultGlobalAgents}
        onSubmit={(result) => close(result.confirmed ? result : undefined)}
      />
    ),
  });
}

/** Import review — full-page layer. */
export function promptImportReview<T extends Skill>(
  items: ImportReviewItem<T>[],
  existingTags: string[]
): Promise<ImportReviewResult | undefined> {
  return Layer.open<ImportReviewResult | undefined>({
    content: (close) => (
      <ImportReview<T>
        items={items}
        existingTags={existingTags}
        onSubmit={(result) => close(result.confirmed ? result : undefined)}
      />
    ),
  });
}
