import { parseArgs } from 'node:util';
import { createCollectionSkill } from '../domain/collection-write.js';
import { errorMessage } from '../domain/core.js';
import { openPath } from '../util/open-path.js';

export async function commandCreate(argv: string[]): Promise<void> {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {},
  });
  if (positionals.length > 1) throw new Error('一次只能指定一个技能名称');

  let name = positionals[0]?.trim();
  if (!name) {
    if (!process.stdin.isTTY) throw new Error('请指定技能名称');
    const { promptText } = await import('../ui/prompts/present.js');
    const entered = await promptText('技能名称：');
    if (entered === undefined) return;
    name = entered.trim();
    if (!name) throw new Error('请指定技能名称');
  }

  const path = await createCollectionSkill(name);
  console.log(`已创建技能：${name}`);
  console.log(path);
  try {
    await openPath(path);
  } catch (error) {
    console.error(`警告：无法打开目录：${errorMessage(error)}`);
  }
}
