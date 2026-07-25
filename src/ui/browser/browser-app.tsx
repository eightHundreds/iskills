import { render, Text, useApp, type Instance } from 'ink';
import { Provider, useAtom, useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrowserResult, BrowserViewInput } from '../../contracts/browser.js';
import type { BrowserAppLifecycle, BrowserConfirmRequest, DetailViewContext } from '../../contracts/browser-app.js';
import type { BrowserActionHost, DetailEditorContext } from '../../contracts/browser-app-actions.js';
import {
  handleBrowserResult,
  handleDetailAction,
  loadBrowserData,
  loadDetailContext,
} from '../../commands/browser-actions.js';
import { checkGitSkillUpdates } from '../../domain/git.js';
import { InterruptError } from '../../contracts/terminal.js';
import { AppShell } from './app-shell.js';
import {
  activeAbortAtom,
  browserDataAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserSelectionAtom,
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
import { Browser, Detail, type DetailAction } from './browser.js';
import { InAppPromptHost, useInAppPromptActions } from './in-app-prompt.js';

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
  const selection = useAtomValue(browserSelectionAtom);
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
  }, [store]);

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

  const viewState = {
    ...navigation,
    selected: [...selection],
  };

  const viewInput: BrowserViewInput = {
    projectGroups: data.projectGroups,
    collection: data.collection,
    globalGroups: data.globalGroups,
    state: viewState,
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
        state={viewState}
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

const CLEAR_SCREEN = '\u001B[2J\u001B[H';
const ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\u001B[?1049l';

export async function runBrowserApp(
  initialQuery = '',
  initialTab: import('../../contracts/browser.js').BrowserTab = 'project',
  store?: BrowserAppStore
): Promise<void> {
  const { createBrowserAppStore } = await import('./browser-app-store.js');
  const appStore = store ?? createBrowserAppStore(initialQuery, initialTab);
  const initialData = await loadBrowserData();
  appStore.set(browserDataAtom, initialData);
  process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);

  let instance: Instance | undefined;

  const lifecycle: BrowserAppLifecycle = {
    suspendForSubprocess: async (task) => {
      instance?.unmount();
      instance?.cleanup();
      process.stdout.write(LEAVE_ALTERNATE_SCREEN);
      try {
        await task();
      } finally {
        process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);
        instance = render(
          <Provider store={appStore}>
            <BrowserApp lifecycle={lifecycle} />
          </Provider>,
          { exitOnCtrlC: false }
        );
      }
    },
  };

  instance = render(
    <Provider store={appStore}>
      <BrowserApp lifecycle={lifecycle} />
    </Provider>,
    { exitOnCtrlC: false }
  );

  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    instance.cleanup();
    process.stdout.write(LEAVE_ALTERNATE_SCREEN);
  }
}
