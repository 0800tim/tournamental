/** Types for headers.mjs, which stays plain ESM so next.config.mjs can import it. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}
export interface HeaderRule {
  readonly source: string;
  readonly headers: readonly HeaderEntry[];
  readonly missing?: readonly { type: string; key?: string; value?: string }[];
}
export interface HeaderOpts {
  readonly dev?: boolean;
  readonly extraConnect?: readonly string[];
}
export interface RequestShape {
  readonly path: string;
  readonly host?: string;
  readonly query?: Record<string, string | undefined>;
}
export const ARCHIVE_HOSTS: string[];
export const NO_FRAMING_HEADERS: HeaderEntry[];
export function contentSecurityPolicy(opts?: HeaderOpts): string;
export function baseSecurityHeaders(opts?: HeaderOpts): HeaderEntry[];
export function framingAllowed(req: RequestShape): boolean;
export function securityHeaderRules(opts?: HeaderOpts): HeaderRule[];
export function headersFor(req: RequestShape, opts?: HeaderOpts): HeaderEntry[];
