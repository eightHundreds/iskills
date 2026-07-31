import { parseArgs } from 'node:util';
import { createCollectionSkill } from '../domain/collection-write.js';
import { DomainError } from '../domain/errors.js';
import { formatAppError } from '../i18n/index.js';
import { t } from '../i18n/index.js';
import { openPath } from '../util/open-path.js';

export async function commandCreate(argv: string[]): Promise<void> {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {},
  });
  if (positionals.length > 1) throw new DomainError('cmd.oneSkillNameOnly');

  let name = positionals[0]?.trim();
  if (!name) {
    if (!process.stdin.isTTY) throw new DomainError('cmd.specifySkillNames');
    const { promptText } = await import('../ui/prompts/present.js');
    const entered = await promptText(t('cmd.skillNamePrompt'));
    if (entered === undefined) return;
    name = entered.trim();
    if (!name) throw new DomainError('cmd.specifySkillNames');
  }

  const path = await createCollectionSkill(name);
  console.log(t('cmd.createdSkill', { name }));
  console.log(path);
  try {
    await openPath(path);
  } catch (error) {
    console.error(t('cmd.warnOpenPathFailed', { error: formatAppError(error) }));
  }
}
