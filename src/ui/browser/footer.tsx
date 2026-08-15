import { useStdout } from '../tui/index.js';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, type ReactNode } from 'react';
import { PointerSurface } from '../components/mouse/index.js';
import { TextInput } from '../components/text-input.js';
import { resolveFooter } from '../footer/resolve-footer.js';
import type { FooterResolveInput } from '../footer/types.js';
import { useOverlayFooterItems } from '../overlay/host.js';
import { FooterPaint } from '../shell/footer.js';
import { computeBrowseCapabilities } from './browse-capabilities.js';
import { masterDetailLayout } from './layout.js';
import { t } from '../../i18n/index.js';
import type { FooterItem } from '../footer/types.js';
import { presentHealthAlerts } from './health.js';
import {
  browserDataAtom,
  browserFilterAtom,
  browserGroupJumpAtom,
  browserHealthAtom,
  browserNavigationAtom,
  browserPhaseAtom,
  browserSelectionAtom,
  browserStatusAtom,
  browserTagFilterAtom,
  browserUpdateCheckAtom,
  clearTransientStatus,
  detailContextAtom,
  workingProgressAtom,
  type BrowserAppStore,
} from './store.js';

/**
 * Browser session footer: overlay + browse/filter/working from jotai.
 * Mount as AppShell bottomBar under the browser Provider.
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
  const detail = useAtomValue(detailContextAtom);
  const tagFilter = useAtomValue(browserTagFilterAtom);
  const updateCheck = useAtomValue(browserUpdateCheckAtom);
  const healthAlerts = useAtomValue(browserHealthAtom);
  const setFilter = useSetAtom(browserFilterAtom);
  const setNavigation = useSetAtom(browserNavigationAtom);

  useEffect(() => {
    if (!status.text || !status.transient) return undefined;
    const timer = setTimeout(() => clearTransientStatus(store), 3500);
    return () => clearTimeout(timer);
  }, [status.text, status.transient, status.kind, store]);

  // Avoid painting browse keys before Browser data/main content is ready
  // (footer is outside the list tree and would race empty-frame waits).
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

  // Single shell footer (option A): detail / group-jump own shell keys — never body strip only.
  if (!overlayItems && phase === 'detail' && detail) {
    const items: FooterItem[] = [];
    if (detail.collection) {
      items.push(
        { key: 'n', label: t('common.note') },
        { key: 't', label: t('common.tags') },
        { key: 's', label: t('common.source') },
      );
    }
    items.push({ key: 'Esc', label: t('common.back') });
    return <FooterPaint view={{ mode: 'keys', items }} />;
  }
  if (!overlayItems && groupJump) {
    return (
      <FooterPaint
        view={{
          mode: 'keys',
          items: [
            { key: '↑↓', label: t('common.move') },
            { key: 'Enter', label: t('common.confirm') },
            { key: 'Esc', label: t('common.cancel') },
          ],
        }}
      />
    );
  }

  const masterDetail = masterDetailLayout(stdout.columns, stdout.rows);
  const browse =
    phase === 'browse' && !groupJump && !filter.open && !working
      ? computeBrowseCapabilities(
          navigation,
          selected,
          data,
          updateCheck,
          masterDetail,
          tagFilter
        )
      : null;

  const input: FooterResolveInput = {
    overlayItems,
    suppressed: false,
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
    health: healthAlerts.length > 0 ? { count: healthAlerts.length } : null,
    columns,
  };

  const view = resolveFooter(input);

  if (view.mode === 'input') {
    // Exclusive pointer surface: mute base tabs while filter owns input.
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

  return (
    <FooterPaint
      view={view}
      onStatusAction={(action) => {
        if (action !== 'health') return;
        void presentHealthAlerts(healthAlerts);
      }}
    />
  );
}
