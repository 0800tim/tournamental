"use client";

import { useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  createMatchStore,
  syntheticArFrSource,
  useMatchStream,
  type MatchStore,
  type StreamSource,
} from "@vtorn/spec-client";

/**
 * Convenience wrapper that resolves the renderer's stream input.
 *
 *   - `synthetic` keyword (or undefined / empty) → in-process AR-FR fixture.
 *   - `ws://...` / `wss://...` URL → live producer.
 *
 * Renderer routes call this to keep their own logic free of source-resolution.
 */
export function useRendererStream(input: string | undefined): StoreApi<MatchStore> {
  const resolved = useMemo<string | StreamSource>(() => {
    if (!input || input === "synthetic") return syntheticArFrSource();
    return input;
  }, [input]);
  return useMatchStream(resolved);
}

/** React hook over a Zustand vanilla store. */
export function useMatch<T>(store: StoreApi<MatchStore>, selector: (s: MatchStore) => T): T {
  return useStore(store, selector);
}

export { createMatchStore };
