import { Text } from '../tui/index.js';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  addCollectedMcp,
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
import { McpBrowser } from './browser.js';

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
  const app = await startApp(
    <AppShell cancelOnEscape={false}>
      <McpApp initial={data} />
    </AppShell>,
    { alternateScreen: true }
  );
  await app.waitUntilExit();
}

function McpApp({ initial }: { initial: McpBrowserData }): ReactNode {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState('');
  const [probe, setProbe] = useState<HttpProbeStatus | undefined>(undefined);

  const reload = useCallback(async () => {
    setData(await loadMcpData());
  }, []);

  const onImport = useCallback(
    async (entries: McpLocationEntry[]) => {
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
          setStatus(t('mcp.alreadyCollectedAs', { name: result.name }));
        }
      }
      await reload();
      setStatus(t('mcp.importedCount', { count }));
    },
    [reload]
  );

  const onAdd = useCallback(
    async (names: string[], scope: McpScope, agents: string[]) => {
      let added = 0;
      for (const name of names) {
        const result = await addCollectedMcp(
          name,
          agents.map((agent) => ({ agent, scope }))
        );
        added += result.added;
      }
      await reload();
      setStatus(t('mcp.addedCount', { count: added }));
    },
    [reload]
  );

  const onDelete = useCallback(
    async (target: { collection?: CollectedMcp[]; locations?: McpLocationEntry[] }) => {
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
            message: t('mcp.deleteLocationConfirm', { name: entry.nativeKey, agent: entry.agent }),
            defaultValue: false,
          });
          if (!ok) return;
          await removeMcpLocation(entry, ctx);
        }
      }
      await reload();
    },
    [reload]
  );

  const onToggle = useCallback(
    async (entry: McpLocationEntry) => {
      await toggleMcpLocation(entry, scanContext());
      await reload();
    },
    [reload]
  );

  const onUpdate = useCallback(
    async (items: CollectedMcp[]) => {
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
    },
    [reload]
  );

  const onRename = useCallback(
    async (item: CollectedMcp) => {
      const next = await promptText(t('mcp.namePrompt'));
      if (!next?.trim()) return;
      await renameCollectedMcp(item.name, next.trim());
      await reload();
      setStatus(t('mcp.renamed', { name: next.trim() }));
    },
    [reload]
  );

  const onTags = useCallback(
    async (item: CollectedMcp) => {
      const { promptTags } = await import('../prompts/present.js');
      const known = [...new Set(data.collection.flatMap((entry) => entry.tags))];
      const tags = await promptTags(known, item.tags, t('common.tags'));
      if (!tags) return;
      await updateCollectedMeta(item.name, { tags });
      await reload();
    },
    [reload]
  );

  const onNote = useCallback(
    async (item: CollectedMcp) => {
      const note = await promptText(t('common.note'));
      if (note === undefined) return;
      await updateCollectedMeta(item.name, { note });
      await reload();
    },
    [reload]
  );

  const onLogin = useCallback(
    async (item: CollectedMcp) => {
      const header = (await promptText(t('mcp.headerPrompt')))?.trim() || 'Authorization';
      const token = await promptText(t('mcp.tokenPrompt'));
      if (!token?.trim()) return;
      await storeCollectedLoginSecret(item.name, header, token.trim());
      setStatus(t('mcp.loginSaved'));
    },
    []
  );

  const onProbe = useCallback(async (item: CollectedMcp) => {
    if (item.recipe.transport !== 'http') {
      setProbe(undefined);
      return;
    }
    const secrets = await readMcpSecrets(item.name);
    setProbe(await probeHttp(item.recipe, secrets));
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 2400);
    return () => clearTimeout(timer);
  }, [status]);

  if (!data) return <Text>{t('ui.loading')}</Text>;

  return (
    <McpBrowser
      data={data}
      status={status}
      {...(probe ? { probe } : {})}
      onImport={onImport}
      onAdd={onAdd}
      onDelete={onDelete}
      onToggle={onToggle}
      onUpdate={onUpdate}
      onRename={onRename}
      onTags={onTags}
      onNote={onNote}
      onLogin={onLogin}
      onProbe={onProbe}
    />
  );
}

export { McpBrowser } from './browser.js';
