import { errorMessage } from './core.js';
import { DomainError } from './errors.js';

export interface TagRenameChange<T> {
  before: T;
  after: T;
}

export interface TagRenameResult {
  updated: number;
  committed: boolean;
}

export function normalizeNewTagName(value: string): string {
  const tag = value.trim();
  if (!tag || tag.includes(',')) {
    throw new DomainError('domain.invalidTagName', { name: value });
  }
  return tag;
}

export function renameTagInList(
  tags: string[],
  oldTag: string,
  newTag: string
): string[] | undefined {
  if (!oldTag || oldTag === newTag || !tags.includes(oldTag)) return undefined;
  return [...new Set(tags.map((tag) => tag === oldTag ? newTag : tag))];
}

export async function writeTagRenameBatch<T>(
  changes: TagRenameChange<T>[],
  write: (value: T) => Promise<void>
): Promise<void> {
  const written: T[] = [];
  try {
    for (const change of changes) {
      await write(change.after);
      written.push(change.before);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const before of written.reverse()) {
      try {
        await write(before);
      } catch (rollbackError) {
        rollbackErrors.push(errorMessage(rollbackError));
      }
    }
    if (rollbackErrors.length) {
      throw new DomainError('domain.renameTagFailedRollback', {
        error: errorMessage(error),
        rollback: rollbackErrors.join('; '),
      });
    }
    throw error;
  }
}
