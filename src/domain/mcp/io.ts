import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import JSON5 from 'json5';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path);
  if (text === undefined || !text.trim()) return {};
  const parsed = JSON5.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export async function writeJsonObject(
  path: string,
  value: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function readTomlObject(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path);
  if (text === undefined || !text.trim()) return {};
  const parsed = parseToml(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export async function writeTomlObject(
  path: string,
  value: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${stringifyToml(value)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, path);
}

export async function removeFileIfExists(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
