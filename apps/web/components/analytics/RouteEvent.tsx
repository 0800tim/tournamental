"use client";

/**
 * Tiny client component that fires a single analytics event on mount.
 *
 * Useful for marking the "user landed on this surface" entry-point of a
 * page that is otherwise a Server Component (no client hooks available
 * for analytics there). Drop it inside the page tree:
 *
 *     <RouteEvent name="match.opened" payload={{ match_id: id }} />
 *
 * Renders nothing.
 */

import { useEffect, useRef } from "react";

import { track, type EventName, type EventPayload } from "@/lib/analytics";

export interface RouteEventProps {
  readonly name: EventName;
  readonly payload?: EventPayload;
}

export function RouteEvent({ name, payload }: RouteEventProps) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(name, payload);
  }, [name, payload]);
  return null;
}
