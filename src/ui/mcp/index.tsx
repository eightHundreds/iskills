import { useCallback, useState, type ReactNode } from 'react';
import {
  addCollectedMcp,
  listCollectedMcps,
  listMcpLocations,
  mcpSecretState,
  probeHttp,
  readMcpSecrets,
  removeCollectedMcp,
  removeMcpLocation,
  renameCollectedMcp,
  scanContext,
  storeCollectedLoginSecret,
  storeCollectedOverlaySecret,
  toggleMcpLocation,
  updateCollectedMeta,
  updateLocationsFromCollection,
  writableMcpTargets,
  type CollectedMcp,
  type McpLocationEntry,
  type McpSecretState,
  type McpScope,
} from '../../domain/mcp/index.js';
import { formatAppError, t } from '../../i18n/index.js';
import { Modal } from '../overlay/static.js';
import { presentMcpJsonImport } from './json-import.js';
import { promptText } from '../prompts/present.js';
import { AppShell } from '../shell/app-shell.js';
import { startApp } from '../shell/run.js';
import { InterruptError } from '../shell/terminal.js';
import { useApp } from '../tui/index.js';
import type { McpFooterSnapshot } from './browse-capabilities.js';
import { McpBrowser } from './browser.js';
import { McpShellFooter } from './footer.js';

export interface McpBrowserData {
  collection: CollectedMcp[];
  project: McpLocationEntry[];
  global: McpLocationEntry[];
  secrets: Record<string, McpSecretState>;
  accessToken: Record<string, boolean>;
}

async function loadMcpData(): Promise<McpBrowserData> {
  const ctx = scanContext();
  const [collection, project, global] = await Promise.all([
    listCollectedMcps(),
    listMcpLocations('project', ctx),
    listMcpLocations('global', ctx),
  ]);
  const overlay = await Promise.all(
    collection.map(async (item) => {
      const values = await readMcpSecrets(item.name);
      return [item.name, values] as const;
    })
  );
  const secrets: Record<string, McpSecretState> = {};
  const accessToken: Record<string, boolean> = {};
  for (const [name, values] of overlay) {
    const item = collection.find((entry) => entry.name === name);
    if (!item) continue;
    secrets[name] = mcpSecretState(item.recipe, values);
    accessToken[name] = Boolean(values.headers.Authorization?.trim());
  }
  return { collection, project, global, secrets, accessToken };
}

export async function runMcpBrowserApp(): Promise<void> {
  const data = await loadMcpData();
  const app = await startApp(<McpApp initial={data} />, { alternateScreen: true });
  await app.waitUntilExit();
}

function McpApp({ initial }: { initial: McpBrowserData }): ReactNode {
  const { exit } = useApp();
  const handleCtrlC = useCallback(() => {
    exit(new InterruptError());
  }, [exit]);
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'normal' | 'error'; text: string } | null>(
    null
  );

  const [snapshot, setSnapshot] = useState<McpFooterSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState('');
  const [queryBefore, setQueryBefore] = useState('');

  const reload = useCallback(async () => {
    setData(await loadMcpData());
  }, []);
  const onCapabilities = useCallback((next: McpFooterSnapshot) => {
    setSnapshot((current) =>
      current && JSON.stringify(current) === JSON.stringify(next) ? current : next
    );
  }, []);
  const flash = useCallback((text: string, kind: 'normal' | 'error' = 'normal') => {
    setStatus({ kind, text });
    setTimeout(() => setStatus(null), 3500);
  }, []);

  return (
    <AppShell
      cancelOnEscape={false}
      onCtrlC={handleCtrlC}
      bottomBar={
        <McpShellFooter
          snapshot={snapshot}
          filterOpen={filterOpen}
          filterDraft={filterDraft}
          status={status}
          onFilterChange={(draft) => {
            setFilterDraft(draft);
            setQuery(draft);
          }}
          onFilterCancel={() => {
            setFilterOpen(false);
            setFilterDraft('');
            setQuery(queryBefore);
          }}
          onFilterSubmit={(value) => {
            setFilterOpen(false);
            setQuery(value);
            setFilterDraft(value);
          }}
        />
      }
    >
      <McpBrowser
        data={data}
        query={query}
        filterOpen={filterOpen}
        onOpenFilter={() => {
          setQueryBefore(query);
          setFilterDraft(query);
          setFilterOpen(true);
        }}
        onCapabilities={onCapabilities}
        onImportJson={async () => {
          try {
            const result = await presentMcpJsonImport();
            if (!result) return;
            await reload();
            for (const notice of result.notices) flash(notice);
            flash(t('mcp.importedCount', { count: result.imported }));
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onImport={async (entries) => {
          try {
            const { importLocationToCollection } = await import('../../domain/mcp/index.js');
            let count = 0;
            for (const entry of entries) {
              const result = await importLocationToCollection(entry, {
                confirmReplace: async ({ name }) =>
                  Modal.confirm({
                    title: t('common.confirm'),
                    message: t('mcp.replaceConfirm', { name }),
                    defaultValue: false,
                  }),
              });
              if (result.result === 'imported') count += 1;
              if (result.result === 'collected-as') {
                flash(t('mcp.alreadyCollectedAs', { name: result.name }));
              }
            }
            await reload();
            flash(t('mcp.importedCount', { count }));
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onAdd={async (names, scope: McpScope, agents: string[]) => {
          try {
            const ctx = scanContext();
            const writable = await writableMcpTargets(agents, scope, ctx);
            let added = 0;
            for (const name of names) {
              added += (await addCollectedMcp(name, writable, ctx)).added;
            }
            await reload();
            flash(t('mcp.addedCount', { count: added }));
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onDelete={async (target) => {
          try {
            if (target.collection?.length) {
              for (const item of target.collection) {
                const ok = await Modal.confirm({
                  title: t('common.confirm'),
                  message: t('mcp.deleteCollectionConfirm', { name: item.name }),
                  defaultValue: false,
                });
                if (!ok) return;
                await removeCollectedMcp(item.name);
              }
            }
            if (target.locations?.length) {
              const ctx = scanContext();
              for (const entry of target.locations) {
                const ok = await Modal.confirm({
                  title: t('common.confirm'),
                  message: t('mcp.deleteLocationConfirm', {
                    name: entry.nativeKey,
                    agent: entry.agent,
                  }),
                  defaultValue: false,
                });
                if (!ok) return;
                await removeMcpLocation(entry, ctx);
              }
            }
            await reload();
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onToggle={async (entry) => {
          try {
            await toggleMcpLocation(entry, scanContext());
            await reload();
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onUpdate={async (items) => {
          try {
            for (const item of items) {
              await updateLocationsFromCollection(item.name, {
                confirmDrift: async ({ entry }) =>
                  Modal.confirm({
                    title: t('common.confirm'),
                    message: t('mcp.updateDriftConfirm', {
                      name: item.name,
                      agent: entry.agent,
                    }),
                    defaultValue: false,
                  }),
              });
            }
            await reload();
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onRename={async (item) => {
          const next = await promptText(t('mcp.namePrompt'), item.name);
          if (!next?.trim()) return;
          try {
            await renameCollectedMcp(item.name, next.trim());
            await reload();
            flash(t('mcp.renamed', { name: next.trim() }));
          } catch (error) {
            flash(formatAppError(error), 'error');
          }
        }}
        onTags={async (item) => {
          const { promptTags } = await import('../prompts/present.js');
          const known = [...new Set(data.collection.flatMap((entry) => entry.tags))];
          const tags = await promptTags(known, item.tags, t('common.tags'));
          if (!tags) return;
          await updateCollectedMeta(item.name, { tags });
          await reload();
        }}
        onNote={async (item) => {
          const note = await promptText(t('common.note'), item.note);
          if (note === undefined) return;
          await updateCollectedMeta(item.name, { note });
          await reload();
        }}
        onLogin={async (item) => {
          const token = await promptText(t('mcp.accessTokenPrompt'));
          if (!token?.trim()) return;
          const value = /^bearer\s+/i.test(token.trim())
            ? token.trim()
            : `Bearer ${token.trim()}`;
          await storeCollectedLoginSecret(item.name, 'Authorization', value);
          await reload();
          flash(t('mcp.loginSaved'));
        }}
        onFillSecrets={async (item) => {
          const headerDefault =
            item.recipe.headerKeys[0] ?? item.recipe.envKeys[0] ?? 'Authorization';
          const key = (await promptText(t('mcp.headerPrompt'), headerDefault))?.trim();
          if (!key) return;
          const token = await promptText(t('mcp.tokenPrompt'));
          if (!token?.trim()) return;
          const slot = item.recipe.envKeys.includes(key) && !item.recipe.headerKeys.includes(key)
            ? 'env'
            : 'headers';
          await storeCollectedOverlaySecret(item.name, slot, key, token.trim());
          await reload();
          flash(t('mcp.secretsSaved'));
        }}
        onProbe={async (item) => {
          if (item.recipe.transport !== 'http' && item.recipe.transport !== 'sse') {
            return 'failed';
          }
          return probeHttp(item.recipe, await readMcpSecrets(item.name));
        }}
      />
    </AppShell>
  );
}

export { McpBrowser } from './browser.js';
