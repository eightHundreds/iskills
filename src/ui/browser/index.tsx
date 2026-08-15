/**
 * Browser TUI package entry: launch + phase shell.
 * Screen bodies live in `browser.tsx` (list) and related modules.
 */
import { Text, useApp } from '../tui/index.js';
import { Provider, useAtom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  adoptMissingCollectionMetadata,
  handleBrowserResult,
  handleDetailAction,
  handleOpenCollectedGitHubSource,
  loadBrowserData,
  loadDetailContext,
} from '../../commands/browser-actions.js';
import { checkGitSkillUpdates } from '../../domain/git.js';
import { InterruptError } from '../shell/terminal.js';
import { AppShell } from '../shell/app-shell.js';
import { startApp } from '../shell/run.js';
import { Modal } from '../overlay/static.js';
import { BrowserShellFooter } from './footer.js';
import {
  activeAbortAtom,
  browserDataAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserStatusAtom,
  clearTransientStatus,
  detailContextAtom,
  invalidateUpdateCheck,
  readNavigation,
  scheduleHealthRefresh,
  setBrowserStatus,
  writeNavigation,
  workingProgressAtom,
  type BrowserAppStore,
} from './store.js';
import { Browser } from './browser.js';
import { Detail, type DetailAction } from './detail.js';
import { formatAppError, t } from '../../i18n/index.js';
import type {
  BrowserActionHost,
  BrowserAppLifecycle,
  BrowserResult,
  BrowserTab,
  BrowserViewInput,
  DetailEditorContext,
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

/**
 * Phase shell: detail / browse.
 * Imperative prompts use static Modal/Layer (active OverlayHost under AppShell).
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
    <AppShell onCtrlC={handleCtrlC} bottomChrome={<BrowserShellFooter />}>
      <BrowserAppScreens lifecycle={lifecycle} />
    </AppShell>
  );
}

/** Must render under AppShell so OverlayHost is registered for static Modal/Layer. */
function BrowserAppScreens({ lifecycle }: { lifecycle: BrowserAppLifecycle }): ReactNode {
  const { exit } = useApp();
  const store = useStore() as BrowserAppStore;
  const [data, setData] = useAtom(browserDataAtom);
  const [status] = useAtom(browserStatusAtom);
  const [phase, setPhase] = useAtom(browserPhaseAtom);
  const [detail, setDetail] = useAtom(detailContextAtom);
  const [working, setWorking] = useAtom(workingProgressAtom);
  const navigation = useAtomValue(browserNavigationAtom);
  const adoptPromptedRef = useRef(false);

  const reloadData = useCallback(async () => {
    const snapshot = await loadBrowserData();
    setData(snapshot);
    scheduleHealthRefresh(store);
    return snapshot;
  }, [setData, store]);

  useEffect(() => {
    if (data) return;
    void reloadData();
  }, [data, reloadData]);

  // Initial health probe (async); also re-runs after each reloadData.
  useEffect(() => {
    scheduleHealthRefresh(store);
  }, [store]);

  // Tier-2 adopt: one session prompt when skills/ has trees without metadata files.
  useEffect(() => {
    if (!data || adoptPromptedRef.current) return;
    const missing = data.skillsMissingMetadata;
    if (!missing.length) {
      adoptPromptedRef.current = true;
      return;
    }
    adoptPromptedRef.current = true;
    void (async () => {
      const ok = await Modal.confirm({
        title: t('browser.adoptMissingTitle'),
        message: t('browser.adoptMissingMessage', { count: missing.length }),
        details: missing,
        defaultValue: true,
      });
      if (!ok) return;
      try {
        const adopted = await adoptMissingCollectionMetadata(missing);
        await reloadData();
        setBrowserStatus(
          store,
          t('browser.adoptedCount', { count: adopted.length }),
          true,
          'normal'
        );
      } catch (error) {
        setBrowserStatus(store, formatAppError(error), false, 'error');
      }
    })();
  }, [data, reloadData, store]);

  const actionHost = useMemo((): BrowserActionHost => ({
    lifecycle,
    setWorkingProgress: setWorking,
    setStatus: (text, transient, kind) => setBrowserStatus(store, text, transient, kind),
    reloadData: async () => {
      const snapshot = await reloadData();
      invalidateUpdateCheck(store);
      return snapshot;
    },
    getNavigation: () => readNavigation(store),
    setNavigation: (value) => writeNavigation(store, value),
    setAbortController: (controller) => store.set(activeAbortAtom, controller),
  }), [lifecycle, reloadData, setWorking, store]);

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
      // Surface action failures in the footer — never leave the promise rejection silent.
      setBrowserStatus(store, formatAppError(error), false, 'error');
    }
  }, [actionHost, exit, setDetail, setPhase, store]);

  if (!data || !navigation) return <Text>{t('ui.loading')}</Text>;

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
          try {
            if (action === 'openSource') {
              const count = await handleOpenCollectedGitHubSource(actionHost, context.skill);
              await reloadData();
              invalidateUpdateCheck(store);
              if (count > 0) {
                setPhase('browse');
                setDetail(null);
              }
              return;
            }
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
          } catch (error) {
            if (error instanceof InterruptError) {
              exit(error);
              return;
            }
            setBrowserStatus(store, formatAppError(error), false, 'error');
          }
        }}
      />
    );
  }

  return (
    <Browser
      {...viewInput}
      finish={(result) => {
        void dispatchResult(result).catch((error) => {
          if (error instanceof InterruptError) {
            exit(error);
            return;
          }
          setBrowserStatus(store, formatAppError(error), false, 'error');
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

  let app!: Awaited<ReturnType<typeof startApp>>;

  const lifecycle: BrowserAppLifecycle = {
    suspendForSubprocess: async (task) => {
      app.dispose();
      try {
        await task();
      } finally {
        app = await startApp(browserRoot(appStore, lifecycle), {
          alternateScreen: true,
        });
      }
    },
  };

  app = await startApp(browserRoot(appStore, lifecycle), {
    alternateScreen: true,
  });
  try {
    await app.waitUntilExit();
  } finally {
    app.dispose();
  }
}
