/**
 * Stable failure codes for domain **and** command-layer failures.
 * Presentation maps codes via i18n at the CLI/UI boundary (`formatAppError`).
 *
 * Rules:
 * - Throw `DomainError(code, params)` — never `new Error(t(...))` (pre-localized
 *   messages lose the code and break tests / quiet paths).
 * - Domain modules must not import i18n or write user-facing console output.
 * - Commands may import i18n for success/status strings only, not for throw messages.
 */

export type DomainParams = Record<string, string | number>;

export class DomainError extends Error {
  readonly code: string;
  readonly params: DomainParams;

  constructor(code: string, params: DomainParams = {}) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.params = params;
  }
}

export type DomainNotify = (code: string, params?: DomainParams) => void;

let domainNotifyImpl: DomainNotify = () => {
  /* no-op until CLI/UI registers a presenter */
};

/** Register presentation for non-fatal domain notices (cleanup warnings, sync info). */
export function setDomainNotify(fn: DomainNotify): void {
  domainNotifyImpl = fn;
}

export function domainNotify(code: string, params: DomainParams = {}): void {
  domainNotifyImpl(code, params);
}
