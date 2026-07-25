/**
 * Browser TUI package entry: launch + phase shell.
 * Screen bodies live in `browser.tsx` (list) and related modules.
 */
import { Text, useApp } from 'ink';
import { Provider, useAtom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  handleBrowserResult,
  handleDetailAction,
  loadBrowserData,
  loadDetailContext,
} from '../../commands/browser-actions.js';
import { checkGitSkillUpdates } from '../../domain/git.js';
import { InterruptError } from '../terminal.js';
import { AppShell } from '../app-shell.js';
import {
  enterAlternateScreen,
  leaveAlternateScreen,
  startApp,
} from '../run.js';
import {
  activeAbortAtom,
  browserDataAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserStatusAtom,
  clearTransientStatus,
  detailContextAtom,
  inAppPromptAtom,
  readNavigation,
  setBrowserStatus,
  writeNavigation,
  workingProgressAtom,
  type BrowserAppStore,
} from './browser-app-store.js';
import { Browser } from './browser.js';
import { Detail, type DetailAction } from './detail.js';
import { InAppPromptHost, useInAppPromptActions } from './in-app-prompt.js';
import type {
  BrowserActionHost,
  BrowserAppLifecycle,
  BrowserConfirmRequest,
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
} from './browser-layout.js';
export {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
  createBrowserAppStore,
  type BrowserNavigationState,
  type BrowserAppStore,
} from './browser-app-store.js';

interface BrowserConfirmation {
  title: string;
  message: string;
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

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

/** Phase shell: prompt / detail / browse. */
export function BrowserApp({ lifecycle }: { lifecycle: BrowserAppLifecycle }): ReactNode {
  const { exit } = useApp();
  const store = useStore() as BrowserAppStore;
  const promptActive = useAtomValue(inAppPromptAtom);
  const [data, setData] = useAtom(browserDataAtom);
  const [status] = useAtom(browserStatusAtom);
  const [phase, setPhase] = useAtom(browserPhaseAtom);
  const [detail, setDetail] = useAtom(detailContextAtom);
  const [working, setWorking] = useAtom(workingProgressAtom);
  const navigation = useAtomValue(browserNavigationAtom);
  const promptActions = useInAppPromptActions();
  const [confirmation, setConfirmation] = useState<BrowserConfirmation | undefined>();

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
      new Promise<boolean>((resolve) => {
        setConfirmation({
          title: request.title,
          message: request.message,
          ...(request.details ? { details: request.details } : {}),
          onConfirm: () => {
            setConfirmation(undefined);
            resolve(true);
          },
          onCancel: () => {
            setConfirmation(undefined);
            resolve(false);
          },
        });
      }),
    []
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

  const handleCtrlC = useCallback(() => {
    store.get(activeAbortAtom)?.abort();
    // AppShell only notifies — host owns lifecycle.
    exit(new InterruptError());
  }, [exit, store]);

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

  if (promptActive) {
    return (
      <AppShell onCtrlC={handleCtrlC}>
        <InAppPromptHost />
      </AppShell>
    );
  }

  if (phase === 'detail' && detail) {
    return (
      <AppShell onCtrlC={handleCtrlC}>
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
      </AppShell>
    );
  }

  return (
    <AppShell onCtrlC={handleCtrlC}>
      <Browser
        {...viewInput}
        confirmation={confirmation}
        finish={(result) => {
          void dispatchResult(result).catch((error) => {
            if (error instanceof InterruptError) exit(error);
          });
        }}
      />
    </AppShell>
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
  const { createBrowserAppStore } = await import('./browser-app-store.js');
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
