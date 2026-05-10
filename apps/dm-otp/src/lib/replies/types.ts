/**
 * Common reply-adapter shape. Each channel implements `reply(externalId, message)`
 * and exposes a `_send` seam so tests can capture outbound traffic.
 */

export interface ReplyResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface ReplyAdapter {
  channel: 'telegram' | 'whatsapp' | 'messenger' | 'instagram';
  reply(externalId: string, message: string): Promise<ReplyResult>;
}

/**
 * `_send` is the network seam: it accepts the prepared HTTP request
 * shape the adapter wants to send, and returns whatever the adapter
 * needs to interpret success. Tests substitute a capturing fake.
 */
export type SendSeam = (req: {
  url: string;
  init: RequestInit;
}) => Promise<{
  ok: boolean;
  status: number;
  bodyText: string;
}>;

export const realFetchSeam: SendSeam = async ({ url, init }) => {
  const res = await fetch(url, init);
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  return { ok: res.ok, status: res.status, bodyText };
};
