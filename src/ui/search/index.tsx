/**
 * Remote search package entry: one-shot search screen via static Layer.
 * Protocol types live in `types.ts`.
 */
import { Text, useModalChrome, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useEffect, useRef, useState } from 'react';
import type { RemoteSkillSearch, SearchViewInput } from './types.js';
import type { RemoteSkill } from '../../domain/types.js';
import { TextInput, termcnColors } from '../components/termcn.js';
import { collectionMatchMarkers } from '../collection-match.js';
import { Layer } from '../overlay/static.js';
// Ensure CLI bootstrap is registered when search runs without a mounted tree.
import '../shell/run.js';
import { t } from '../../i18n/index.js';

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

function SearchSkills({
  initialQuery,
  matchCollection,
  search,
  finish,
}: {
  initialQuery: string;
  matchCollection: SearchViewInput['matchCollection'];
  search: RemoteSkillSearch;
  finish: (skill: RemoteSkill | undefined) => void;
}) {
  const { stdout } = useStdout();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RemoteSkill[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(initialQuery.trim().length >= 2);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const requestId = useRef(0);
  const height = Math.max(3, Math.min(8, (stdout.rows || 24) - 8));
  const offset = Math.max(0, Math.min(cursor - Math.floor(height / 2), results.length - height));
  const visible = results.slice(offset, offset + height);

  useEffect(() => {
    const value = query.trim();
    const currentRequest = ++requestId.current;
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      setError('');
      void search(value, controller.signal)
        .then((skills) => {
          if (requestId.current !== currentRequest) return;
          setResults(skills);
          setCursor(0);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || requestId.current !== currentRequest) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted && requestId.current === currentRequest) setLoading(false);
        });
    }, Math.max(150, 350 - value.length * 50));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, retry, search]);

  useInput((_input, key) => {
    if (key.upArrow) return setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) {
      return setCursor((value) => Math.min(Math.max(0, results.length - 1), value + 1));
    }
  });

  const select = () => {
    if (error) {
      setError('');
      setLoading(true);
      setRetry((value) => value + 1);
      return;
    }
    if (loading) return;
    const selected = results[cursor];
    if (selected) finish(selected);
  };

  const chrome = useModalChrome();
  return (
    <box flexDirection="column">
      <TextInput
        label={t('search.title')}
        initialValue={initialQuery}
        onChange={(value) => {
          requestId.current++;
          setQuery(value);
          setResults([]);
          setCursor(0);
          setError('');
          setLoading(value.trim().length >= 2);
        }}
        onCancel={() => finish(undefined)}
        onSubmit={select}
      />
      <box flexDirection="column" marginTop={1}>
        {query.trim().length < 2 ? (
          <Text color={chrome.muted}>{t('search.minChars')}</Text>
        ) : error ? (
          <Text color={termcnColors.error}>{error}</Text>
        ) : !results.length && loading ? (
          <Text color={chrome.muted}>{t('search.searching')}</Text>
        ) : !results.length ? (
          <Text color={chrome.muted}>{t('search.noResults')}</Text>
        ) : (
          visible.map((skill, index) => {
            const active = offset + index === cursor;
            const match = matchCollection(skill);
            const marker = match && collectionMatchMarkers[match];
            return (
              <Text
                key={skill.resultId}
                color={active ? termcnColors.primary : chrome.body}
                bold={active}
              >
                {`${active ? '›' : ' '} ${skill.name}`}
                {marker && <Text color={marker.color}> {marker.symbol}</Text>}
                {` — ${skill.source} · ${formatInstalls(skill.installs)} installs`}
              </Text>
            );
          })
        )}
      </box>
      <Text color={chrome.muted}>
        {error
          ? t('search.retryFooter')
          : loading || !results.length
            ? t('search.cancelFooter')
            : t('search.listFooter')}
      </Text>
    </box>
  );
}

export function searchRemoteSkill(
  input: SearchViewInput
): Promise<RemoteSkill | undefined> {
  return Layer.open<RemoteSkill | undefined>({
    content: (finish) => (
      <SearchSkills
        {...input}
        finish={finish}
      />
    ),
  });
}
