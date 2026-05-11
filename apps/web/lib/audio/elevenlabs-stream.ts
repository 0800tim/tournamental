/**
 * ElevenLabs realtime stream client, pure module (browser side).
 *
 * Contract:
 *   - `getSignedWss()` calls `/api/commentary/sign` to mint a
 *     short-lived signed WSS URL. The server keeps the API key.
 *   - `connect()` opens the WSS and registers handlers for `audio`
 *     (PCM/MP3 chunks) and `final`/`error`.
 *   - `sendText(text)` ships a chunk for synthesis.
 *
 * The ElevenLabs API key is NOT available in this environment, the
 * agent prompt explicitly says "ship the wiring with a stub
 * commentary track (silent buffer) so the ducking logic can be
 * tested end-to-end". The wiring lives here; the actual key check
 * gates the connection at the server (see
 * `app/api/commentary/sign/route.ts`).
 *
 * Browser-safe: uses `typeof WebSocket` to gate against jsdom which
 * lacks a real WS implementation.
 */

export interface SignedUrlResponse {
  /** WSS URL with auth-token in query, valid for ~ 60 s. */
  url: string;
  /** Voice id used for the session. */
  voiceId: string;
  /** Expiry epoch-ms. */
  expiresAt: number;
  /** True when the server returned a real key-signed URL. False when
   *  the server is in stub mode (no `ELEVENLABS_API_KEY` env). */
  signed: boolean;
}

export interface StreamOpts {
  /** Override the sign endpoint (tests). */
  signUrl?: string;
  /** WebSocket implementation override (tests). */
  WebSocketImpl?: typeof WebSocket;
}

export type StreamHandler =
  | { kind: "audio"; data: ArrayBuffer }
  | { kind: "final" }
  | { kind: "error"; message: string }
  | { kind: "stub" };

/**
 * Fetch a signed WSS URL. Returns `signed: false` when the server
 * is operating in stub mode (no API key).
 */
export async function getSignedWss(
  opts: StreamOpts = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SignedUrlResponse> {
  const url = opts.signUrl ?? "/api/commentary/sign";
  const res = await fetchImpl(url, { method: "POST" });
  if (!res.ok) throw new Error(`commentary/sign failed: ${res.status}`);
  return (await res.json()) as SignedUrlResponse;
}

/**
 * Open a WSS connection to ElevenLabs realtime. If `signed` is
 * `false` we shortcut to a "stub" handler, the caller still gets a
 * predictable lifecycle (one `stub` event then `final`) so it can
 * exercise its mixer / ducking code.
 */
export async function openCommentaryStream(
  signed: SignedUrlResponse,
  onMessage: (msg: StreamHandler) => void,
  opts: StreamOpts = {},
): Promise<{ close(): void; sendText(text: string): void }> {
  if (!signed.signed) {
    // Stub mode, fire one event so the consumer can exercise its
    // pipeline (and the ducker can run), then close.
    queueMicrotask(() => {
      onMessage({ kind: "stub" });
      onMessage({ kind: "final" });
    });
    return {
      close() {
        /* no-op */
      },
      sendText() {
        /* no-op */
      },
    };
  }

  const Impl =
    opts.WebSocketImpl ??
    (typeof WebSocket !== "undefined" ? WebSocket : undefined);
  if (!Impl) throw new Error("No WebSocket implementation available");

  const ws = new Impl(signed.url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) {
      onMessage({ kind: "audio", data: ev.data });
    } else if (typeof ev.data === "string") {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed?.type === "final") onMessage({ kind: "final" });
        else if (parsed?.type === "error")
          onMessage({ kind: "error", message: String(parsed?.message ?? "ws error") });
      } catch {
        // ignore malformed text frames
      }
    }
  };
  ws.onerror = () => onMessage({ kind: "error", message: "ws error" });
  ws.onclose = () => onMessage({ kind: "final" });
  return {
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
    sendText(text: string) {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ text }));
    },
  };
}
