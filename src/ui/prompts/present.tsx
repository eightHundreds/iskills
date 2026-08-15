/**
 * Imperative present helpers built on static {@link Modal} / {@link Layer}.
 *
 * Shared by Browser actions and CLI commands — no React hooks, no PromptPort.
 * Side-effect: loads shell so CLI bootstrap is registered when no host is mounted.
 */
import '../shell/run.js';
import { ModalPanel } from '../components/modal-panel.js';
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
import type { FooterItem } from '../footer/types.js';
import { t } from '../../i18n/index.js';

function selectFooterItems(): FooterItem[] {
  return [
    { key: '↑↓', label: t('common.move') },
    { key: 'Enter', label: t('common.confirm') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

function multiSelectFooterItems(): FooterItem[] {
  return [
    { key: 'Space', label: t('common.select') },
    { key: 'Enter', label: t('common.confirm') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

function tagEditorFooterItems(): FooterItem[] {
  return [
    { key: '↑↓', label: t('common.move') },
    { key: 'Space', label: t('common.select') },
    { key: 'Tab', label: t('common.switch') },
    { key: 'Enter', label: t('common.confirm') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

function skillSelectFooterItems(): FooterItem[] {
  return [
    { key: '↑↓', label: t('common.move') },
    { key: 'Space', label: t('common.select') },
    { key: '→', label: t('common.detail') },
    { key: 'a', label: t('common.all') },
    { key: '←→', label: t('common.switch') },
    { key: 'Enter', label: t('common.confirm') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

function importReviewFooterItems(): FooterItem[] {
  return [
    { key: 'Space', label: t('common.select') },
    { key: 'Enter', label: t('common.confirm') },
    { key: '←→', label: t('common.switch') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

function installReviewFooterItems(): FooterItem[] {
  return [
    { key: '↑↓', label: t('common.move') },
    { key: 'Space', label: t('common.select') },
    { key: 'Enter', label: t('common.confirm') },
    { key: '←', label: t('common.back') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

/** Single-line text — absolute modal with theme-aware solid panel. */
export function promptText(
  label: string,
  initialValue = '',
  /** Optional top-left border title (same panel as tag editor). */
  title?: string,
  /** Only the collection-remote field should pass `{ clearOnCtrlC: true }`. */
  options?: { clearOnCtrlC?: boolean }
): Promise<string | undefined> {
  const clearOnCtrlC = options?.clearOnCtrlC === true;
  return Modal.open<string | undefined>({
    footerItems: [
      { key: 'Enter', label: t('common.confirm') },
      ...(clearOnCtrlC ? [{ key: 'Ctrl+C', label: t('common.clear') }] : []),
      { key: 'Esc', label: t('common.cancel') },
    ],
    content: (close) => (
      <ModalPanel {...(title !== undefined ? { title: ` ${title} ` } : {})}>
        <TextInput
          key={label}
          label={label}
          initialValue={initialValue}
          {...(clearOnCtrlC ? { clearOnCtrlC: true } : {})}
          onCancel={() => close(undefined)}
          onSubmit={(value) => close(value.trim())}
        />
      </ModalPanel>
    ),
  });
}

/** Tag editor — absolute modal over the current screen (browser stays visible). */
export function promptTags(
  tags: string[],
  initialValues: string[],
  title: string
): Promise<string[] | undefined> {
  return Modal.open<string[] | undefined>({
    footerItems: tagEditorFooterItems(),
    content: (close) => (
      <ModalPanel title={` ${title} `}>
        <TagEditor
          key={title}
          tags={tags}
          initialValues={initialValues}
          onSubmit={(value) => close(value)}
          onCancel={() => close(undefined)}
        />
      </ModalPanel>
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
    footerItems: selectFooterItems(),
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
    footerItems: multiSelectFooterItems(),
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
    footerItems: multiSelectFooterItems(),
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
    footerItems: skillSelectFooterItems(),
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
    footerItems: installReviewFooterItems(),
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
    footerItems: importReviewFooterItems(),
    content: (close) => (
      <ImportReview<T>
        items={items}
        existingTags={existingTags}
        onSubmit={(result) => close(result.confirmed ? result : undefined)}
      />
    ),
  });
}
