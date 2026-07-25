/**
 * Browser TUI package entry: launch + phase shell.
 * Screen bodies live in `browser.tsx` (list) and related modules.
 */
import { Text, useApp } from 'ink';
import { Provider, useAtom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import {
  handleBrowserResult,
  handleDetailAction,
  loadBrowserData,
  loadDetailContext,
} from '../../commands/browser-actions.js';
import { checkGitSkillUpdates } from '../../domain/git.js';
import { InterruptError } from '../shell/terminal.js';
import { useLayer, useModal } from '../overlay/host.js';
import { AppShell } from '../shell/app-shell.js';
import { Select, TagEditor, TextInput } from '../components/termcn.js';
import { InstallReview } from '../install/index.js';
import type { InstallReviewResult, InstallReviewTarget } from '../install/types.js';
import type { CollectedSkill } from '../../domain/types.js';
import {
  enterAlternateScreen,
  leaveAlternateScreen,
  startApp,
} from '../shell/run.js';
import {
  activeAbortAtom,
  browserDataAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserStatusAtom,
  clearTransientStatus,
  detailContextAtom,
  readNavigation,
  setBrowserStatus,
  writeNavigation,
  workingProgressAtom,
  type BrowserAppStore,
} from './store.js';
import { Browser } from './browser.js';
import { Detail, type DetailAction } from './detail.js';
import type {
  BrowserActionHost,
  BrowserAppLifecycle,
  BrowserConfirmRequest,
  BrowserPromptBridge,
  BrowserResult,
  BrowserTab,
  BrowserViewInput,
  DetailEditorContext,
  DetailViewContext,
} from './types.js';

export { Browser } from './browser.js';
export { Detail, type DetailAction } from './detail.js';
export {
  browserFrameDimensions,
  detailFrameDimensions,
  masterDetailLayout,
  type BrowserFrameDimensions,
} from './layout.js';
export {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
  createBrowserAppStore,
  type BrowserNavigationState,
  type BrowserAppStore,
} from './store.js';

function DetailScreen({
  onBack,
  onAction,
}: {
  onBack: () => void;
  onAction: (context: DetailEditorContext, action: Exclude<DetailAction, 'back'>) => Promise<void>;
}): ReactNode {
  const detail = useAtomValue(detailContextAtom);
  if (!detail) return null;

  return (
    <Detail
      skill={detail.skill}
      metadata={detail.metadata}
      links={detail.links}
      collection={detail.collection}
      frameHeight={detail.frameHeight}
      frameWidth={detail.frameWidth}
      finish={(action) => {
        if (action === 'back') {
          onBack();
          return;
        }
        void onAction({ skill: detail.skill, metadata: detail.metadata }, action);
      }}
    />
  );
}

/** Open termcn/review UI via AppShell layer (full-page replace). */
function useBrowserPromptActions(): BrowserPromptBridge {
  const layer = useLayer();
  const present = <T,>(node: (finish: (value: T) => void) => ReactNode): Promise<T> =>
    layer.open({ content: node });

  return {
    editInput: (label, initialValue) =>
      present<string | undefined>((finish) => (
        <TextInput
          key={label}
          label={label}
          initialValue={initialValue}
          onCancel={() => finish(undefined)}
          onSubmit={(value) => finish(value.trim())}
        />
      )),
    editTags: (tags, initialValues, title) =>
      present<string[] | undefined>((finish) => (
        <TagEditor
          key={title}
          title={title}
          tags={tags}
          initialValues={initialValues}
          onSubmit={finish}
        />
      )),
    chooseOne: (options, title) =>
      present<string | undefined>((finish) => (
        <Select
          key={title}
          label={title}
          options={options}
          onSubmit={(value) => finish(value)}
          onCancel={() => finish(undefined)}
        />
      )),
    reviewInstall: (
      skills: CollectedSkill[],
      targets: InstallReviewTarget[],
      defaultProjectAgents: string[],
      defaultGlobalAgents: string[]
    ) =>
      present<InstallReviewResult | undefined>((finish) => (
        <InstallReview
          key={skills.map((skill) => skill.name).join('\0')}
          skills={skills}
          targets={targets}
          defaultProjectAgents={defaultProjectAgents}
          defaultGlobalAgents={defaultGlobalAgents}
          onSubmit={(result) => finish(result.confirmed ? result : undefined)}
        />
      )),
  };
}

/**
 * Phase shell: detail / browse.
 * Full-screen prompts use {@link useLayer}; overlays use {@link useModal}.
 */
export function BrowserApp({ lifecycle }: { lifecycle: BrowserAppLifecycle }): ReactNode {
  const { exit } = useApp();
  const store = useStore() as BrowserAppStore;

  const handleCtrlC = useCallback(() => {
    store.get(activeAbortAtom)?.abort();
    // AppShell only notifies — host owns lifecycle.
    exit(new InterruptError());
  }, [exit, store]);

  return (
    <AppShell onCtrlC={handleCtrlC}>
      <BrowserAppScreens lifecycle={lifecycle} />
    </AppShell>
  );
}

/** Must render under AppShell so layer/modal hooks can open host slots. */
function BrowserAppScreens({ lifecycle }: { lifecycle: BrowserAppLifecycle }): ReactNode {
  const { exit } = useApp();
  const store = useStore() as BrowserAppStore;
  const modal = useModal();
  const [data, setData] = useAtom(browserDataAtom);
  const [status] = useAtom(browserStatusAtom);
  const [phase, setPhase] = useAtom(browserPhaseAtom);
  const [detail, setDetail] = useAtom(detailContextAtom);
  const [working, setWorking] = useAtom(workingProgressAtom);
  const navigation = useAtomValue(browserNavigationAtom);
  const promptActions = useBrowserPromptActions();

  const reloadData = useCallback(async () => {
    const snapshot = await loadBrowserData();
    setData(snapshot);
    return snapshot;
  }, [setData]);

  useEffect(() => {
    if (data) return;
    void reloadData();
  }, [data, reloadData]);

  const requestConfirm = useCallback(
    (request: BrowserConfirmRequest) =>
      modal.confirm({
        title: request.title,
        message: request.message,
        ...(request.details ? { details: request.details } : {}),
      }),
    [modal]
  );

  const actionHost = useMemo((): BrowserActionHost => ({
    lifecycle,
    requestConfirm,
    setWorkingProgress: setWorking,
    setStatus: (text, transient) => setBrowserStatus(store, text, transient),
    reloadData,
    getNavigation: () => readNavigation(store),
    setNavigation: (value) => writeNavigation(store, value),
    prompts: promptActions,
    setAbortController: (controller) => store.set(activeAbortAtom, controller),
  }), [lifecycle, promptActions, reloadData, requestConfirm, setWorking, store]);

  const dispatchResult = useCallback(async (result: BrowserResult) => {
    try {
      clearTransientStatus(store);
      if (result.type === 'quit') {
        exit();
        return;
      }
      if (result.type === 'open') {
        // Navigation already current in the single owner store.
        const detailContext = await loadDetailContext(
          result.skill,
          result.collection,
          result.frameHeight,
          result.frameWidth
        );
        setDetail(detailContext);
        setPhase('detail');
        return;
      }
      await handleBrowserResult(actionHost, result);
    } catch (error) {
      if (error instanceof InterruptError) {
        exit(error);
        return;
      }
      throw error;
    }
  }, [actionHost, exit, setDetail, setPhase, store]);

  if (!data || !navigation) return <Text>加载中…</Text>;

  const viewInput: BrowserViewInput = {
    projectGroups: data.projectGroups,
    collection: data.collection,
    globalGroups: data.globalGroups,
    canSync: data.canSync,
    status: status.text,
    transientStatus: status.transient,
    checkUpdates: checkGitSkillUpdates,
    ...(working
      ? {
          updatingSkillName: working.skillName,
          updatingProgress: { current: working.current, total: working.total },
          workingAction: working.workingAction,
        }
      : {}),
  };

  if (phase === 'detail' && detail) {
    return (
      <DetailScreen
        onBack={() => {
          setPhase('browse');
          setDetail(null);
        }}
        onAction={async (context, action) => {
          await handleDetailAction(actionHost, context, action);
          await reloadData();
          const current = store.get(detailContextAtom);
          if (!current) return;
          setDetail(await loadDetailContext(
            current.skill,
            current.collection,
            current.frameHeight,
            current.frameWidth
          ));
        }}
      />
    );
  }

  return (
    <Browser
      {...viewInput}
      finish={(result) => {
        void dispatchResult(result).catch((error) => {
          if (error instanceof InterruptError) exit(error);
        });
      }}
    />
  );
}

function browserRoot(
  appStore: BrowserAppStore,
  lifecycle: BrowserAppLifecycle
): ReactNode {
  return (
    <Provider store={appStore}>
      <BrowserApp lifecycle={lifecycle} />
    </Provider>
  );
}

/** Package run entry: alternate screen + mount until exit. */
export async function runBrowserApp(
  initialQuery = '',
  initialTab: BrowserTab = 'project',
  store?: BrowserAppStore
): Promise<void> {
  const { createBrowserAppStore } = await import('./store.js');
  const appStore = store ?? createBrowserAppStore(initialQuery, initialTab);
  const initialData = await loadBrowserData();
  appStore.set(browserDataAtom, initialData);

  enterAlternateScreen();

  let app!: ReturnType<typeof startApp>;

  const lifecycle: BrowserAppLifecycle = {
    suspendForSubprocess: async (task) => {
      app.dispose();
      leaveAlternateScreen();
      try {
        await task();
      } finally {
        enterAlternateScreen();
        app = startApp(browserRoot(appStore, lifecycle));
      }
    },
  };

  app = startApp(browserRoot(appStore, lifecycle));
  try {
    await app.waitUntilExit();
  } finally {
    app.dispose();
    leaveAlternateScreen();
  }
}
