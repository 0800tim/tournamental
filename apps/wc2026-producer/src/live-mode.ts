/**
 * Live mode — STUB.
 *
 * Where a future live data partner plugs in.
 *
 * The WC 2026 live-stream contract isn't decided yet (we don't know the
 * data partner). This module documents the shape we expect from any
 * partner so that integration is hours, not days, once the contract is
 * signed.
 *
 * Candidate partners (recommended discussion order):
 *   1. **Sportradar** — most mature WC live feed; full positional data
 *      via their MetaSport API; commercial licence required. Their
 *      schema maps fairly cleanly onto @vtorn/spec.
 *   2. **Stats Perform / OPTA** — alternative; richer event taxonomy,
 *      lighter on positional. Good for HUD events; lighter on render
 *      fidelity.
 *   3. **FIFA's own feed** — historically not made available outside
 *      official broadcasters; but FIFA+ has hinted at API partners for
 *      WC 2026. Ask FIFA Media directly Q3 2025.
 *   4. **Wyscout / SecondSpectrum** — tracking-data specialists; most
 *      expensive, highest fidelity. Probably overkill until v0.3.
 *
 * The producer abstracts all four behind a single `LiveDataAdapter`
 * interface; each partner is one concrete impl. None are wired yet.
 */

import type { Message } from "@vtorn/spec";
import type { Fixture } from "./fixtures.js";

export interface LiveDataAdapter {
  /** Stable adapter identifier, e.g. "sportradar-v1", "opta-rest-v3". */
  readonly id: string;

  /** Returns true if this adapter has a feed for the given fixture. */
  supports(fixture: Fixture): Promise<boolean>;

  /**
   * Open a stream for the given fixture and yield canonical
   * `@vtorn/spec` messages. Closes when the upstream feed terminates.
   */
  stream(fixture: Fixture, signal: AbortSignal): AsyncIterable<Message>;
}

/**
 * Placeholder adapter — never returns frames. Throws if called. Concrete
 * adapters replace this once a partner is signed.
 */
export class UnconfiguredLiveAdapter implements LiveDataAdapter {
  readonly id = "unconfigured";
  async supports(_fixture: Fixture): Promise<boolean> {
    return false;
  }
  async *stream(_fixture: Fixture, _signal: AbortSignal): AsyncIterable<Message> {
    throw new Error(
      "Live mode is not configured. See apps/wc2026-producer/src/live-mode.ts " +
        "for the partner-onboarding checklist.",
    );
  }
}
