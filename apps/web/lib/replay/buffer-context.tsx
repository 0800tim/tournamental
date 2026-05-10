"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { StateFrameBuffer } from "./state-frame-buffer.js";

const BufferContext = createContext<StateFrameBuffer | null>(null);

/**
 * Provide a single `StateFrameBuffer` to the entire scene. Children
 * read it via `useSceneBuffer()` and sample inside `useFrame`.
 *
 * Mounted by `<MatchScene />` after it has resolved the store.
 */
export function StateFrameBufferProvider({
  buffer,
  children,
}: {
  buffer: StateFrameBuffer;
  children: ReactNode;
}) {
  return (
    <BufferContext.Provider value={buffer}>{children}</BufferContext.Provider>
  );
}

/**
 * Read the scene's shared `StateFrameBuffer`. Returns `null` if the
 * caller is mounted outside of `<StateFrameBufferProvider>` — components
 * that need it should fall back to the legacy
 * `interpolatePlayer/interpolateBall(prev, curr, alphaForNow(...))`
 * path so we don't break tests.
 */
export function useSceneBuffer(): StateFrameBuffer | null {
  return useContext(BufferContext);
}
