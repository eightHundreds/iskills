import { useCallback, useState, type ReactNode } from 'react';
import {
  addCollectedMcp,
  agentMcpWritable,
  isMcpAgentId,
  listCollectedMcps,
  listMcpLocations,
  probeHttp,
  readMcpSecrets,
  removeCollectedMcp,
  removeMcpLocation,
  renameCollectedMcp,
  scanContext,
  storeCollectedLoginSecret,
  toggleMcpLocation,
  updateCollectedMeta,
  updateLocationsFromCollection,
  type CollectedMcp,
  type HttpProbeStatus,
  type McpLocationEntry,
  type McpScope,
} from '../../domain/mcp/index.js';
import { formatAppError, t } from '../../i18n/index.js';
import { Modal } from '../overlay/static.js';
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
}

async function loadMcpData(): Promise<McpBrowserData> {
  const ctx = scanContext();
  const [collection, project, global] = await Promise.all([
    listCollectedMcps(),
    listMcpLocations('project', ctx),
    listMcpLocations('global', ctx),
  ]);
  return { collection, project, global };
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
  const [probe, setProbe] = useState<HttpProbeStatus | undefined>(undefined);
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
        {...(probe ? { probe } : {})}
        query={query}
        filterOpen={filterOpen}
        onOpenFilter={() => {
          setQueryBefore(query);
          setFilterDraft(query);
          setFilterOpen(true);
        }}
        onCapabilities={onCapabilities}
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
            const writable: { agent: string; scope: McpScope }[] = [];
            for (const agent of agents) {
              if (isMcpAgentId(agent) && (await agentMcpWritable(agent, scope, ctx))) {
                writable.push({ agent, scope });
              }
            }
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
          const header = (await promptText(t('mcp.headerPrompt'), 'Authorization'))?.trim();
          if (!header) return;
          const token = await promptText(t('mcp.tokenPrompt'));
          if (!token?.trim()) return;
          await storeCollectedLoginSecret(item.name, header, token.trim());
          flash(t('mcp.loginSaved'));
        }}
        onProbe={async (item) => {
          if (item.recipe.transport !== 'http') return;
          setProbe(await probeHttp(item.recipe, await readMcpSecrets(item.name)));
        }}
      />
    </AppShell>
  );
}

export { McpBrowser } from './browser.js';
