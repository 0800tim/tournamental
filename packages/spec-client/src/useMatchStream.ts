import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";
import { createMatchStore, type MatchStore, type StreamSource } from "./store";
import { wsSource } from "./ws";

/**
 * Resolve a string url or an explicit StreamSource into a StreamSource.
 * Accepting strings keeps the public API simple (`useMatchStream("ws://..." )`)
 * while still allowing callers to pass synthetic / canned sources for tests
 * and offline demos.
 */
function resolveSource(input: string | StreamSource): StreamSource {
  if (typeof input === "string") return wsSource(input);
  return input;
}

/**
 * React hook: subscribe to a spec stream. Returns a Zustand vanilla store
 * (rather than a value) so callers can read individual fields with
 * `useStore(store, selector)` without re-rendering on every state frame.
 *
 * On unmount the underlying source is stopped and the store is reset.
 */
export function useMatchStream(input: string | StreamSource): StoreApi<MatchStore> {
  // Memoise the store so unrelated parent re-renders don't recreate it.
  const store = useMemo(() => createMatchStore(), []);

  useEffect(() => {
    const source = resolveSource(input);
    const onMessage = (m: import("@tournamental/spec").Message) => store.getState().applyMessage(m);
    const onStatus = (s: Parameters<MatchStore["setStatus"]>[0]) => store.getState().setStatus(s);
    source.start(onMessage, onStatus);
    return () => {
      source.stop();
      store.getState().reset();
    };
    // We intentionally only re-run when the stream identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, store]);

  return store;
}

/**
 * Cheap hook to subscribe to a single slice of the store. Wraps
 * useSyncExternalStore so React 18 can bail out of re-renders for unchanged
 * slices.
 */
export function useMatchSlice<T>(store: StoreApi<MatchStore>, selector: (s: MatchStore) => T): T {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export { createMatchStore };
