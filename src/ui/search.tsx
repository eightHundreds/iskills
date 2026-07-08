import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useState } from 'react';
import type { RemoteSkill } from '../types.js';
import { InkSession } from './session.js';
import { TextInput, termcnColors } from './termcn.js';

type Search = (query: string, signal: AbortSignal) => Promise<RemoteSkill[]>;

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

function SearchSkills({
  initialQuery,
  collectedNames,
  search,
  finish,
}: {
  initialQuery: string;
  collectedNames: Set<string>;
  search: Search;
  finish: (skill: RemoteSkill | undefined) => void;
}) {
  const { stdout } = useStdout();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RemoteSkill[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const height = Math.max(3, Math.min(8, stdout.rows - 8));
  const offset = Math.max(0, Math.min(cursor - Math.floor(height / 2), results.length - height));
  const visible = results.slice(offset, offset + height);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      setError('');
      void search(value, controller.signal)
        .then((skills) => {
          setResults(skills);
          setCursor(0);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, Math.max(150, 350 - value.length * 50));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, search]);

  useInput((_input, key) => {
    if (key.upArrow) return setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) {
      return setCursor((value) => Math.min(Math.max(0, results.length - 1), value + 1));
    }
  });

  const select = () => {
    const selected = results[cursor];
    if (selected) finish(selected);
  };

  return (
    <Box flexDirection="column">
      <TextInput
        label="搜索技能"
        initialValue={initialQuery}
        onChange={(value) => {
          setQuery(value);
          setCursor(0);
        }}
        onCancel={() => finish(undefined)}
        onSubmit={select}
      />
      <Box flexDirection="column" marginTop={1}>
        {query.trim().length < 2 ? (
          <Text color={termcnColors.muted}>输入至少 2 个字符开始搜索</Text>
        ) : error ? (
          <Text color={termcnColors.error}>{error}</Text>
        ) : !results.length && loading ? (
          <Text color={termcnColors.muted}>正在搜索…</Text>
        ) : !results.length ? (
          <Text color={termcnColors.muted}>没有找到技能</Text>
        ) : (
          visible.map((skill, index) => {
            const active = offset + index === cursor;
            const collected = collectedNames.has(skill.name.toLowerCase());
            return (
              <Text
                key={`${skill.source}@${skill.name}`}
                {...(active ? { color: termcnColors.primary } : {})}
                bold={active}
              >
                {`${active ? '›' : ' '} ${skill.name} — ${skill.source} · ${formatInstalls(skill.installs)} installs${collected ? ' · 已收藏同名技能' : ''}`}
              </Text>
            );
          })
        )}
      </Box>
      <Text color={termcnColors.muted}>
        ↑/↓ 选择 · Enter 收藏 · Esc 取消{loading && results.length ? ' · 正在更新…' : ''}
      </Text>
    </Box>
  );
}

export function searchRemoteSkill(
  initialQuery: string,
  collectedNames: Set<string>,
  search: Search,
  session: InkSession
): Promise<RemoteSkill | undefined> {
  return session.show<RemoteSkill | undefined>(undefined, (finish) => (
    <SearchSkills
      initialQuery={initialQuery}
      collectedNames={collectedNames}
      search={search}
      finish={finish}
    />
  ));
}
