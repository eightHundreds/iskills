/**
 * Thin locale-aware message catalog (zh / en only).
 *
 * Resolution order (first wins):
 * 1. Test pin via setLocale
 * 2. User config preference (zh | en | system) after applyUserConfigLocale
 * 3. System locale from env / Intl
 */

import { DomainError, setDomainNotify } from '../domain/errors.js';
import { recordRunLog } from '../domain/run-log.js';
import type { LocalePreference } from '../domain/user-config.js';
import { en } from './en.js';
import { zh } from './zh.js';

export type Locale = 'zh' | 'en';
export type MessageKey = keyof typeof zh;
export type MessageVars = Record<string, string | number>;

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  zh: zh as Record<MessageKey, string>,
  en: en as Record<MessageKey, string>,
};

let pinned: Locale | undefined;
let resolved: Locale | undefined;
let preference: LocalePreference = 'system';

/** Map a locale tag (e.g. zh_CN, en-US) to app locale. */
export function mapLocaleTag(tag: string | undefined | null): Locale {
  if (!tag) return 'en';
  const normalized = tag.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized || normalized === 'c' || normalized === 'posix') return 'en';
  // Strip encoding / modifiers: zh_CN.UTF-8@euro → zh-cn
  const base = normalized.split('.')[0]?.split('@')[0] ?? '';
  if (base === 'zh' || base.startsWith('zh-')) return 'zh';
  return 'en';
}

/**
 * Resolve app locale from env (LC_ALL → LC_MESSAGES → LANG).
 * Pure: does not mutate process state.
 */
export function resolveLocaleFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Locale {
  const candidates = [env.LC_ALL, env.LC_MESSAGES, env.LANG];
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return mapLocaleTag(value);
  }
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().locale;
    return mapLocaleTag(intl);
  } catch {
    return 'en';
  }
}

/** Effective locale for a stored preference (system → env/Intl). */
export function resolveLocaleFromPreference(
  pref: LocalePreference,
  env: NodeJS.ProcessEnv = process.env
): Locale {
  if (pref === 'zh' || pref === 'en') return pref;
  return resolveLocaleFromEnv(env);
}

function detectLocale(): Locale {
  if (pinned) return pinned;
  if (resolved) return resolved;
  resolved = resolveLocaleFromPreference(preference);
  return resolved;
}

/** Current process locale (pinned or preference-resolved). */
export function getLocale(): Locale {
  return detectLocale();
}

/** Last applied user preference (system | zh | en). */
export function getLocalePreference(): LocalePreference {
  return preference;
}

/**
 * Apply user config locale preference for this process.
 * Does not override a test pin from setLocale.
 */
export function applyLocalePreference(pref: LocalePreference): void {
  preference = pref;
  if (pinned) return;
  resolved = resolveLocaleFromPreference(pref);
}

/**
 * Load `~/.config/iskills/config.json` (JSON5) and apply locale preference.
 * Safe when file missing. Does not override test pins.
 */
export async function applyUserConfigLocale(): Promise<void> {
  const { readUserConfig } = await import('../domain/user-config.js');
  const config = await readUserConfig();
  applyLocalePreference(config.locale);
}

/**
 * Pin locale for the rest of the process (tests).
 * Not a user-facing override.
 */
export function setLocale(locale: Locale): void {
  pinned = locale;
  resolved = locale;
}

/** Clear pin and cached resolution (tests). Preference stays until re-applied. */
export function resetLocale(): void {
  pinned = undefined;
  resolved = undefined;
  preference = 'system';
}

function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

/** Translate a catalog key with optional named placeholders `{name}`. */
export function t(key: MessageKey, vars?: MessageVars): string {
  const locale = detectLocale();
  const catalog = catalogs[locale];
  const template = catalog[key] ?? catalogs.en[key] ?? catalogs.zh[key] ?? key;
  return interpolate(template, vars);
}

/**
 * User-facing error text. Domain failures carry stable `DomainError.code` keys;
 * format them here so domain never imports the catalog.
 */
export function formatAppError(error: unknown): string {
  if (error instanceof DomainError) {
    const key = error.code as MessageKey;
    if (key in zh || key in en) {
      // Nested operation labels (e.g. domain.opDelete) may appear as params.
      const params: MessageVars = { ...error.params };
      if (error.cause !== undefined) params.error = formatAppError(error.cause);
      for (const [name, value] of Object.entries(params)) {
        if (typeof value === 'string' && (value in zh || value in en)) {
          params[name] = t(value as MessageKey);
        }
      }
      return t(key, params);
    }
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Localized error plus the run-log path when persist succeeds.
 * Interrupt errors are not dumped.
 */
export async function formatErrorWithLog(error: unknown): Promise<string> {
  const message = formatAppError(error);
  const { persistFailureLog } = await import('../util/run-log-session.js');
  const path = await persistFailureLog(error);
  if (!path) return message;
  return `${message}\n${t('cli.logWritten', { path })}`;
}

/** Wire domain non-fatal notices to stderr/stdout via the active catalog. */
export function installDomainNotify(): void {
  setDomainNotify((code, params) => {
    recordRunLog('warn', 'notify', code, params);
    const text = formatAppError(new DomainError(code, params ?? {}));
    if (
      code.startsWith('domain.warn') ||
      code === 'domain.gitCommitFailed' ||
      code.startsWith('git.')
    ) {
      console.error(text);
      return;
    }
    console.log(text);
  });
}

/** All keys present in both catalogs (runtime sanity for tests). */
export function messageKeys(): MessageKey[] {
  return Object.keys(zh) as MessageKey[];
}
