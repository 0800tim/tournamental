import type { Message } from "@tournamental/spec";
import type { StreamSource, StreamStatus } from "./store";

/**
 * WebSocket-backed stream source.
 *
 * Reconnects with capped exponential backoff (1s → 8s) until `stop()` is
 * called. Each incoming message is JSON-parsed and forwarded; malformed
 * messages are logged and dropped (we trust the producer's schema).
 */
export function wsSource(url: string): StreamSource {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    start(onMessage, onStatus) {
      const connect = () => {
        if (stopped) return;
        onStatus("connecting");
        try {
          socket = new WebSocket(url);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[spec-client] failed to construct WebSocket:", err);
          onStatus("error");
          scheduleRetry();
          return;
        }

        socket.addEventListener("open", () => {
          retryDelay = 1000;
          onStatus("open");
        });

        socket.addEventListener("message", (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as Message;
            onMessage(msg);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[spec-client] dropping malformed message:", err);
          }
        });

        socket.addEventListener("close", () => {
          onStatus("closed");
          scheduleRetry();
        });

        socket.addEventListener("error", () => {
          onStatus("error");
        });
      };

      const scheduleRetry = () => {
        if (stopped) return;
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 8000);
          connect();
        }, retryDelay);
      };

      connect();
    },

    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket && socket.readyState <= 1) socket.close();
      socket = null;
    },
  };
}
