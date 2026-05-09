/**
 * Event → animation-action adapter.
 *
 * Per docs/27a-fidelity-phase1-mocap-rig.md, the renderer-side bridge
 * between spec events and the per-player FSM. Most of the mapping
 * lives inside `@vtorn/avatar` (`eventToOneShot`); this file exposes
 * a thin wrapper that:
 *
 *   - Filters the global event stream to events for a given player.
 *   - Returns the AnimTag the FSM should consume, or null.
 *   - Adds renderer-only logic that doesn't belong in the package
 *     (e.g. picking which celebration variant to play if/when we
 *     authore alternates).
 *
 * Keeping this in `apps/web/lib/` instead of `@vtorn/avatar` means a
 * future renderer (mobile native, etc.) can supply its own adapter
 * without forking the package.
 */
import type { AnimTag, EventMessage } from "@vtorn/spec";
import { eventToOneShot } from "@vtorn/avatar";

export interface EventActionResult {
  tag: AnimTag;
  /** The triggering event, retained for telemetry / commentary anchors. */
  event: EventMessage;
}

/** Map a single event to a one-shot for `playerId`, or null. */
export function eventActionFor(
  playerId: string,
  ev: EventMessage,
): EventActionResult | null {
  const tag = eventToOneShot(playerId, ev);
  if (!tag) return null;
  return { tag, event: ev };
}

/**
 * Filter a batch of events to ones that affect `playerId`.
 *
 * Returns each impactful event paired with its derived tag. The order
 * matches the input order (i.e. the latest event's tag wins inside the
 * FSM).
 */
export function filterEventsForPlayer(
  playerId: string,
  events: EventMessage[],
): EventActionResult[] {
  const out: EventActionResult[] = [];
  for (const ev of events) {
    const result = eventActionFor(playerId, ev);
    if (result) out.push(result);
  }
  return out;
}
