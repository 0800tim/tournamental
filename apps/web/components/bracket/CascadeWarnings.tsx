"use client";

/**
 * Human-friendly cascade warning surface for the bracket builder.
 *
 * The cascade engine emits machine-codes ("annex_c_third_pool_incomplete",
 * "missing_group_prediction" etc.) with developer-targeted messages.
 * That was fine while the builder was an internal preview, but Tim
 * 2026-06-05 surfaced this on the public bracket page and the system
 * text was reading as nonsense to players.
 *
 * This component does three things:
 *
 *   1. Translates each warning code into a single, plain-English
 *      sentence ("Pick 8 best 3rd-placed teams to unlock the Round
 *      of 32"). Identical warnings collapse to one line.
 *   2. Renders a contextual banner at the top of late-stage tabs
 *      when empty slots are present because earlier stages aren't
 *      filled, with a direct link/CTA to the right tab.
 *   3. Hides the warning list entirely once every cascade slot is
 *      resolved, so a completed bracket doesn't show a stale
 *      "0 warnings" affordance.
 *
 * The actual warnings list is still rendered (as a single friendly
 * <details> section) so a curious user can still see what's
 * outstanding without us writing copy for every conceivable
 * combination.
 */

import type { CascadeWarning } from "@tournamental/bracket-engine";

import "./cascade-warnings.css";

export type BracketTabId =
  | "groups"
  | "thirds"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "tp"
  | "final";

export interface CascadeWarningsProps {
  readonly warnings: ReadonlyArray<CascadeWarning>;
  /** The tab the user is currently looking at. Drives the banner. */
  readonly currentTab: BracketTabId;
  /**
   * Fired when the contextual banner's CTA is clicked. The parent
   * decides what "go back" means (typically `setTab(targetTab)`).
   */
  readonly onJumpToTab: (target: BracketTabId) => void;
  /**
   * Which surfaces to render. Tim 2026-06-05 split the banner from
   * the details list so the banner can hoist to the top of a round
   * (it's the actionable bit) while the long-form details stay at
   * the bottom (the curious-user reference).
   *
   * - `"full"` (default): renders both.
   * - `"banner"`: just the contextual "go back to <prior tab>" CTA.
   * - `"details"`: just the collapsible list.
   */
  readonly mode?: "full" | "banner" | "details";
}

/**
 * Plain-English sentence per warning code. Anything not in this map
 * falls back to a generic "Something needs your attention upstream"
 * line so we don't leak an `annex_c_third_pool_incomplete`-shaped
 * string at the user.
 */
function friendlyMessage(code: CascadeWarning["code"]): string {
  switch (code) {
    case "missing_group_prediction":
    case "incomplete_group_order":
      return "A group still needs every match predicted before the cascade can rank the standings.";
    case "missing_wildcard_pick":
    case "annex_c_third_pool_incomplete":
      return "The Top 8 3rd-placed teams stage needs all 8 picks before the Round of 32 can fill in.";
    case "annex_c_lookup_missing":
    case "annex_c_no_third_for_group_winner":
      return "Your Top 8 3rds combination is rare enough that FIFA's Annex C lookup table doesn't cover it. Try swapping one of the picks.";
    case "team_not_in_group":
    case "duplicate_team_in_group":
      return "A group has a duplicated team. Re-pick that group's matches to fix the ordering.";
    case "winner_not_in_match":
      return "A knockout pick references a team that isn't in the matchup any more. Re-pick the winner.";
    case "withdrawn_team_advancing":
      return "A team in this matchup has withdrawn from the tournament.";
    default:
      return "Something upstream needs picking before this stage can finish resolving.";
  }
}

/**
 * Which earlier tab does this warning belong to? Used to choose the
 * banner's "Go back to X" CTA target.
 */
function originTab(code: CascadeWarning["code"]): BracketTabId {
  switch (code) {
    case "missing_wildcard_pick":
    case "annex_c_third_pool_incomplete":
    case "annex_c_lookup_missing":
    case "annex_c_no_third_for_group_winner":
      return "thirds";
    case "missing_group_prediction":
    case "incomplete_group_order":
    case "team_not_in_group":
    case "duplicate_team_in_group":
      return "groups";
    case "winner_not_in_match":
    case "withdrawn_team_advancing":
    default:
      return "groups";
  }
}

const TAB_LABEL: Record<BracketTabId, string> = {
  groups: "Group stage",
  thirds: "Top 8 3rds",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  tp: "Third-place playoff",
  final: "Final",
};

const TAB_ORDER: BracketTabId[] = [
  "groups",
  "thirds",
  "r32",
  "r16",
  "qf",
  "sf",
  "tp",
  "final",
];

/**
 * Pick the most relevant warning for a banner: prefer the earliest-
 * stage origin, since fixing that upstream usually resolves the
 * downstream ones. Returns null when none of the warnings sit
 * upstream of the current tab.
 */
function pickBannerWarning(
  warnings: ReadonlyArray<CascadeWarning>,
  currentTab: BracketTabId,
): { target: BracketTabId; message: string } | null {
  const currentIdx = TAB_ORDER.indexOf(currentTab);
  if (currentIdx <= 0) return null;
  // Walk the warnings, find the earliest-stage origin that's strictly
  // before the current tab.
  let best: { target: BracketTabId; targetIdx: number } | null = null;
  for (const w of warnings) {
    const target = originTab(w.code);
    const targetIdx = TAB_ORDER.indexOf(target);
    if (targetIdx < 0 || targetIdx >= currentIdx) continue;
    if (best === null || targetIdx < best.targetIdx) {
      best = { target, targetIdx };
    }
  }
  if (!best) return null;
  const targetLabel = TAB_LABEL[best.target];
  const currentLabel = TAB_LABEL[currentTab];
  return {
    target: best.target,
    message: `Some slots on the ${currentLabel} aren't filled in yet because the ${targetLabel} stage is incomplete. Head back to finish it and the rest of the bracket will fill in.`,
  };
}

export function CascadeWarnings({
  warnings,
  currentTab,
  onJumpToTab,
  mode = "full",
}: CascadeWarningsProps): JSX.Element | null {
  if (warnings.length === 0) return null;

  // Collapse duplicate code+message pairs so eight identical
  // "annex_c_third_pool_incomplete" lines render as one sentence.
  const uniqueByCode = new Map<string, string>();
  for (const w of warnings) {
    const key = w.code;
    if (!uniqueByCode.has(key)) {
      uniqueByCode.set(key, friendlyMessage(w.code));
    }
  }
  const friendlyList = Array.from(uniqueByCode.entries());
  const banner = pickBannerWarning(warnings, currentTab);

  // In banner-only mode, render nothing when there's no upstream
  // banner to show; the parent doesn't need an empty wrapper.
  if (mode === "banner" && banner === null) return null;

  return (
    <div className="bracket-cascade-warnings">
      {mode !== "details" && banner ? (
        <div className="bracket-cascade-banner" role="status">
          <span className="bracket-cascade-banner-text">{banner.message}</span>
          <button
            type="button"
            className="bracket-cascade-banner-cta"
            onClick={() => onJumpToTab(banner.target)}
          >
            Go to {TAB_LABEL[banner.target]} →
          </button>
        </div>
      ) : null}

      {mode !== "banner" ? (
        <details className="bracket-cascade-details">
          <summary>
            {friendlyList.length === 1
              ? "Heads up about your picks"
              : `${friendlyList.length} things still need picking`}
          </summary>
          <ul>
            {friendlyList.map(([code, msg]) => (
              <li key={code}>{msg}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
