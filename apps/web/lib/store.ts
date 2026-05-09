"use client";

import { useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  createMatchStore,
  manifestSource,
  syntheticArFrSource,
  useMatchStream,
  type ManifestController,
  type MatchStore,
  type StreamSource,
} from "@vtorn/spec-client";

export interface ResolvedStream {
  store: StoreApi<MatchStore>;
  /** Set when the underlying source is a manifest replay; null otherwise. */
  controller: ManifestController | null;
}

const MANIFEST_PREFIXES = [".ndjson", ".ndjson.gz"];

function isManifestUrl(url: string): boolean {
  return MANIFEST_PREFIXES.some((s) => url.toLowerCase().endsWith(s));
}

/**
 * Resolve the renderer's stream input.
 *
 *   - `synthetic` keyword (or undefined / empty) → in-process AR-FR fixture.
 *   - URL ending in `.ndjson` / `.ndjson.gz` → manifest-mode replay with
 *     a returned `ManifestController` for scrubber UIs.
 *   - `ws://...` / `wss://...` URL → live producer.
 *
 * Renderer routes call this to keep their own logic free of source
 * resolution.
 */
export function useRendererStream(input: string | undefined): ResolvedStream {
  const [controller, setController] = useState<ManifestController | null>(null);

  const resolved = useMemo<string | StreamSource>(() => {
    if (!input || input === "synthetic") {
      setController(null);
      return syntheticArFrSource();
    }
    if (isManifestUrl(input)) {
      // Manifest mode: hand the controller back through React state so a
      // sibling <TimelineScrubber/> can drive seek/play/rate.
      return manifestSource(input, {
        autoplay: true,
        onReady: (c) => setController(c),
      });
    }
    setController(null);
    return input;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const store = useMatchStream(resolved);
  return { store, controller };
}

/** React hook over a Zustand vanilla store. */
export function useMatch<T>(store: StoreApi<MatchStore>, selector: (s: MatchStore) => T): T {
  return useStore(store, selector);
}

export { createMatchStore };
