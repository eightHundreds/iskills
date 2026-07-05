import type { ReactNode } from 'react';
import { realpath } from 'node:fs/promises';
import { listCollection } from './core.js';
import { Confirm, MultiSelect, Select, SkillMultiSelect, TagEditor, TextInput } from './ui/termcn.js';
import { InkSession } from './ui/session.js';
import type { Choice, Skill } from './types.js';

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
  session?: InkSession
): Promise<T[]> {
  const collection = await listCollection().catch(() => []);
  const noteByPath = new Map<string, string>();
  for (const skill of collection) {
    if (skill.note) noteByPath.set(skill.path, skill.note);
  }
  const realpathBySkillPath = new Map<string, string>();
  await Promise.all(
    groups.flatMap((group) =>
      group.skills.map(async (skill) => {
        try {
          realpathBySkillPath.set(skill.path, await realpath(skill.path));
        } catch {
          // ignore unresolved symlinks
        }
      })
    )
  );
  const collectionNote = (skill: T): string | undefined => {
    const real = realpathBySkillPath.get(skill.path);
    if (!real) return undefined;
    return noteByPath.get(real);
  };
  return runPrompt<T[]>(
    [],
    (finish) => (
      <SkillMultiSelect<T>
        groups={groups.map((group) => ({
          agent: group.agent,
          options: group.skills.map((skill) => ({ skill, agent: group.agent })),
        }))}
        label={title}
        collectionNote={collectionNote}
        onSubmit={finish}
      />
    ),
    session
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
  session?: InkSession
): Promise<T[]> {
  return runPrompt<T[]>([], (finish) => (
    <MultiSelect<T> label={title} options={options} onSubmit={finish} />
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
