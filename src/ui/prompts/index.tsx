/**
 * CLI interactive I/O adapters (runScreen / overlay confirm).
 *
 * Browser tree-local prompts (editTags / editInput / reviewInstall / …)
 * live under `ui/browser` via useLayer — not duplicated here.
 */
import {
  MultiSelect,
  Select,
  TextInput,
} from '../components/termcn.js';
import { ImportReview, SkillMultiSelect } from '../import/index.js';
import type { ImportReviewItem, ImportReviewResult } from '../import/types.js';
import { confirm as overlayConfirm } from '../overlay/confirm.js';
// Registers overlay bootstrap for command-facing confirm.
import { runScreen } from '../shell/run.js';
import type { Choice, Skill } from '../../domain/types.js';

/** Command confirm — same ModalApi.confirm as Browser (panel). */
export function confirm(
  message: string,
  defaultValue = false
): Promise<boolean> {
  return overlayConfirm(message, defaultValue);
}

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

/** CLI host: mount import review via runScreen. */
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
