import assert from 'node:assert/strict';
import { test } from 'vitest';
import { useState } from 'react';
import { Text } from 'ink';
import type { Skill } from '../src/domain/types.js';
import { ImportReview, InstallReview } from '../src/ui/reviews.js';
import {
  Confirm,
  Link,
  MultiSelect,
  Select,
  Tabs,
  TextInput,
  type Tab,
} from '../src/ui/components/termcn.js';
import { padColumns, sliceColumns, textWidth, wrapColumns } from '../src/ui/components/terminal-layout.js';
import { withInk } from './ink.js';

const skill: Skill = {
  name: 'demo-skill',
  description: 'Demo skill',
  path: '/skills/demo-skill',
};

test('Confirm submits its default choice and explicit keyboard choice', async () => {
  const defaultResult: boolean[] = [];
  await withInk(
    <Confirm message="继续吗？" defaultValue={false} onSubmit={(value) => defaultResult.push(value)} />,
    async (screen) => {
      assert.match(screen.frame(), /继续吗？ \(y\/N\)/);
      await screen.press('enter');
    }
  );
  assert.deepEqual(defaultResult, [false]);

  const explicitResult: boolean[] = [];
  await withInk(
    <Confirm message="继续吗？" defaultValue={true} onSubmit={(value) => explicitResult.push(value)} />,
    async (screen) => {
      assert.match(screen.frame(), /继续吗？ \(Y\/n\)/);
      await screen.write('n');
    }
  );
  assert.deepEqual(explicitResult, [false]);
});

test('Select supports cursor navigation and numbered shortcuts', async () => {
  const navigated: string[] = [];
  await withInk(
    <Select
      label="选择一个"
      options={[
        { label: '第一项', value: 'first' },
        { label: '第二项', value: 'second' },
      ]}
      onSubmit={(value) => navigated.push(value)}
    />,
    async (screen) => {
      await screen.press('down');
      assert.match(await screen.waitForFrame(/❯\s+第二项/), /❯\s+第二项/);
      await screen.press('enter');
    }
  );
  assert.deepEqual(navigated, ['second']);

  const numbered: string[] = [];
  await withInk(
    <Select
      numbered
      options={[
        { label: '第一项', value: 'first' },
        { label: '第二项', value: 'second' },
      ]}
      onSubmit={(value) => numbered.push(value)}
    />,
    async (screen) => {
      await screen.write('2');
    }
  );
  assert.deepEqual(numbered, ['second']);
});

test('MultiSelect preserves option order when submitting selected values', async () => {
  const submitted: string[][] = [];
  await withInk(
    <MultiSelect
      label="选择多个"
      options={[
        { label: '第一项', value: 'first' },
        { label: '第二项', value: 'second' },
        { label: '第三项', value: 'third' },
      ]}
      onSubmit={(values) => submitted.push(values)}
    />,
    async (screen) => {
      await screen.press('down');
      assert.match(screen.frame(), /❯\s+○\s+第二项/);
      await screen.write(' ');
      await screen.press('down');
      await screen.write(' ');
      await screen.press('enter');
    }
  );
  assert.deepEqual(submitted, [['second', 'third']]);
});

test('TextInput edits at the cursor and submits the resulting value', async () => {
  const submitted: string[] = [];
  await withInk(
    <TextInput label="备注" initialValue="ab" onSubmit={(value) => submitted.push(value)} />,
    async (screen) => {
      await screen.press('left');
      await screen.write('X');
      assert.match(await screen.waitForFrame(/aXb/), /aXb/);
      await screen.press('backspace');
      await screen.waitForFrame(/ab/);
      await screen.press('enter');
    }
  );
  assert.deepEqual(submitted, ['ab']);
});

test('terminal layout measures and slices Unicode graphemes by terminal columns', () => {
  assert.equal(textWidth('a你e\u0301'), 4);
  assert.deepEqual(wrapColumns('a你b', 3), ['a你', 'b']);
  assert.equal(sliceColumns('a你b', 1, 3), '你');
  assert.equal(padColumns('你', 4), '你  ');
});

test('Link renders a clickable link or its fallback for the current terminal', async () => {
  await withInk(
    <Link url="https://example.com" fallback={(text, url) => `${text} (${url})`}>
      文档
    </Link>,
    async (screen) => {
      const frame = screen.frame();
      assert.equal(
        frame.includes('\u001B]8;;https://example.com\u0007') ||
          frame.includes('文档 (https://example.com)'),
        true
      );
    }
  );
});

function TabsHarness() {
  const [activeTab, setActiveTab] = useState('first');
  const tabs: Tab[] = [
    { key: 'first', label: '第一项', content: <Text>第一项内容</Text> },
    { key: 'second', label: '第二项', content: <Text>第二项内容</Text> },
  ];
  return <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />;
}

test('Tabs updates the active content with arrow navigation', async () => {
  await withInk(<TabsHarness />, async (screen) => {
    assert.match(screen.frame(), /第一项内容/);
    await screen.press('right');
    assert.match(await screen.waitForFrame(/第二项内容/), /第二项内容/);
    await screen.press('left');
    assert.match(await screen.waitForFrame(/第一项内容/), /第一项内容/);
  });
});

test('ImportReview submits selected tags only after its confirmation tab', async () => {
  const submitted: { confirmed: boolean; tags: string[] }[] = [];
  await withInk(
    <ImportReview
      items={[{ skill, detail: '来自本地目录' }]}
      existingTags={['frontend', 'tooling']}
      onSubmit={(result) => submitted.push(result)}
    />,
    async (screen) => {
      await screen.write(' ');
      await screen.waitForFrame(/已选分组：frontend/);
      await screen.press('right');
      assert.match(
        await screen.waitForFrame(/将导入 1 个技能；分组：frontend/),
        /将导入 1 个技能；分组：frontend/
      );
      await screen.press('enter');
    }
  );
  assert.deepEqual(submitted, [{ confirmed: true, tags: ['frontend'] }]);
});

test('InstallReview carries its selected configuration into confirmation', async () => {
  const submitted: {
    confirmed: boolean;
    destination: 'project' | 'global';
    copy: boolean;
    agents: string[];
  }[] = [];
  await withInk(
    <InstallReview
      skills={[skill]}
      targets={[
        {
          value: 'codex',
          projectLabel: 'Codex 项目目录',
          globalLabel: 'Codex 全局目录',
        },
      ]}
      defaultProjectAgents={['codex']}
      defaultGlobalAgents={[]}
      onSubmit={(result) => submitted.push(result)}
    />,
    async (screen) => {
      await screen.press('enter');
      await screen.waitForFrame(/↑\/↓ 选择 · ← 返回 · Enter 下一步/);
      await screen.press('enter');
      await screen.waitForFrame(/至少选择一个目录|Space 选择/);
      await screen.press('enter');
      const confirmation = await screen.waitForFrame(/安装位置：当前项目/);
      assert.match(confirmation, /添加方式：软链/);
      assert.match(confirmation, /目标目录：Codex 项目目录/);
      await screen.press('enter');
    }
  );
  assert.deepEqual(submitted, [
    { confirmed: true, destination: 'project', copy: false, agents: ['codex'] },
  ]);
});
