"use client";

import { useEffect, useState } from "react";
import {
  getBodyClone,
  loadSharedBody,
  type ClonedBody,
} from "@vtorn/avatar";

/**
 * React hook: kick off the shared body GLB load and return a per-player
 * `ClonedBody` clone once the GPU buffer is ready.
 *
 * The underlying loader is module-cached inside `@vtorn/avatar`, so all
 * 22 players hit the network exactly once. Each render gets an
 * independent skeleton/material clone so per-player jersey textures and
 * (future) animation playheads don't collide.
 */
export function useClonedBody(): ClonedBody | null {
  const [body, setBody] = useState<ClonedBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Warm the shared cache, then hand back a clone.
    loadSharedBody()
      .then(() => getBodyClone())
      .then((cloned) => {
        if (cancelled) return;
        setBody(cloned);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[body-cache] body GLB failed to load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return body;
}
