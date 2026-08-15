import { isCrossAgentInstallable } from '../../domain/cross-agent-install.js';
import type { CollectedSkill, Skill } from '../../domain/types.js';
import type {
  FooterBrowseCapabilities,
  FooterEnterAction,
} from '../footer/types.js';
import {
  flatRows,
  groupedRows,
  skillsForTagFilter,
  visibleAgentGroups,
  TAG_FILTER_ALL,
} from './format.js';
import type { BrowserDataSnapshot, BrowserFocus, BrowserTab, DetailFieldId } from './types.js';

export function enterActionFor(
  tab: BrowserTab,
  selectionCount: number,
  currentIsSkill: boolean,
  masterDetail: boolean
): FooterEnterAction {
  if (tab === 'collection' && selectionCount > 0) return 'add';
  if (!currentIsSkill) return null;
  // Master-detail: collection Enter focuses the detail column (same as →);
  // project/global right pane is preview-only — no Enter activation.
  if (masterDetail) return tab === 'collection' ? 'detail' : null;
  if (tab === 'collection') return 'detail';
  // Project / global narrow: Enter opens fullscreen view (no → detail).
  return 'view';
}

export function browseSelectionSets(
  selected: Set<string>,
  data: Pick<BrowserDataSnapshot, 'collection' | 'projectGroups' | 'globalGroups'>
): {
  selectedCollection: CollectedSkill[];
  selectedProject: Skill[];
  selectedGlobal: Skill[];
  selectedProjectLocal: Skill[];
  selectedGlobalLocal: Skill[];
} {
  const selectedCollection = data.collection.filter((skill) => selected.has(skill.path));
  const projectSkills = data.projectGroups.flatMap((group) => group.skills);
  const selectedProject = projectSkills.filter((skill) => selected.has(skill.path));
  const selectedGlobal = data.globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path))
  );
  return {
    selectedCollection,
    selectedProject,
    selectedGlobal,
    selectedProjectLocal: selectedProject.filter((skill) => !skill.fromCollection),
    selectedGlobalLocal: selectedGlobal.filter((skill) => !skill.fromCollection),
  };
}

/** Selected-or-current skills on project/global location tabs (materialize / cross-agent). */
export function projectActionSkills(
  tab: BrowserTab,
  selectedAtLocation: Skill[],
  currentSkill: Skill | undefined
): Skill[] {
  if (tab !== 'project' && tab !== 'global') return [];
  if (selectedAtLocation.length) return selectedAtLocation;
  return currentSkill ? [currentSkill] : [];
}

export function computeBrowseCapabilities(
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
  masterDetail: boolean,
  /** Must match Browser `tagFilter` (default all). */
  tagFilter: string = TAG_FILTER_ALL,
  detailField?: DetailFieldId
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

  // Master-detail skill column is flat (no group headers), matching Browser listRows.
  const tabSkills =
    tab === 'collection'
      ? data.collection
      : tab === 'project'
        ? projectGroup?.skills ?? []
        : globalGroup?.skills ?? [];
  // Same list model as Browser: tag filter then query (master-detail flat / else grouped).
  const filteredSkills = skillsForTagFilter(tabSkills, tagFilter);
  const projectRows = groupedRows(filteredSkills, query);
  const collectionRows = groupedRows(filteredSkills, query);
  const globalRows = flatRows(filteredSkills, query);
  const rows = masterDetail
    ? flatRows(filteredSkills, query)
    : tab === 'project'
      ? projectRows
      : tab === 'global'
        ? globalRows
        : collectionRows;
  const currentRow = rows[navigation.cursor];
  const currentSkill =
    currentRow?.type === 'skill' ? currentRow.skill : undefined;

  const {
    selectedCollection,
    selectedProject,
    selectedGlobal,
    selectedProjectLocal,
    selectedGlobalLocal,
  } = browseSelectionSets(selected, data);

  const actionSkills = projectActionSkills(
    tab,
    tab === 'global' ? selectedGlobal : selectedProject,
    currentSkill
  );
  const canMaterialize =
    focus === 'list' &&
    tab === 'project' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);
  const canInstallToAgents =
    focus === 'list' &&
    (tab === 'project' || tab === 'global') &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => isCrossAgentInstallable(skill));

  const canDelete =
    focus === 'list' &&
    (selectedCollection.length > 0 ||
      selectedProject.length > 0 ||
      selectedGlobal.length > 0 ||
      Boolean(currentSkill));

  const enterAction =
    focus === 'list'
      ? enterActionFor(
          tab,
          tab === 'collection' ? selectedCollection.length : 0,
          Boolean(currentSkill),
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

  const canFocusDetail =
    focus === 'list' &&
    masterDetail &&
    tab === 'collection' &&
    currentRow?.type === 'skill';
  const detailEnterAction: FooterBrowseCapabilities['detailEnterAction'] =
    focus === 'detail' && tab === 'collection' && currentSkill
      ? detailField === 'source'
        ? 'open'
        : 'edit'
      : null;

  // Tag jump (`g`): only when current tab has at least one group header (non-all filter source).
  const hasTagGroups = groupedRows(tabSkills, '').some((row) => row.type === 'group');
  const canJumpTag = focus === 'list' && hasTagGroups;
  const canSync =
    focus === 'list' && tab === 'collection' && data.canSync;

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
    canInstallToAgents,
    updateCount,
    updateIsSelection,
    selectionCount: focus === 'list' ? selectionCount : 0,
    canFocusDetail,
    detailEnterAction,
    canJumpTag,
    canSync,
  };
}
