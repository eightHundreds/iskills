import { useStdout } from 'ink';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { CollectedSkill, Skill } from '../../domain/types.js';
import { PointerSurface } from '../components/mouse/index.js';
import { TextInput } from '../components/text-input.js';
import { resolveFooter } from '../footer/resolve-footer.js';
import type {
  FooterBrowseCapabilities,
  FooterEnterAction,
  FooterResolveInput,
} from '../footer/types.js';
import { useOverlayFooterItems } from '../overlay/host.js';
import { FooterPaint } from '../shell/footer.js';
import {
  flatRows,
  groupedRows,
  visibleAgentGroups,
} from './format.js';
import { masterDetailLayout } from './layout.js';
import {
  browserDataAtom,
  browserFilterAtom,
  browserGroupJumpAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserSelectionAtom,
  browserStatusAtom,
  browserUpdateCheckAtom,
  clearTransientStatus,
  workingProgressAtom,
  type BrowserAppStore,
} from './store.js';
import type { BrowserDataSnapshot, BrowserFocus, BrowserTab } from './types.js';

function enterActionFor(
  tab: BrowserTab,
  selectionCount: number,
  currentIsSkill: boolean,
  canViewWithRightArrow: boolean,
  masterDetail: boolean
): FooterEnterAction {
  if (tab === 'collection' && selectionCount > 0) return 'add';
  if (!currentIsSkill) return null;
  // 3-column layout already peeks detail in the right pane — omit Enter 详情/查看.
  if (masterDetail) return null;
  if (tab === 'collection') return 'detail';
  if (canViewWithRightArrow) return null;
  return 'view';
}

/**
 * Browser session footer: overlay + browse/filter/working from jotai.
 * Mount as AppShell bottomChrome under the browser Provider.
 */
export function BrowserShellFooter(): ReactNode {
  const overlayItems = useOverlayFooterItems();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 80;
  const store = useStore() as BrowserAppStore;
  const navigation = useAtomValue(browserNavigationAtom);
  const selected = useAtomValue(browserSelectionAtom);
  const data = useAtomValue(browserDataAtom);
  const status = useAtomValue(browserStatusAtom);
  const working = useAtomValue(workingProgressAtom);
  const phase = useAtomValue(browserPhaseAtom);
  const filter = useAtomValue(browserFilterAtom);
  const groupJump = useAtomValue(browserGroupJumpAtom);
  const updateCheck = useAtomValue(browserUpdateCheckAtom);
  const setFilter = useSetAtom(browserFilterAtom);
  const setNavigation = useSetAtom(browserNavigationAtom);

  useEffect(() => {
    if (!status.text || !status.transient) return undefined;
    const timer = setTimeout(() => clearTransientStatus(store), 3500);
    return () => clearTimeout(timer);
  }, [status.text, status.transient, status.kind, store]);

  // Avoid painting browse keys before Browser data/main content is ready
  // (footer chrome is outside the list tree and would race empty-frame waits).
  if (!navigation || !data) {
    if (overlayItems) {
      return (
        <FooterPaint
          view={resolveFooter({
            overlayItems,
            suppressed: false,
            filterOpen: false,
            filterDraft: '',
            working: null,
            browse: null,
            status: null,
            updateCheck: null,
            columns,
          })}
        />
      );
    }
    return null;
  }

  const masterDetail = masterDetailLayout(stdout.columns, stdout.rows);
  const browse =
    phase === 'browse' && !groupJump && !filter.open && !working
      ? computeBrowseCapabilities(
          navigation,
          selected,
          data,
          updateCheck,
          masterDetail
        )
      : null;

  const input: FooterResolveInput = {
    overlayItems,
    suppressed: phase === 'detail' || groupJump,
    filterOpen: filter.open && phase === 'browse' && !overlayItems,
    filterDraft: filter.draft,
    working:
      working && phase === 'browse' && !overlayItems && !filter.open && !groupJump
        ? {
            action: working.workingAction,
            current: working.current,
            total: working.total,
          }
        : null,
    workingItems: [],
    browse,
    status: status.text ? { kind: status.kind, text: status.text } : null,
    updateCheck: {
      checking: updateCheck.checking,
      failed: updateCheck.failed,
    },
    columns,
  };

  const view = resolveFooter(input);

  if (view.mode === 'input') {
    // Exclusive pointer surface: mute base chrome (tabs) while filter owns input.
    // Inline single-row field (spec: full footer becomes `筛选: ` + draft).
    return (
      <PointerSurface id="filter">
        <TextInput
          variant="inline"
          label={view.label}
          initialValue={view.value}
          onChange={(draft) => {
            setFilter((current) => ({ ...current, open: true, draft }));
            setNavigation((current) =>
              current ? { ...current, query: draft, cursor: 0 } : current
            );
          }}
          onCancel={() => {
            const prior = store.get(browserFilterAtom);
            setFilter({
              open: false,
              draft: '',
              queryBefore: '',
              cursorBefore: 0,
            });
            setNavigation((current) =>
              current
                ? {
                    ...current,
                    query: prior.queryBefore,
                    cursor: prior.cursorBefore,
                  }
                : current
            );
          }}
          onSubmit={(value) => {
            setFilter({
              open: false,
              draft: value,
              queryBefore: '',
              cursorBefore: 0,
            });
            setNavigation((current) =>
              current ? { ...current, query: value } : current
            );
          }}
        />
      </PointerSurface>
    );
  }

  return <FooterPaint view={view} />;
}

function computeBrowseCapabilities(
  navigation: {
    tab: BrowserTab;
    focus: BrowserFocus;
    query: string;
    cursor: number;
    agent: string;
  },
  selected: Set<string>,
  data: BrowserDataSnapshot,
  updateCheck: { checking: boolean; updates: Set<string>; failed: number },
  masterDetail: boolean
): FooterBrowseCapabilities {
  const tab = navigation.tab;
  const focus = navigation.focus;
  const query = navigation.query;
  const selectionCount = selected.size;

  const visibleProject = visibleAgentGroups(data.projectGroups);
  const visibleGlobal = visibleAgentGroups(data.globalGroups);
  const projectGroup =
    visibleProject.find((g) => g.agent === navigation.agent) ?? visibleProject[0];
  const globalGroup =
    visibleGlobal.find((g) => g.agent === navigation.agent) ?? visibleGlobal[0];

  const projectRows = groupedRows(projectGroup?.skills ?? [], query);
  const collectionRows = groupedRows(data.collection, query);
  const globalRows = flatRows(globalGroup?.skills ?? [], query);
  const rows =
    tab === 'project' ? projectRows : tab === 'global' ? globalRows : collectionRows;
  const currentRow = rows[navigation.cursor];
  const currentSkill =
    currentRow?.type === 'skill' ? currentRow.skill : undefined;

  const selectedCollection = data.collection.filter((skill: CollectedSkill) =>
    selected.has(skill.path)
  );
  const projectSkills = data.projectGroups.flatMap((group) => group.skills);
  const selectedProject = projectSkills.filter((skill: Skill) => selected.has(skill.path));
  const selectedGlobal = data.globalGroups.flatMap((group) =>
    group.skills.filter((skill: Skill) => selected.has(skill.path))
  );
  const selectedProjectLocal = selectedProject.filter((skill: Skill) => !skill.fromCollection);
  const selectedGlobalLocal = selectedGlobal.filter((skill: Skill) => !skill.fromCollection);

  const actionSkills: Skill[] =
    tab === 'project'
      ? selectedProject.length
        ? selectedProject
        : currentSkill
          ? [currentSkill]
          : []
      : [];
  const canMaterialize =
    focus === 'list' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);

  const canDelete =
    focus === 'list' &&
    (selectedCollection.length > 0 ||
      selectedProject.length > 0 ||
      selectedGlobal.length > 0 ||
      Boolean(currentSkill));

  const canViewWithRightArrow =
    Boolean(currentSkill) &&
    (tab === 'collection' || Boolean(currentSkill?.fromCollection));

  const enterAction =
    focus === 'list'
      ? enterActionFor(
          tab,
          tab === 'collection' ? selectedCollection.length : 0,
          Boolean(currentSkill),
          canViewWithRightArrow,
          masterDetail
        )
      : null;

  const selectedUpdates = selectedCollection.filter((s) =>
    updateCheck.updates.has(s.name)
  );
  let updateCount = 0;
  let updateIsSelection = false;
  if (tab === 'collection' && focus === 'list') {
    if (selectedCollection.length && selectedUpdates.length) {
      updateCount = selectedUpdates.length;
      updateIsSelection = true;
    } else if (
      !selectedCollection.length &&
      currentSkill &&
      updateCheck.updates.has(currentSkill.name)
    ) {
      updateCount = 1;
      updateIsSelection = false;
    }
  }

  return {
    focus: focus as FooterBrowseCapabilities['focus'],
    canDelete,
    enterAction,
    canTag: tab === 'collection' && selectedCollection.length > 0 && focus === 'list',
    canImport:
      focus === 'list' &&
      ((tab === 'project' && selectedProjectLocal.length > 0) ||
        (tab === 'global' && selectedGlobalLocal.length > 0)),
    canMaterialize,
    updateCount,
    updateIsSelection,
    selectionCount: focus === 'list' ? selectionCount : 0,
  };
}
