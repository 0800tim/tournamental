/**
 * Shared shapes for outbound reply adapters.
 *
 * Each channel exposes a `sendOtp(externalId, code, opts?)` that
 * returns a uniform `ReplyResult`. Tests inject a `fetch` shim so we
 * can mock HTTP calls.
 */

export interface ReplyResult {
  ok: boolean;
  /** HTTP status from the platform API (when applicable). */
  status?: number;
  /** Platform message id, when known. */
  messageId?: string;
  /** Diagnostic — never user-facing. */
  detail?: string;
}

export type FetchLike = typeof globalThis.fetch;

export interface AdapterDeps {
  fetch?: FetchLike;
}

/** Standard user-facing copy for the OTP delivery message. */
export function otpMessageBody(code: string): string {
  return `Your VTourn login code is ${code}. It expires in 5 minutes. If you didn't ask for this, ignore this message.`;
}

/** Standard user-facing copy for the email magic-link delivery. */
export function magicLinkEmailBody(linkUrl: string): string {
  return [
    'Tap the link below to finish signing in to VTourn.',
    '',
    linkUrl,
    '',
    'The link expires in 5 minutes and can only be used once.',
    "If you didn't ask to log in, ignore this email.",
  ].join('\n');
}
