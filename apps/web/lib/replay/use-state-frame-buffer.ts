"use client";

import { useEffect, useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import { StateFrameBuffer } from "./state-frame-buffer.js";

/**
 * Hook: get a per-store `StateFrameBuffer` and keep it in sync with the
 * store's incoming state frames.
 *
 * The buffer is the source of truth for "what pose is on screen now".
 * It survives across re-renders (memoised by `store` identity) and is
 * fed by a Zustand subscription that fires whenever `state.curr`
 * advances.
 *
 * Consumers (Player, Ball, Director, CameraRig) call `buffer.sample()`
 * inside `useFrame` and read pose from the resulting `InterpolatedFrame`.
 */
export function useStateFrameBuffer(store: StoreApi<MatchStore>): StateFrameBuffer {
  // Memoise on `store` identity so the buffer is rebuilt when the
  // upstream store is swapped (e.g. between matches).
  const buffer = useMemo(
    () => new StateFrameBuffer({ capacity: 12 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store],
  );

  useEffect(() => {
    let lastT: number | null = null;
    // Seed with whatever the store currently has so the buffer doesn't
    // start empty if we mount mid-stream.
    const initial = store.getState();
    if (initial.prev) buffer.push(initial.prev);
    if (initial.curr && initial.curr.t !== initial.prev?.t) {
      buffer.push(initial.curr);
      lastT = initial.curr.t;
    }
    const unsub = store.subscribe((s) => {
      if (s.curr && s.curr.t !== lastT) {
        buffer.push(s.curr);
        lastT = s.curr.t;
      }
    });
    return () => {
      unsub();
      buffer.reset();
    };
  }, [store, buffer]);

  return buffer;
}
