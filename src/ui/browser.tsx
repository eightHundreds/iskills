import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { matches } from '../core.js';
import type { Skill, SkillLink, SkillMetadata } from '../types.js';
import { InkSession } from './session.js';
import { Tabs, TextInput, termcnColors } from './termcn.js';

export type BrowserTab = 'project' | 'collection';
export type BrowserResult =
  | { type: 'quit' }
  | { type: 'sync'; tab: BrowserTab; query: string }
  | { type: 'open'; skill: Skill; collection: boolean; tab: BrowserTab; query: string };

function SkillPane({
  skills,
  cursor,
  preferNote = false,
}: {
  skills: Skill[];
  cursor: number;
  preferNote?: boolean;
}) {
  const { stdout } = useStdout();
  const height = Math.max(3, stdout.rows - 8);
  const active = Math.max(0, Math.min(cursor, skills.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), skills.length - height));
  const visible = skills.slice(offset, offset + height);
  return (
    <Box flexDirection="column" minHeight={3}>
      {skills.length ? (
        visible.map((skill, visibleIndex) => {
          const index = offset + visibleIndex;
          const summary = (preferNote && skill.note) || skill.description;
          return (
          <Box key={skill.path} gap={1} width="100%">
            <Text {...(index === active ? { color: termcnColors.primary } : {})}>
              {index === active ? '›' : ' '}
            </Text>
            <Text wrap="truncate-end">
              <Text bold={index === active}>{skill.name}</Text>
              {summary && (
                <Text color={termcnColors.muted}> — {summary}</Text>
              )}
            </Text>
          </Box>
          );
        })
      ) : (
        <Text color={termcnColors.muted}>没有匹配的技能</Text>
      )}
      {skills.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, skills.length)} / {skills.length}
        </Text>
      )}
    </Box>
  );
}

function Browser({
  project,
  collection,
  initialQuery,
  initialTab,
  canSync,
  status,
  finish,
}: {
  project: Skill[];
  collection: Skill[];
  initialQuery: string;
  initialTab: BrowserTab;
  canSync: boolean;
  status: string;
  finish: (result: BrowserResult) => void;
}) {
  const [tab, setTab] = useState<BrowserTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const [searching, setSearching] = useState(false);
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(initialQuery);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
  const skills = useMemo(
    () => (tab === 'project' ? project : collection).filter((skill) => matches(skill, query)),
    [collection, project, query, tab]
  );

  useEffect(() => setCursor(0), [tab]);
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 'c') || input === 'q') return finish({ type: 'quit' });
      if (input === 'g') return setTab('collection');
      if (input === 'p') return setTab('project');
      if (input === 's' && tab === 'collection' && canSync) {
        return finish({ type: 'sync', tab, query });
      }
      if (input === '/') {
        setQueryBeforeSearch(query);
        setCursorBeforeSearch(cursor);
        return setSearching(true);
      }
      if (key.upArrow) return setCursor((index) => Math.max(0, index - 1));
      if (key.downArrow) {
        return setCursor((index) => Math.min(Math.max(0, skills.length - 1), index + 1));
      }
      const selected = skills[cursor];
      if (key.return && selected) {
        finish({ type: 'open', skill: selected, collection: tab === 'collection', tab, query });
      }
    },
    { isActive: !searching }
  );

  const tabs = [
    {
      key: 'project',
      label: `当前项目 ${project.length}`,
      content: <SkillPane skills={project.filter((skill) => matches(skill, query))} cursor={cursor} />,
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <SkillPane
          skills={collection.filter((skill) => matches(skill, query))}
          cursor={cursor}
          preferNote
        />
      ),
    },
  ];

  return (
    <Box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as BrowserTab)}
        isActive={!searching}
      />
      {searching ? (
        <TextInput
          label="搜索技能（Enter 确认，Esc 取消）"
          initialValue={query}
          onChange={(value) => {
            setQuery(value);
            setCursor(0);
          }}
          onCancel={() => {
            setQuery(queryBeforeSearch);
            setCursor(cursorBeforeSearch);
            setSearching(false);
          }}
          onSubmit={(value) => {
            setQuery(value);
            setSearching(false);
          }}
        />
      ) : (
        <Text color={termcnColors.muted}>
          ←/→ 或 Tab 切换 · ↑/↓ 选择 · Enter 查看 · / 搜索 · q 退出
          {tab === 'collection' && canSync ? ' · s 同步 Git' : ''}
          {status ? ` · ${status}` : ''}
          {query ? ` · 搜索：${query}` : ''}
        </Text>
      )}
    </Box>
  );
}

export type DetailAction = 'note' | 'tags' | 'source' | 'back';

function Detail({
  skill,
  metadata,
  links,
  collection,
  finish,
}: {
  skill: Skill;
  metadata: SkillMetadata;
  links: SkillLink[];
  collection: boolean;
  finish: (action: DetailAction) => void;
}) {
  useInput((input, key) => {
    if (
      key.escape ||
      key.leftArrow ||
      (key.ctrl && input === 'c') ||
      input === 'b' ||
      input === 'q'
    ) {
      return finish('back');
    }
    if (collection && input === 'n') return finish('note');
    if (collection && input === 't') return finish('tags');
    if (collection && input === 's') return finish('source');
  });
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  return (
    <Box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {skill.name}</Text>
      <Text color={termcnColors.muted}>{skill.description || '无描述'}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={termcnColors.border} paddingX={1} marginTop={1}>
        {collection ? (
          <>
            <Text><Text bold>标签  </Text>{metadata.tags.length ? metadata.tags.join(', ') : '无'}</Text>
            <Text><Text bold>备注  </Text>{metadata.note || '无'}</Text>
            <Text><Text bold>来源  </Text>{source}</Text>
            <Text bold>关联位置</Text>
            {links.length ? links.map((link) => (
              <Text key={`${link.kind}:${link.path}`} color={termcnColors.muted}>
                {link.kind === 'origin' ? '  原始' : link.kind === 'usage' ? '  使用' : '  依赖'}  {link.path}
              </Text>
            )) : <Text color={termcnColors.muted}>  无</Text>}
          </>
        ) : (
          <Text><Text bold>位置  </Text>{skill.path}</Text>
        )}
      </Box>
      <Text color={termcnColors.muted}>
        {collection ? 'n 备注 · t 标签 · s 来源 · ←/b/Esc 返回' : '←/b/Esc 返回'}
      </Text>
    </Box>
  );
}

export function browseSkillDetail(
  skill: Skill,
  metadata: SkillMetadata,
  links: SkillLink[],
  collection: boolean,
  session: InkSession
): Promise<DetailAction> {
  return session.show<DetailAction>('back', (finish) => (
      <Detail
        skill={skill}
        metadata={metadata}
        links={links}
        collection={collection}
        finish={finish}
      />
  ), false);
}

export function browseSkills(
  project: Skill[],
  collection: Skill[],
  session: InkSession,
  initialQuery = '',
  initialTab: BrowserTab = 'project',
  canSync = false,
  status = ''
): Promise<BrowserResult> {
  return session.show<BrowserResult>({ type: 'quit' }, (finish) => (
      <Browser
        project={project}
        collection={collection}
        initialQuery={initialQuery}
        initialTab={initialTab}
        canSync={canSync}
        status={status}
        finish={finish}
      />
  ), false);
}
