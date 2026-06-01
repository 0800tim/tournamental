/**
 * BracketBuilder, owns prediction state for the per-match prediction
 * game.
 *
 * The bracket is split into round-tabs so users (especially on mobile)
 * can navigate the 104-match tournament one round at a time:
 *
 *   - Groups  , 12 GroupCards, vertical stack per group
 *   - R32     , Round-of-32 cards in a responsive grid
 *   - R16     , Round-of-16 cards in a responsive grid
 *   - QF      , Quarter-finals
 *   - SF + 3rd, Semi-finals + 3rd-place playoff
 *   - Final   , the Final match + save & share summary
 *
 * Tab state is URL-hash-routable so the user can bookmark or share
 * `/world-cup-2026#qf` and land on the quarter-finals.
 *
 * "Save" everywhere in user copy: the internal field name `lockedAt`
 * (used by the scoring engine) is intentionally preserved, but every
 * user-facing button/label/toast reads as "Save" / "Saved". Tim's spec:
 * picks are changeable until the match kicks off, so "lock" sounds too
 * final.
 *
 * Performance: standings are computed pure-functionally on every
 * keystroke; a 12-group recompute is sub-millisecond on every device we
 * care about. The cascade likewise re-runs on every change to feed the
 * knockout slots. No memoisation needed for v0.1.
 */

"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

/**
 * Variant of safeT that pulls the literal template string via t.raw(),
 * so keys containing `{placeholder}` tokens don't make next-intl throw
 * "missing value" -- the caller does its own `.replace("{name}", ...)`
 * interpolation. Use this for any key with embedded React children
 * (the headline) or where the caller manages substitution itself.
 */
function safeTRaw(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const fn = (t as unknown as { raw?: (k: string) => unknown }).raw;
    if (typeof fn !== "function") return fallback;
    const out = fn.call(t, key);
    if (typeof out !== "string" || out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

import {
  cascade,
  isGroupComplete,
  type Bracket,
  type CascadedBracket,
  type CascadedKnockout,
  type GroupTiebreaker,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { GroupCard } from "./GroupCard";
import { KnockoutMatch } from "./KnockoutMatch";
import { LockSummary } from "./LockSummary";
import { ThirdsPicker, autoPickTop8Thirds } from "./ThirdsPicker";
import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { PunditBadge } from "@/components/shared/PunditBadge";
import { mockTopN } from "@/lib/mock/leaderboard";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { appendHistory, snapshotOdds } from "@/lib/bracket/history";
import {
  HAPTIC,
  scrollIntoViewIfHidden,
  useHaptic,
  usePinchZoom,
  useStickyGroupHeaders,
} from "@/lib/bracket/mobile-gestures";
import { track } from "@/lib/analytics";
import { useCascadePulse } from "@/lib/bracket/use-cascade-pulse";
import { localUserId, loadDraft, saveDraft } from "@/lib/bracket/storage";
import { loadServerBracket, saveFullBracket, savePerMatchPick } from "@/lib/bracket/api";
import { mergeBrackets } from "@/lib/bracket/merge";
import { submitBracket } from "@/lib/bracket/submit";
import { useUser } from "@/lib/auth/useUser";
import { SignupModal } from "@/components/auth/SignupModal";
import { shareContent } from "@/lib/native";
import {
  buildShareText,
  buildShareTextBody,
  buildShareTitle,
  resolveShareGuid,
  shareUrlFor,
} from "@/lib/share/share-text";
import { loadStoredShareGuid } from "@/lib/share/share-guid-storage";
import { slugifyDisplayName } from "@/lib/share/handle-slug";
import { useCountry } from "@/lib/odds/use-country";
import type { MatchOdds } from "@/lib/odds/types";
import { fetchPunditStatus, type PunditStatus, UNVERIFIED } from "@/lib/pundit";

import type { StageId } from "@tournamental/bracket-engine";

const KO_PICK_STAGES: readonly StageId[] = ["r32", "r16", "qf", "sf", "tp", "f"] as const;

export interface BracketBuilderProps {
  readonly tournament: Tournament;
}

/**
 * One tab per round, plus the final-round tab also hosts the
 * "save & share" summary. `groups` is the default landing tab.
 */
type TabId = "groups" | "thirds" | "r32" | "r16" | "qf" | "sf" | "final";

const TAB_ORDER: readonly TabId[] = ["groups", "thirds", "r32", "r16", "qf", "sf", "final"];

interface TabMeta {
  readonly id: TabId;
  readonly label: string;
  readonly hash: string;
  readonly aria: string;
}

const TABS: readonly TabMeta[] = [
  { id: "groups", label: "Groups", hash: "#groups", aria: "Group stage matches" },
  // FIFA 2026: top 2 of each group + 8 best 3rd-placers advance to R32.
  // We can't deterministically rank the 12 thirds from outcome-only
  // predictions (no score lines), so the user picks 8 explicitly here.
  // The cascade engine then routes them via the FIFA Annex C lookup
  // table (packages/bracket-engine/data/fifa-2026-annex-c-assignments.json).
  { id: "thirds", label: "Top 8 3rds", hash: "#thirds", aria: "Best 3rd-placed teams that advance" },
  { id: "r32", label: "R32", hash: "#r32", aria: "Round of 32" },
  { id: "r16", label: "R16", hash: "#r16", aria: "Round of 16" },
  { id: "qf", label: "QF", hash: "#qf", aria: "Quarter-finals" },
  { id: "sf", label: "SF + 3rd", hash: "#sf", aria: "Semi-finals and 3rd-place play-off" },
  { id: "final", label: "Final", hash: "#final", aria: "Final and bracket summary" },
];

function hashToTab(raw: string | undefined | null): TabId {
  if (!raw) return "groups";
  const cleaned = raw.replace(/^#/, "").toLowerCase();
  // Allow a few obvious aliases so old `#knockouts` / `#lock` deeplinks
  // don't drop the user on a 404-feeling blank tab.
  if (cleaned === "knockouts") return "r32";
  if (cleaned === "lock") return "final";
  const found = TABS.find((t) => t.id === cleaned);
  return found ? found.id : "groups";
}

function emptyBracket(): Bracket {
  return {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    bestThirds: [],
    knockoutPredictions: {},
    version: 3,
  };
}

/**
 * One-time migration for drafts saved before the FIFA Annex C R32 fix
 * (2026-06-01). Pre-fix drafts hold knockout picks against a now-wrong
 * R32 structure (parallel mini-bracket of 4 thirds-vs-thirds matches).
 * Post-fix, those matchups don't exist any more, so the picks are
 * stale references. We wipe `knockoutPredictions` once on load when
 * a v<3 bracket is detected; group picks survive untouched.
 */
function migrateBracket(b: Bracket | null): { bracket: Bracket | null; wiped: boolean } {
  if (!b) return { bracket: null, wiped: false };
  if ((b.version ?? 0) >= 3) return { bracket: b, wiped: false };
  const knockoutCount = Object.keys(b.knockoutPredictions ?? {}).length;
  return {
    bracket: {
      ...b,
      bestThirds: [],
      knockoutPredictions: {},
      version: 3,
    },
    wiped: knockoutCount > 0,
  };
}

/**
 * Count picks for a given knockout stage so the per-tab progress
 * indicator reads "x of N picked".
 */
function knockoutCountFor(
  stage: TabId,
  cascaded: CascadedBracket,
  picks: Record<string, MatchPrediction>,
): { picked: number; total: number } {
  const stageIds =
    stage === "sf"
      ? (["sf", "tp"] as const)
      : stage === "final"
        ? (["f"] as const)
        : ([stage] as const);
  const matches = cascaded.knockouts.filter((k) =>
    (stageIds as readonly string[]).includes(k.stage),
  );
  const total = matches.length;
  let picked = 0;
  for (const m of matches) if (picks[m.id]) picked += 1;
  return { picked, total };
}

export function BracketBuilder(props: BracketBuilderProps) {
  const { tournament } = props;
  // i18n: resolve every translation via safeT(t, key, englishFallback)
  // so a missing message never crashes the page. The catalogue lives
  // at apps/web/locales/<code>.json under "stage.*" + "bracket.*"
  // (added 2026-05-24).
  const t = useTranslations();
  // Identity hierarchy for bracket ownership:
  //   1. Authed `tnm_session` user id (e.g. `u_<22 hex>`) when signed in.
  //      Game-service verifies the cookie + stores brackets under this id,
  //      so the same picks follow the user across devices.
  //   2. Local browser uuid (`localUserId()`) when signed out. Same as
  //      pre-auth behaviour, brackets stay device-local.
  // The effect below resolves which one to use on every auth state change
  // and migrates a guest bracket into the auth bracket on first sign-in.
  const auth = useUser();
  const [userLocalId, setUserLocalId] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  // Group-stage auto-expand: on initial mount, find the first group
  // that doesn't yet have all 6 matches predicted and seed its
  // accordion as expanded. Frozen at mount time -- we don't re-evaluate
  // after a pick lands so the user's manual collapse choices are never
  // overridden. Null when every group is already complete.
  const [initialOpenGroupId] = useState<string | null>(() => {
    // Initial bracket is always empty on first mount (saved-bracket
    // hydration is a separate post-mount effect). So "first incomplete
    // group" is always the first group in the tournament order.
    // We still call the helper for clarity + to stay correct if the
    // initial-mount bracket ever stops being empty.
    const emptyPreds: Record<string, MatchPrediction> = {};
    for (const g of tournament.groups) {
      if (!isGroupComplete(g.id, tournament, emptyPreds)) return g.id;
    }
    return null;
  });
  const [tab, setTabState] = useState<TabId>("groups");
  const [submitState, setSubmitState] = useState<string>("");
  const [lastSaveOk, setLastSaveOk] = useState<boolean>(false);
  const [showAutoPickConfirm, setShowAutoPickConfirm] = useState<boolean>(false);
  /**
   * Auto-pick: preserve existing picks by default. Tim 2026-06-01:
   * before this, hitting Auto-pick nuked any picks the user had already
   * made by hand, which was a real friction point. Now the modal has
   * an "Overwrite existing picks" checkbox, defaulting to UNCHECKED.
   * When unchecked, handleAutoPick only fills empty match-prediction
   * slots and leaves the rest alone. When ticked, restores the
   * previous behaviour of fully overwriting.
   */
  const [overwriteExistingPicks, setOverwriteExistingPicks] = useState<boolean>(false);
  // SignupModal trigger + "save once the user signs in" handoff. Tim
  // 2026-05-21: when an anonymous player finishes their 104 picks and
  // taps "Save my bracket", we open the signup modal first; on success
  // we run handleSubmit so localStorage picks get merged + saved
  // server-side in one motion.
  const [showSignupModal, setShowSignupModal] = useState<boolean>(false);
  const [pendingSaveAfterAuth, setPendingSaveAfterAuth] = useState<boolean>(false);
  const [oddsByMatch, setOddsByMatch] = useState<ReadonlyMap<string, MatchOdds>>(
    () => new Map(),
  );
  const [punditStatus, setPunditStatus] = useState<PunditStatus>(UNVERIFIED);
  // Mobile viewport flag (<= 768px). Drives the stage-as-page carousel
  // layout: on mobile all six stage panels render inline in a horizontal
  // scroll-snap container so the user can swipe between rounds; on
  // desktop only the active panel renders, preserving the editorial
  // vertical-scroll experience. Defaults to `false` so SSR + jsdom tests
  // render desktop-style markup (only the active panel is in the
  // accessibility tree, matching existing test expectations).
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const country = useCountry();

  // Mobile gesture plumbing, these refs/effects are no-ops on
  // viewports wider than 640px so desktop UX is untouched.
  const haptic = useHaptic();
  const groupsRootRef = useStickyGroupHeaders<HTMLDivElement>({
    headerSelector: ".bracket-group-head",
  });
  const { containerRef: kmContainerRef, targetRef: kmTargetRef } = usePinchZoom<
    HTMLDivElement,
    HTMLDivElement
  >();
  const prevKnockoutsRef = useRef<readonly CascadedKnockout[] | null>(null);
  const lastEditedRef = useRef<{ kind: "group" | "knockout"; matchId: string } | null>(null);
  // Carousel container that holds all six stage panels on mobile. We
  // programmatically scroll it to the active tab on click, and read its
  // scrollLeft on user swipe to update the active tab.
  const carouselRef = useRef<HTMLDivElement | null>(null);
  // Suppress the swipe→tab feedback loop while we're programmatically
  // scrolling in response to a tab click.
  const programmaticScrollRef = useRef<boolean>(false);

  // Resolve mobile vs desktop via matchMedia. Re-evaluates on window
  // resize so a user rotating their device or resizing the window
  // transitions cleanly between the two layouts.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mql.matches);
    apply();
    // Older Safari uses addListener/removeListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    mql.addListener(apply);
    return () => mql.removeListener(apply);
  }, []);

  // Hash-driven tab routing. On mount, read window.location.hash. We
  // listen for hashchange so back/forward navigation keeps the tab in
  // sync. Writing the hash is debounced through `setTab` below.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setTabState(hashToTab(window.location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const target = TABS.find((t) => t.id === next)?.hash ?? "#groups";
    // Use history.replaceState so we don't pollute the back stack on
    // every tab nudge; we still fire a synthetic hashchange so any
    // sibling components listening pick it up.
    if (window.location.hash !== target) {
      const url = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(null, "", url);
    }
    // Animate the mobile carousel to the new stage. Guarded so it's a
    // no-op on desktop and during tests without scrollTo support.
    const carousel = carouselRef.current;
    if (!carousel || typeof carousel.scrollTo !== "function") return;
    const idx = TAB_ORDER.indexOf(next);
    if (idx < 0) return;
    const width = carousel.clientWidth;
    if (!width) return;
    programmaticScrollRef.current = true;
    carousel.scrollTo({ left: idx * width, behavior: "smooth" });
    // Release the suppression flag a beat after the smooth-scroll
    // completes. 600ms covers the worst-case browser easing curve.
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 600);
  }, []);

  // Sync the active tab to whichever panel is most in-view on the
  // mobile carousel. Throttled via requestAnimationFrame and
  // suppressed while we're driving the scroll programmatically.
  useEffect(() => {
    const el = carouselRef.current;
    if (!el || !isMobile) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const width = el.clientWidth;
        if (!width) return;
        const idx = Math.round(el.scrollLeft / width);
        const clamped = Math.max(0, Math.min(TAB_ORDER.length - 1, idx));
        const nextTab = TAB_ORDER[clamped]!;
        setTabState((cur) => {
          if (cur === nextTab) return cur;
          const target = TABS.find((t) => t.id === nextTab)?.hash ?? "#groups";
          if (typeof window !== "undefined" && window.location.hash !== target) {
            const url = `${window.location.pathname}${window.location.search}${target}`;
            window.history.replaceState(null, "", url);
          }
          return nextTab;
        });
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [isMobile]);

  // When the mobile layout first mounts, jump the carousel to the
  // active stage (without animation) so #qf deep-links land correctly.
  useEffect(() => {
    if (!isMobile) return;
    const el = carouselRef.current;
    if (!el) return;
    const idx = TAB_ORDER.indexOf(tab);
    if (idx < 0) return;
    const width = el.clientWidth;
    if (!width) return;
    programmaticScrollRef.current = true;
    el.scrollLeft = idx * width;
    // Drop the suppression in the next microtask, no animation here.
    Promise.resolve().then(() => {
      programmaticScrollRef.current = false;
    });
    // We intentionally don't depend on `tab` here, this is the
    // first-paint sync; subsequent tab clicks call `setTab` which
    // handles its own scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  useEffect(() => {
    // Wait for auth to settle before deciding identity. "loading" means
    // we don't yet know if the user is signed in; hydrating now under
    // the guest id and then again under the auth id would race and
    // potentially clobber picks.
    if (auth.loading) return;

    const authedId = auth.user?.id ?? null;
    const guestId = localUserId();
    const id = authedId ?? guestId;
    setUserLocalId(id);

    let cancelled = false;
    (async () => {
      // Load whatever's in localStorage for THIS identity. May be null
      // for a first-time authed user; we hydrate from the server below.
      let starting = loadDraft(tournament.id, id);
      // One-time migration: drafts saved before the FIFA Annex C R32
      // fix hold knockout picks against a now-wrong R32 routing. Wipe
      // those (group picks survive) and surface a one-line notice so
      // the user knows to re-run knockouts. Tim 2026-06-01.
      const migr = migrateBracket(starting);
      starting = migr.bracket;
      if (migr.wiped) {
        setSubmitState(
          "We updated the 2026 Round-of-32 routing to match FIFA's Annex C rules. Your group picks were preserved, but your knockout picks were cleared — please re-pick R32 onwards (auto-pick will do it instantly).",
        );
        saveDraft(tournament.id, starting!, id);
      }
      if (!starting) starting = { ...emptyBracket(), bracketId: id };
      setBracket(starting);

      // First sign-in migration: if we just transitioned guest→auth and
      // there's a non-empty guest bracket in localStorage that hasn't
      // been migrated yet, fold the guest picks into the auth bracket
      // and POST the merged bracket to the server so the new user has
      // their work persisted.
      if (authedId && authedId !== guestId) {
        const guestDraft = loadDraft(tournament.id, guestId);
        const guestHasPicks =
          guestDraft &&
          (Object.keys(guestDraft.matchPredictions ?? {}).length > 0 ||
            Object.keys(guestDraft.knockoutPredictions ?? {}).length > 0);
        if (guestHasPicks) {
          const merged = mergeBrackets(starting, guestDraft);
          saveDraft(tournament.id, merged, authedId);
          // Fire-and-forget; if it fails the local draft still wins and
          // the next per-match save will reconcile.
          void saveFullBracket({
            userId: authedId,
            tournamentId: tournament.id,
            bracket: merged,
          });
          // Remove the guest draft so we don't migrate it again on a
          // future load. The guest local-uuid stays valid for the next
          // sign-out → guest flow.
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(
              `vtorn:bracket:v2:${tournament.id}:${guestId}`,
            );
          }
          starting = merged;
          if (!cancelled) setBracket(merged);
        }
      }

      // Best-effort server hydration. The game-service uses the
      // tnm_session cookie (or X-User-Id header in dev) to resolve the
      // owner; we still pass userId in the args because the URL builder
      // uses it for the dev fallback.
      const remote = await loadServerBracket({
        userId: id,
        tournamentId: tournament.id,
      });
      if (cancelled || !remote.ok) return;
      setBracket((current) => {
        const merged = mergeBrackets(current, remote.bracket);
        saveDraft(tournament.id, merged, id);
        return merged;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tournament.id, auth.loading, auth.user?.id]);

  useEffect(() => {
    if (userLocalId === "ssr_user") return;
    let cancelled = false;
    fetchPunditStatus(userLocalId).then((status) => {
      if (!cancelled) setPunditStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [userLocalId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/odds/snapshot", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.matches)) return;
        const m = new Map<string, MatchOdds>();
        for (const o of j.matches as MatchOdds[]) m.set(String(o.matchNo), o);
        setOddsByMatch(m);
      })
      .catch(() => {
        /* leave empty; rows render dashes until/unless odds load */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teamMap = useMemo(
    () => new Map(tournament.teams.map((t) => [t.id, t])),
    [tournament.teams],
  );

  const cascaded: CascadedBracket = useMemo(() => {
    const legacy = bracketToCascadeInput(tournament, bracket, userLocalId);
    let result = cascade(tournament, legacy);
    for (let pass = 0; pass < 6; pass += 1) {
      const knockouts = Object.values(bracket.knockoutPredictions)
        .map((p) => {
          const k = result.knockouts.find((x) => x.id === p.matchId);
          if (!k) return null;
          const team = p.outcome === "home_win" ? k.home.team : k.away.team;
          return team ? { match_id: p.matchId, winner: team } : null;
        })
        .filter((x): x is { match_id: string; winner: string } => x !== null);
      const before = result.knockouts.filter((k) => k.effective_winner).length;
      result = cascade(tournament, { ...legacy, knockouts });
      const after = result.knockouts.filter((k) => k.effective_winner).length;
      if (after === before) break;
    }
    return result;
  }, [tournament, bracket, userLocalId]);

  // Gold cascade pulse: when an upstream pick newly populates a
  // downstream slot, pulse the affected R32 / R16 / QF / SF / Final card
  // (gold border + scale 1.5%, ~600ms, eased) so the user sees their
  // call ripple forward. Respects prefers-reduced-motion.
  useCascadePulse(cascaded);

  const update = (next: Bracket): void => {
    setBracket(next);
    saveDraft(tournament.id, next, userLocalId);
    // Analytics: a pick was just saved to the draft. Fire-and-forget;
    // payload carries totals (not the picks themselves) so GA4 cohorts
    // can segment by bracket-completion without exposing predictions.
    track("bracket.pick.saved", {
      tournament_id: tournament.id,
      match_predictions: Object.keys(next.matchPredictions).length,
      knockout_predictions: Object.keys(next.knockoutPredictions).length,
      tiebreakers: Object.keys(next.groupTiebreakers).length,
    });
  };

  // Scroll-to-fix: when an upstream pick changes a downstream slot,
  // smooth-scroll the affected knockout card into view if off-screen.
  // We only do this on the per-round tabs that show knockouts.
  useEffect(() => {
    if (tab === "groups") {
      prevKnockoutsRef.current = cascaded.knockouts;
      return;
    }
    const prev = prevKnockoutsRef.current;
    prevKnockoutsRef.current = cascaded.knockouts;
    if (!prev) return;
    const lastEdited = lastEditedRef.current;
    if (!lastEdited) return;
    const prevById = new Map(prev.map((k) => [k.id, k] as const));
    const changed = cascaded.knockouts.find((k) => {
      if (k.id === lastEdited.matchId) return false;
      const before = prevById.get(k.id);
      if (!before) return false;
      return (
        before.home.team !== k.home.team || before.away.team !== k.away.team
      );
    });
    if (!changed) return;
    const raf =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16);
    const cancel =
      typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
        ? window.cancelAnimationFrame
        : (id: number) => clearTimeout(id);
    const handle = raf(() => {
      const el = document.querySelector(`[data-match-id="${changed.id}"]`);
      scrollIntoViewIfHidden(el);
    });
    return () => cancel(handle as number);
  }, [cascaded.knockouts, tab]);

  /**
   * Fire-and-forget per-match save. Doesn't block the UI, the local
   * state update happens synchronously. If the API call fails the
   * localStorage write in `update()` keeps the pick alive locally; the
   * next bulk submit (or page reload merge) will reconcile.
   */
  const persistPickToServer = useCallback(
    (next: MatchPrediction): void => {
      if (userLocalId === "ssr_user") return;
      void savePerMatchPick({
        userId: userLocalId,
        matchId: next.matchId,
        tournamentId: tournament.id,
        outcome: next.outcome,
        ...(next.homeScore !== undefined ? { homeScore: next.homeScore } : {}),
        ...(next.awayScore !== undefined ? { awayScore: next.awayScore } : {}),
        ...(next.oddsAtLock ? { oddsAtLock: next.oddsAtLock } : {}),
      }).then((res) => {
        if (!res.ok) {
          // Soft failure: stay quiet on transport errors (the user is
          // probably offline and we don't want to surface a banner per
          // click), but log a structured warning for observability.
          // eslint-disable-next-line no-console
          console.warn("[bracket] per-match save failed", {
            matchId: next.matchId,
            code: res.code,
            status: res.status,
          });
        }
      });
    },
    [tournament.id, userLocalId],
  );

  /**
   * Persist a bestThirds change to the server. There is no per-third
   * save endpoint (and 8 picks is too few to justify one), so we push
   * the full bracket. Debounced so a rapid sequence of picks coalesces
   * into one round-trip. Tim 2026-06-01: without this, bestThirds only
   * reached the server on the next bulk save, so reloading the bracket
   * page before a bulk save lost the user's picks to the merge.
   */
  const bestThirdsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistBestThirdsToServer = useCallback(
    (next: Bracket): void => {
      if (userLocalId === "ssr_user") return;
      if (bestThirdsSaveTimer.current) clearTimeout(bestThirdsSaveTimer.current);
      bestThirdsSaveTimer.current = setTimeout(() => {
        void saveFullBracket({
          userId: userLocalId,
          tournamentId: tournament.id,
          bracket: next,
        }).then((res) => {
          if (!res.ok) {
            // eslint-disable-next-line no-console
            console.warn("[bracket] bestThirds save failed", {
              code: res.code,
              status: res.status,
            });
          }
        });
      }, 400);
    },
    [tournament.id, userLocalId],
  );

  const onChangeMatch = (next: MatchPrediction): void => {
    const prev = bracket.matchPredictions[next.matchId];
    const isOutcomeChange = !prev || prev.outcome !== next.outcome;
    if (isOutcomeChange) haptic(HAPTIC.pick);
    lastEditedRef.current = { kind: "group", matchId: next.matchId };
    appendHistory(tournament.id, userLocalId, {
      type:
        prev && (prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore)
          ? "match_score"
          : "match_pick",
      id: next.matchId,
      outcome: next.outcome,
      prevOutcome: prev?.outcome,
      odds: next.oddsAtLock ?? prev?.oddsAtLock,
      ts: next.lockedAt,
    });
    update({
      ...bracket,
      matchPredictions: { ...bracket.matchPredictions, [next.matchId]: next },
    });
    persistPickToServer(next);
  };

  const onChangeTiebreaker = (next: GroupTiebreaker): void => {
    appendHistory(tournament.id, userLocalId, {
      type: "tiebreaker_set",
      id: next.groupId,
      ts: next.setAt,
    });
    update({
      ...bracket,
      groupTiebreakers: { ...bracket.groupTiebreakers, [next.groupId]: next },
    });
  };

  const onChangeKnockout = (next: MatchPrediction): void => {
    const prev = bracket.knockoutPredictions[next.matchId];
    const isOutcomeChange = !prev || prev.outcome !== next.outcome;
    if (isOutcomeChange) haptic(HAPTIC.cascadeResolved);
    lastEditedRef.current = { kind: "knockout", matchId: next.matchId };
    appendHistory(tournament.id, userLocalId, {
      type: "knockout_pick",
      id: next.matchId,
      outcome: next.outcome,
      prevOutcome: prev?.outcome,
      odds: next.oddsAtLock ?? prev?.oddsAtLock,
      ts: next.lockedAt,
    });
    update({
      ...bracket,
      knockoutPredictions: { ...bracket.knockoutPredictions, [next.matchId]: next },
    });
    persistPickToServer(next);
  };

  /**
   * Auto-pick, fetch live odds via /api/odds/snapshot and fill EVERY
   * match all the way down to the final, including the 3rd-place
   * playoff and any group tiebreakers.
   *
   * Tim 2026-06-01: respects the `overwriteExistingPicks` modal toggle.
   * When false (default), only empty match-prediction / tiebreaker
   * slots are filled; user's hand-made picks are preserved. When true,
   * every slot is rewritten from live odds (the original behaviour).
   */
  const handleAutoPick = async (): Promise<void> => {
    // Capture the toggle at click-time. Reading from state mid-function
    // is fine because the modal is closed first, but capturing is a
    // small defensive against any setState race.
    const overwrite = overwriteExistingPicks;
    setShowAutoPickConfirm(false);
    setSubmitState(
      overwrite
        ? "auto-picking from live odds (overwriting existing picks)…"
        : "auto-picking empty matches from live odds…",
    );
    track("bracket.autopick.run", {
      tournament_id: tournament.id,
      overwrite_existing: overwrite,
    });
    let snap: { matches: MatchOdds[]; source?: string } | null = null;
    try {
      const r = await fetch("/api/odds/snapshot", { headers: { Accept: "application/json" } });
      if (r.ok) snap = await r.json();
    } catch {
      /* fall through to mock; /api/odds/snapshot has its own deterministic mock fallback */
    }
    if (!snap || !Array.isArray(snap.matches)) {
      setSubmitState("auto-pick: couldn't load odds; nothing changed.");
      return;
    }
    const byNo = new Map(snap.matches.map((m) => [String(m.matchNo), m]));

    let next: Bracket = bracket;
    let groupAdded = 0;
    let groupSkipped = 0;
    let knockoutAdded = 0;
    let knockoutSkipped = 0;
    let tiebreakersSet = 0;
    let tiebreakersSkipped = 0;
    const ts = new Date().toISOString();

    // ---------- Group fixtures ----------
    for (const f of tournament.group_fixtures) {
      const id = String(f.match_no);
      const o = byNo.get(id);
      if (!o) continue;
      // Preserve-existing: skip slots the user has already picked.
      if (!overwrite && next.matchPredictions[id]) {
        groupSkipped += 1;
        continue;
      }
      const h = o.homeWin;
      const d = o.draw ?? -1;
      const a = o.awayWin;
      const max = Math.max(h, d, a);
      const outcome: MatchPrediction["outcome"] =
        max === h ? "home_win" : max === d ? "draw" : "away_win";
      const prev = next.matchPredictions[id]?.outcome;
      const oddsAtLock = snapshotOdds(o);
      next = {
        ...next,
        matchPredictions: {
          ...next.matchPredictions,
          [id]: { matchId: id, outcome, lockedAt: ts, oddsAtLock },
        },
      };
      appendHistory(tournament.id, userLocalId, {
        type: "match_pick",
        id,
        outcome,
        prevOutcome: prev,
        odds: oddsAtLock,
        ts,
      });
      groupAdded += 1;
    }

    // ---------- Group tiebreakers ----------
    for (const g of tournament.groups) {
      const teamIds = g.team_ids;
      if (teamIds.length !== 4) continue;
      // Preserve-existing: skip tiebreakers the user has already set.
      if (!overwrite && next.groupTiebreakers[g.id]) {
        tiebreakersSkipped += 1;
        continue;
      }
      const ranked = [...teamIds].sort((aId, bId) => {
        const ar = tournament.teams.find((t) => t.id === aId)?.fifa_rank ?? 99;
        const br = tournament.teams.find((t) => t.id === bId)?.fifa_rank ?? 99;
        return ar - br;
      }) as [string, string, string, string];
      next = {
        ...next,
        groupTiebreakers: {
          ...next.groupTiebreakers,
          [g.id]: { groupId: g.id, rankedTeams: ranked, setAt: ts },
        },
      };
      tiebreakersSet += 1;
      appendHistory(tournament.id, userLocalId, {
        type: "tiebreaker_set",
        id: g.id,
        ts,
      });
    }

    // ---------- Top 8 3rd Place ----------
    // The cascade can only resolve `annex_c_third` R32 slots once the
    // user has supplied 8 best-third picks. AutoPick picks the 8 with
    // the strongest FIFA rank so the downstream R32 cascade routes
    // through actual teams rather than nulls. Respects the preserve-
    // existing toggle: skip if the user has already chosen 8 and the
    // user opted not to overwrite.
    {
      const existing = next.bestThirds ?? [];
      const shouldPick = overwrite || existing.length < 8;
      if (shouldPick) {
        const picks = autoPickTop8Thirds(
          tournament,
          next.matchPredictions,
          next.groupTiebreakers,
        );
        if (picks.length === 8) {
          next = { ...next, bestThirds: picks };
        }
      }
    }

    // ---------- Knockouts: stage-by-stage with re-cascade ----------
    for (const stage of KO_PICK_STAGES) {
      const legacy = bracketToCascadeInput(tournament, next, userLocalId);
      let round = cascade(tournament, legacy);
      for (let pass = 0; pass < 6; pass += 1) {
        const overlays = Object.values(next.knockoutPredictions)
          .map((p) => {
            const k = round.knockouts.find((x) => x.id === p.matchId);
            if (!k) return null;
            const team = p.outcome === "home_win" ? k.home.team : k.away.team;
            return team ? { match_id: p.matchId, winner: team } : null;
          })
          .filter((x): x is { match_id: string; winner: string } => x !== null);
        const before = round.knockouts.filter((k) => k.effective_winner).length;
        round = cascade(tournament, { ...legacy, knockouts: overlays });
        const after = round.knockouts.filter((k) => k.effective_winner).length;
        if (after === before) break;
      }
      const stageMatches = round.knockouts.filter((k) => k.stage === stage);
      for (const k of stageMatches) {
        if (!k.home.team || !k.away.team) continue;
        // Preserve-existing: skip knockout slots the user has already picked.
        if (!overwrite && next.knockoutPredictions[k.id]) {
          knockoutSkipped += 1;
          continue;
        }
        const o = byNo.get(k.id);
        const prev = next.knockoutPredictions[k.id]?.outcome;
        let outcome: MatchPrediction["outcome"];
        let oddsAtLock = snapshotOdds(o);
        if (o) {
          outcome = o.homeWin >= o.awayWin ? "home_win" : "away_win";
        } else {
          const homeRank = tournament.teams.find((t) => t.id === k.home.team)?.fifa_rank ?? 99;
          const awayRank = tournament.teams.find((t) => t.id === k.away.team)?.fifa_rank ?? 99;
          outcome = homeRank <= awayRank ? "home_win" : "away_win";
          oddsAtLock = undefined;
        }
        next = {
          ...next,
          knockoutPredictions: {
            ...next.knockoutPredictions,
            [k.id]: { matchId: k.id, outcome, lockedAt: ts, oddsAtLock },
          },
        };
        appendHistory(tournament.id, userLocalId, {
          type: "knockout_pick",
          id: k.id,
          outcome,
          prevOutcome: prev,
          odds: oddsAtLock,
          ts,
        });
        knockoutAdded += 1;
      }
    }

    appendHistory(tournament.id, userLocalId, {
      type: "auto_pick_run",
      id: "",
      ts,
      picksAdded: groupAdded + knockoutAdded,
    });

    update(next);
    const totalAdded = groupAdded + knockoutAdded;
    const totalSkipped = groupSkipped + knockoutSkipped + tiebreakersSkipped;
    if (overwrite) {
      setSubmitState(
        `auto-picked ${groupAdded} group + ${knockoutAdded} knockout + ${tiebreakersSet} tiebreakers (source: ${snap.source ?? "mock"}). Adjust any you disagree with.`,
      );
    } else if (totalAdded === 0 && totalSkipped > 0) {
      setSubmitState(
        `auto-pick: every match was already picked; nothing to fill. Tick "Overwrite existing picks" to redo them.`,
      );
    } else {
      setSubmitState(
        `auto-picked ${groupAdded} group + ${knockoutAdded} knockout + ${tiebreakersSet} tiebreakers, kept ${totalSkipped} of your existing picks (source: ${snap.source ?? "mock"}).`,
      );
    }
  };

  /**
   * Per-group auto-pick. Fills only that group's 6 match predictions
   * + its tiebreaker, using the same odds-favourite rule as the global
   * Auto-pick. No knockout work, no /api/odds round-trip, the page-level
   * bulk-fetched oddsByMatch is reused. If the snapshot hasn't landed
   * yet the user gets a soft message and nothing changes.
   */
  const handleAutoPickGroup = (groupId: string): void => {
    if (!oddsByMatch || oddsByMatch.size === 0) {
      setSubmitState(
        `auto-pick group ${groupId}: live odds not loaded yet, try again in a moment.`,
      );
      return;
    }
    const group = tournament.groups.find((g) => g.id === groupId);
    if (!group) return;
    const fixtures = tournament.group_fixtures.filter(
      (f) => f.group_id === groupId,
    );
    if (fixtures.length === 0) return;
    track("bracket.autopick.group.run", {
      tournament_id: tournament.id,
      group_id: groupId,
    });
    let next: Bracket = bracket;
    let added = 0;
    const ts = new Date().toISOString();
    for (const f of fixtures) {
      const id = String(f.match_no);
      const o = oddsByMatch.get(id);
      if (!o) continue;
      const h = o.homeWin;
      const d = o.draw ?? -1;
      const a = o.awayWin;
      const max = Math.max(h, d, a);
      const outcome: MatchPrediction["outcome"] =
        max === h ? "home_win" : max === d ? "draw" : "away_win";
      const prev = next.matchPredictions[id]?.outcome;
      const oddsAtLock = snapshotOdds(o);
      next = {
        ...next,
        matchPredictions: {
          ...next.matchPredictions,
          [id]: { matchId: id, outcome, lockedAt: ts, oddsAtLock },
        },
      };
      appendHistory(tournament.id, userLocalId, {
        type: "match_pick",
        id,
        outcome,
        prevOutcome: prev,
        odds: oddsAtLock,
        ts,
      });
      added += 1;
    }
    // Tiebreaker by FIFA rank, same convention as the global auto-pick.
    if (group.team_ids.length === 4) {
      const ranked = [...group.team_ids].sort((aId, bId) => {
        const ar = tournament.teams.find((t) => t.id === aId)?.fifa_rank ?? 99;
        const br = tournament.teams.find((t) => t.id === bId)?.fifa_rank ?? 99;
        return ar - br;
      }) as [string, string, string, string];
      next = {
        ...next,
        groupTiebreakers: {
          ...next.groupTiebreakers,
          [groupId]: { groupId, rankedTeams: ranked, setAt: ts },
        },
      };
      appendHistory(tournament.id, userLocalId, {
        type: "tiebreaker_set",
        id: groupId,
        ts,
      });
    }
    update(next);
    setSubmitState(
      `auto-picked group ${groupId} (${added} matches). Adjust any you disagree with.`,
    );
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitState("submitting…");
    const submission: Bracket = {
      ...bracket,
      lockedAt: new Date().toISOString(),
    };
    const res = await submitBracket(tournament.id, submission, userLocalId);
    if (res.ok) {
      const rejected = res.rejected ?? [];
      const baseMsg = "Bracket saved. You can change any pick before kickoff.";
      setSubmitState(
        rejected.length === 0
          ? baseMsg
          : `${baseMsg} (${rejected.length} pick${rejected.length === 1 ? "" : "s"} skipped, match already started)`,
      );
      setLastSaveOk(true);
      update(res.bracket_id ? { ...submission, bracketId: res.bracket_id } : submission);
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        bracket_id: res.bracket_id ?? null,
        match_predictions: Object.keys(submission.matchPredictions).length,
        knockout_predictions: Object.keys(submission.knockoutPredictions).length,
        rejected: rejected.length,
        result: "ok",
      });
    } else if (res.status === "saved_offline") {
      setSubmitState(safeT(t, "bracket.submit.saved_offline", "Saved offline, we'll retry when you're back online."));
      setLastSaveOk(true);
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        result: "saved_offline",
        error: res.error ?? "unknown",
      });
    } else {
      setSubmitState(`Save failed: ${res.error ?? "unknown"}, draft saved locally.`);
      setLastSaveOk(false);
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        result: "error",
        error: res.error ?? "unknown",
      });
    }
  };

  // After an anonymous user kicks off signup from the Save panel, this
  // effect catches the moment auth flips authenticated and runs the
  // pending submit. The localStorage → server merge already runs in the
  // auth-state useEffect (line ~338); this just chains the save on top
  // so the user lands on the "Saved ✓" state in one motion.
  useEffect(() => {
    if (!pendingSaveAfterAuth) return;
    if (auth.loading) return;
    if (auth.status !== "authenticated") return;
    setPendingSaveAfterAuth(false);
    void handleSubmit();
    // handleSubmit closes over current bracket — deps below are
    // intentionally minimal to avoid re-firing on every bracket pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSaveAfterAuth, auth.loading, auth.status]);

  const totalGroupMatches = tournament.group_fixtures.length;
  const completedGroupMatches = Object.keys(bracket.matchPredictions).length;
  const completedKnockouts = Object.keys(bracket.knockoutPredictions).length;
  const totalKnockouts = tournament.knockouts.length;
  const totalPicks = totalGroupMatches + totalKnockouts;
  const totalCompleted = completedGroupMatches + completedKnockouts;

  // Subtitle for the prominent Auto-pick CTA changes based on whether the
  // user has already started filling in picks. Tim's spec: "Fill your
  // bracket using live consensus odds…" before any picks, "Refresh empty
  // picks using live consensus odds." once at least one pick exists. Note
  // tie-breakers are intentionally not counted, they're an implementation
  // detail of auto-pick, not a user-initiated action.
  const hasAnyPicks = totalCompleted > 0;
  const autoPickSubtitle = hasAnyPicks
    ? safeT(t, "bracket.autopick.subtitle_consensus", "Refresh empty picks using live consensus odds.")
    : safeT(t, "bracket.autopick.subtitle_default", "Fill your bracket using live consensus odds, you can edit any pick before kickoff.");

  // The auto-pick button has no "no available matches" condition in
  // practice (any unsaved match is a candidate), but we still wire a
  // disabled state for the rare edge-case where the tournament fixture is
  // empty so the keyboard/aria contract is intact.
  const autoPickDisabled = totalPicks === 0;

  // Per-tab progress counter labels.
  const groupProgress = { picked: completedGroupMatches, total: totalGroupMatches };
  const thirdsProgress = {
    picked: (bracket.bestThirds ?? []).length,
    total: 8,
  };
  const r32Progress = knockoutCountFor("r32", cascaded, bracket.knockoutPredictions);
  const r16Progress = knockoutCountFor("r16", cascaded, bracket.knockoutPredictions);
  const qfProgress = knockoutCountFor("qf", cascaded, bracket.knockoutPredictions);
  const sfProgress = knockoutCountFor("sf", cascaded, bracket.knockoutPredictions);
  const finalProgress = knockoutCountFor("final", cascaded, bracket.knockoutPredictions);

  const progressByTab: Record<TabId, { picked: number; total: number }> = {
    groups: groupProgress,
    thirds: thirdsProgress,
    r32: r32Progress,
    r16: r16Progress,
    qf: qfProgress,
    sf: sfProgress,
    final: finalProgress,
  };

  const stagesForTab = (id: TabId): readonly StageId[] => {
    if (id === "sf") return ["sf", "tp"];
    if (id === "final") return ["f"];
    if (id === "groups") return [];
    if (id === "thirds") return [];
    return [id as StageId];
  };

  const renderKnockoutGrid = (id: TabId) => {
    const stages = stagesForTab(id);
    const matches = cascaded.knockouts.filter((k) =>
      (stages as readonly string[]).includes(k.stage),
    );
    if (matches.length === 0) {
      return (
        <p className="bracket-empty-state">
          Make your group-stage picks first, slots fill in here as you pick.
        </p>
      );
    }
    // SF tab: split into Semi-finals + 3rd-place playoff sub-groups so
    // the 3rd-place match doesn't read as just another SF card.
    if (id === "sf") {
      const sf = matches.filter((k) => k.stage === "sf");
      const tp = matches.filter((k) => k.stage === "tp");
      return (
        <>
          {sf.length > 0 && (
            <section
              className="bracket-round-subgroup"
              aria-label={safeT(t, "bracket.subheading.semifinals", "Semi-finals")}
            >
              <h3 className="bracket-round-subgroup-title">{safeT(t, "bracket.subheading.semifinals", "Semi-finals")}</h3>
              <div className="bracket-round-grid">
                {sf.map((k) => (
                  <KnockoutMatch
                    key={k.id}
                    knockout={k}
                    teams={teamMap}
                    prediction={bracket.knockoutPredictions[k.id]}
                    country={country}
                    onChange={onChangeKnockout}
                  />
                ))}
              </div>
            </section>
          )}
          {tp.length > 0 && (
            <section
              className="bracket-round-subgroup"
              aria-label="3rd-place play-off"
            >
              <h3 className="bracket-round-subgroup-title">3rd-place play-off</h3>
              <div className="bracket-round-grid">
                {tp.map((k) => (
                  <KnockoutMatch
                    key={k.id}
                    knockout={k}
                    teams={teamMap}
                    prediction={bracket.knockoutPredictions[k.id]}
                    country={country}
                    onChange={onChangeKnockout}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      );
    }
    return (
      <div
        className={`bracket-round-grid ${id === "final" ? "bracket-round-grid-final" : ""}`}
      >
        {matches.map((k) => (
          <KnockoutMatch
            key={k.id}
            knockout={k}
            teams={teamMap}
            prediction={bracket.knockoutPredictions[k.id]}
            country={country}
            onChange={onChangeKnockout}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="bracket-builder">
      <header className="bracket-header">
        <h1>
          {(() => {
            // Use t() with the placeholder VALUE so next-intl interpolates
            // without throwing. The IIFE catches any failure and falls back
            // to English. This is one of the only ways to render a
            // translation that contains a brand-string substitution inline
            // in JSX while staying SSR-safe across all 22 locales.
            let rendered = "Call every match of the " + tournament.name + ".";
            try {
              const out = t("bracket.hero.headline", { tournament: tournament.name });
              if (typeof out === "string" && out !== "bracket.hero.headline") rendered = out;
            } catch {
              // fall through to the English default above
            }
            return (
              <>
                {rendered}
                {punditStatus.verified && (
                  <span style={{ marginLeft: 10, display: "inline-flex", verticalAlign: "middle" }}>
                    <PunditBadge status={punditStatus} size={20} />
                  </span>
                )}
              </>
            );
          })()}
        </h1>
        <p>
          {safeT(t, "bracket.hero.lede", "Group standings update live from your picks.")}
        </p>
        <div className="bracket-header-lower">
          <aside className="bracket-edit-anytime" role="note" aria-labelledby="bracket-edit-anytime-heading">
            <div className="bracket-edit-anytime-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </div>
            <div className="bracket-edit-anytime-body">
              <h2 id="bracket-edit-anytime-heading" className="bracket-edit-anytime-heading">
                {safeT(t, "bracket.hero.edit_anytime_heading", "Flexible to change throughout the tournament")}
              </h2>
              <p className="bracket-edit-anytime-lead">
                {safeT(t, "bracket.hero.edit_anytime_lead", "Enter all match predictions now, so your followers can see how you predict your team's path to victory.")}
              </p>
              <p className="bracket-edit-anytime-detail">
                {safeT(t, "bracket.hero.edit_anytime_detail", "Change them any time, right up to kick-off of each match, at which point that match's pick is locked-in. Tweak as form changes, as injuries land, and as each stage reshapes the bracket. We don't punish you for early incorrect picks like other bracket apps do!")}
              </p>
            </div>
          </aside>

          {/* Right column: auto-pick CTA stacked above a prominent
            * "X of Y matches picked" stat counter. Auto-pick lives here
            * rather than in its old standalone row so it sits visually
            * alongside the callout (Tim 2026-06-01-pm) instead of
            * dropping to its own row below. */}
          <div className="bracket-header-aside">
            <div
              className="bracket-autopick-row"
              data-testid="bracket-autopick-row"
              role="group"
              aria-label={safeT(t, "bracket.autopick_aria", "Auto-pick")}
            >
              <button
                type="button"
                className="bracket-autopick-cta"
                onClick={() => setShowAutoPickConfirm(true)}
                aria-label={safeT(t, "bracket.autopick.aria", "Auto-pick from live odds")}
                aria-describedby="bracket-autopick-subtitle"
                title={safeT(t, "bracket.autopick.title", "Auto-pick every match: Polymarket odds for groups, world ranking for knockouts")}
                disabled={autoPickDisabled}
              >
                <span className="bracket-autopick-cta-icon" aria-hidden="true">⚡</span>
                <span className="bracket-autopick-cta-label">{safeT(t, "bracket.autopick.label", "Auto-pick")}</span>
              </button>
              <p
                id="bracket-autopick-subtitle"
                className="bracket-autopick-subtitle"
              >
                {autoPickSubtitle}
              </p>
            </div>
            <p className="bracket-header-running-total" aria-live="polite">
              <span className="bracket-header-running-total-numbers">
                <strong>{totalCompleted}</strong>
                <span className="bracket-header-running-total-divider" aria-hidden="true">/</span>
                <strong>{totalPicks}</strong>
              </span>
              <span className="bracket-header-running-total-label">
                {safeT(t, "bracket.hero.progress_label", "matches picked")}
              </span>
            </p>
          </div>
        </div>
      </header>

      <nav
        className="bracket-tabs"
        data-testid="bracket-tabs"
        role="tablist"
        aria-label="Bracket rounds"
      >
        {TABS.map((tab_) => {
          const p = progressByTab[tab_.id];
          const isActive = tab === tab_.id;
          const labelKey =
            tab_.id === "groups" ? "stage.groups" :
            tab_.id === "r32"    ? "stage.r32" :
            tab_.id === "r16"    ? "stage.r16" :
            tab_.id === "qf"     ? "stage.qf" :
            tab_.id === "sf"     ? "stage.sf" :
            tab_.id === "final"  ? "stage.f" : "";
          const label = labelKey ? safeT(t, labelKey, tab_.label) : tab_.label;
          return (
            <button
              key={tab_.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`bracket-panel-${tab_.id}`}
              className={`bracket-tab ${isActive ? "is-active" : ""}`}
              onClick={() => setTab(tab_.id)}
            >
              <span className="bracket-tab-label">{label}</span>
              {p.total > 0 && (
                <span className="bracket-tab-count" aria-label={`${p.picked} of ${p.total} picked`}>
                  {p.picked}/{p.total}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Stage panels.
       *   - Desktop (>= 769px): only the active panel renders, preserving
       *     the editorial vertical-scroll experience. Inactive panels are
       *     not in the DOM at all so accessibility tree + tests see only
       *     the active one.
       *   - Mobile (<= 768px): all six panels render inside a horizontal
       *     scroll-snap carousel. Switching is via tab click (animated
       *     scroll) or native horizontal swipe; the scroll listener
       *     promotes the most-in-view panel to active. */}
      <div
        ref={carouselRef}
        className={`bracket-stages ${isMobile ? "bracket-stages-mobile" : ""}`}
        data-testid="bracket-stages"
      >
        {TAB_ORDER.map((panelId) => {
          const isActiveStage = panelId === tab;
          // Desktop: skip inactive panels entirely.
          if (!isMobile && !isActiveStage) return null;
          // On mobile we render every panel; refs attach only on the
          // active one so pinch/sticky-header gestures continue to target
          // the in-view panel.
          const attachKmRefs = !isMobile || isActiveStage;
          const attachGroupsRef = !isMobile || isActiveStage;
          if (panelId === "thirds") {
            return (
              <section
                key={panelId}
                id="bracket-panel-thirds"
                role="tabpanel"
                aria-label="Top 8 third-placed teams"
                className="bracket-panel bracket-thirds-section bracket-stage-panel"
              >
                <div className="bracket-round-header">
                  <h2>Top 8 3rd Place</h2>
                  <span className="bracket-round-progress">
                    <strong>{thirdsProgress.picked}</strong> of {thirdsProgress.total} picked
                  </span>
                </div>
                <ThirdsPicker
                  tournament={tournament}
                  bracket={bracket}
                  onChange={(next) => {
                    const updated = { ...bracket, bestThirds: next };
                    update(updated);
                    persistBestThirdsToServer(updated);
                  }}
                  onAutoPick={() => {
                    const picks = autoPickTop8Thirds(
                      tournament,
                      bracket.matchPredictions,
                      bracket.groupTiebreakers,
                    );
                    const updated = { ...bracket, bestThirds: picks };
                    update(updated);
                    persistBestThirdsToServer(updated);
                  }}
                  onClear={() => {
                    const updated = { ...bracket, bestThirds: [] };
                    update(updated);
                    persistBestThirdsToServer(updated);
                  }}
                />
                <NextStageButton currentTab="thirds" setTab={setTab} />
              </section>
            );
          }
          if (panelId === "groups") {
            return (
              <section
                key={panelId}
                id="bracket-panel-groups"
                role="tabpanel"
                aria-label={safeT(t, "bracket.group_stage.heading", "Group stage")}
                aria-labelledby={undefined}
                className="bracket-panel bracket-groups-section bracket-stage-panel"
              >
                <div className="bracket-round-header">
                  <h2>{safeT(t, "bracket.group_stage.heading", "Group stage")}</h2>
                  <span className="bracket-round-progress">
                    {(() => {
                      try {
                        const out = t("bracket.group_stage.progress", { picked: groupProgress.picked, total: groupProgress.total });
                        if (typeof out === "string" && out !== "bracket.group_stage.progress") return out;
                      } catch { /* fall through */ }
                      return `${groupProgress.picked} of ${groupProgress.total} matches picked`;
                    })()}
                  </span>
                </div>
                <div
                  className="bracket-groups-grid"
                  ref={attachGroupsRef ? groupsRootRef : null}
                >
                  {tournament.groups.map((g) => (
                    <GroupCard
                      key={g.id}
                      tournament={tournament}
                      group={g}
                      teams={teamMap}
                      matchPredictions={bracket.matchPredictions}
                      tiebreaker={bracket.groupTiebreakers[g.id]}
                      country={country}
                      oddsByMatch={oddsByMatch}
                      onChangeMatch={onChangeMatch}
                      onChangeTiebreaker={onChangeTiebreaker}
                      onAutoPickGroup={handleAutoPickGroup}
                      initialExpanded={g.id === initialOpenGroupId}
                    />
                  ))}
                </div>
                <NextStageButton currentTab="groups" setTab={setTab} />
              </section>
            );
          }
          if (panelId === "final") {
            return (
              <section
                key={panelId}
                id="bracket-panel-final"
                role="tabpanel"
                aria-label="Final and bracket summary"
                className="bracket-panel bracket-final-section bracket-stage-panel"
              >
                <div className="bracket-round-header">
                  <h2>Final</h2>
                  <span className="bracket-round-progress">
                    <strong>{finalProgress.picked}</strong> of {finalProgress.total} picked
                  </span>
                </div>
                <div className="bracket-final-layout">
                  <div
                    className="bracket-final-match km-pinch-wrap"
                    ref={attachKmRefs ? kmContainerRef : null}
                    data-mobile-pinch=""
                  >
                    <div
                      className="km-grid km-grid-final"
                      ref={attachKmRefs ? kmTargetRef : null}
                    >
                      {renderKnockoutGrid("final")}
                    </div>
                  </div>
                  <SaveBracketPanel
                    totalCompleted={totalCompleted}
                    totalPicks={totalPicks}
                    authStatus={auth.status}
                    authLoading={auth.loading}
                    bracketId={bracket.bracketId ?? null}
                    saveOk={lastSaveOk}
                    submitState={submitState}
                    onSave={handleSubmit}
                    onRequestSignup={() => {
                      setPendingSaveAfterAuth(true);
                      setShowSignupModal(true);
                    }}
                    championName={(() => {
                      const f = cascaded.knockouts.find((k) => k.stage === "f");
                      const code = f?.effective_winner ?? f?.predicted_winner ?? null;
                      if (!code) return null;
                      return (
                        tournament.teams.find((t) => t.id === code)?.name ?? code
                      );
                    })()}
                  />
                  <div className="bracket-final-sidecol">
                    <LockSummary
                      bracket={bracket}
                      cascaded={cascaded}
                      tournament={tournament}
                      deadline_utc={tournament.start_utc}
                    />
                    <div className="bracket-final-leaderboard">
                      <DraftPreviewBanner />
                      <Leaderboard
                        title="Global top 10"
                        members={mockTopN(null, 10)}
                        density="compact"
                        showCountryColumn={false}
                        showSparkline={false}
                        showMovementColumn
                        tabs={[]}
                        totalMembers={24388}
                      />
                    </div>
                  </div>
                </div>
                <div className="bracket-lock-counts">
                  <div>
                    <strong>{completedGroupMatches}</strong> / {totalGroupMatches} group matches
                  </div>
                  <div>
                    <strong>{completedKnockouts}</strong> / {totalKnockouts} knockout picks
                  </div>
                  <div>
                    <strong>{Object.keys(bracket.groupTiebreakers).length}</strong> tiebreakers set
                  </div>
                </div>
                <div className="bracket-actions">
                  <button
                    type="button"
                    onClick={() => saveDraft(tournament.id, bracket, userLocalId)}
                    className="bracket-btn bracket-btn-secondary"
                  >
                    Save draft locally
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="bracket-btn bracket-btn-primary"
                  >
                    Save bracket
                  </button>
                  {submitState && <span className="bracket-submit-state">{submitState}</span>}
                </div>
                <p className="bracket-final-note">
                  You can change any pick right up until that match kicks off. Saving
                  now lets you share your bracket. Scoring is one point per correct
                  pick (group win/lose/draw, knockout winner).
                </p>
              </section>
            );
          }
          // r32 / r16 / qf / sf knockout rounds.
          const meta = TABS.find((t) => t.id === panelId);
          return (
            <section
              key={panelId}
              id={`bracket-panel-${panelId}`}
              role="tabpanel"
              aria-label={meta?.aria ?? safeT(t, "bracket.subheading.knockouts", "Knockouts")}
              className={`bracket-panel bracket-round-section bracket-round-${panelId} bracket-stage-panel`}
            >
              <div className="bracket-round-header">
                <h2>{meta?.aria ?? safeT(t, "bracket.subheading.knockouts", "Knockouts")}</h2>
                <span className="bracket-round-progress">
                  <strong>{progressByTab[panelId].picked}</strong> of {progressByTab[panelId].total} picked
                </span>
              </div>
              <p className="bracket-round-help">
                Tap the team you predict will advance. Slots fill in as you finish
                the previous round.
              </p>
              <div
                className="km-pinch-wrap"
                ref={attachKmRefs ? kmContainerRef : null}
                data-mobile-pinch=""
              >
                <div
                  className="km-grid km-grid-single-round"
                  ref={attachKmRefs ? kmTargetRef : null}
                >
                  {renderKnockoutGrid(panelId)}
                </div>
              </div>
              <NextStageButton currentTab={panelId} setTab={setTab} />
            </section>
          );
        })}
      </div>

      {cascaded.warnings.length > 0 && (
        <details className="bracket-warnings">
          <summary>{cascaded.warnings.length} cascade warnings</summary>
          <ul>
            {cascaded.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                <code>{w.code}</code> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {showAutoPickConfirm && (
        <div
          className="bracket-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="autopick-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAutoPickConfirm(false);
          }}
        >
          <div className="bracket-modal">
            <h2 id="autopick-confirm-title" className="bracket-modal-title">
              ⚡ Auto-pick the favourite for every match?
            </h2>
            <p className="bracket-modal-body">
              Auto-pick uses live Polymarket odds for the group stage. The
              knockout rounds don&apos;t have Polymarket markets open yet
              (matchups aren&apos;t known until groups conclude), so those
              fall back to world ranking.
              {overwriteExistingPicks ? (
                <>
                  {" "}<strong>Your existing picks will be overwritten.</strong>
                </>
              ) : (
                <>
                  {" "}<strong>Your existing picks stay as they are</strong>; only
                  empty matches get filled.
                </>
              )}
            </p>
            <p className="bracket-modal-body">
              You can change any pick afterwards, auto-pick is a starting
              point, not a final answer. Picks save as you tweak them.
            </p>
            <label className="bracket-modal-checkbox">
              <input
                type="checkbox"
                checked={overwriteExistingPicks}
                onChange={(e) => setOverwriteExistingPicks(e.target.checked)}
                data-testid="autopick-overwrite-toggle"
              />
              <span>Overwrite existing picks</span>
            </label>
            <div className="bracket-modal-actions">
              <button
                type="button"
                className="bracket-btn bracket-btn-secondary"
                onClick={() => setShowAutoPickConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bracket-btn bracket-btn-primary"
                onClick={handleAutoPick}
                autoFocus
              >
                {overwriteExistingPicks
                  ? "Yes, auto-pick favourites"
                  : "Yes, fill empty matches"}
              </button>
            </div>
          </div>
        </div>
      )}

      <SignupModal
        open={showSignupModal}
        onClose={() => {
          setShowSignupModal(false);
          // If the user dismissed without authenticating, drop the
          // pending-save flag so we don't fire on a future unrelated
          // sign-in event from elsewhere in the app.
          if (auth.status !== "authenticated") setPendingSaveAfterAuth(false);
        }}
      />
    </div>
  );
}

/**
 * Bottom-of-stage CTA that advances the active tab to the next round in
 * the bracket flow. Per Tim 2026-05-21: after finishing all groups the
 * user should hit a clearly-labelled "Round of 32 →" button rather than
 * needing to find the tab strip again. Renders nothing once the final
 * panel is in view (Save bracket lives there).
 */
function NextStageButton({
  currentTab,
  setTab,
}: {
  currentTab: TabId;
  setTab: (id: TabId) => void;
}) {
  const next = NEXT_STAGE[currentTab];
  if (!next) return null;
  const meta = TABS.find((t) => t.id === next);
  // `aria` is the full human label ("Round of 32", "Quarter-finals" etc).
  const label = meta?.aria ?? meta?.label ?? "Next";
  return (
    <div className="bracket-next-stage-row">
      <button
        type="button"
        className="bracket-next-stage-btn"
        onClick={() => {
          setTab(next);
          if (typeof window === "undefined") return;
          // Mobile uses a horizontal scroll-snap carousel for the six
          // stage panels. setTab() handles the horizontal scroll. The
          // page's *vertical* scroll position carries over from the
          // previous stage, so without resetting it the user lands in
          // a blank gap below the shorter R16/R32/etc column (Tim
          // 2026-05-21).
          //
          // We scroll the page so the carousel's top lines up with the
          // bottom of the sticky chrome (appbar + tab strip). The
          // sticky tabs follow the scroll, so visually the user lands
          // on the first match of the new stage with the tab strip
          // pinned right above it.
          const stages = document.querySelector<HTMLElement>(
            ".bracket-stages",
          );
          if (!stages) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          const stickyOffset = 110; // appbar 56 + tab strip ~50 + 4
          const absoluteTop =
            stages.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({
            top: Math.max(0, absoluteTop - stickyOffset),
            behavior: "smooth",
          });
        }}
        aria-label={`Continue to ${label}`}
      >
        <span className="bracket-next-stage-label">Next: {label}</span>
        <span className="bracket-next-stage-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  );
}

const NEXT_STAGE: Readonly<Record<TabId, TabId | null>> = {
  groups: "thirds",
  thirds: "r32",
  r32: "r16",
  r16: "qf",
  qf: "sf",
  sf: "final",
  final: null,
};

/**
 * Saved-state body of the Save & Share panel. Lifted into its own
 * component so we can call hooks (useState/useEffect) for the avatar
 * probe without breaking the rules-of-hooks in the parent's
 * if-saved-then-return branch.
 *
 * Avatar logic (Tim 2026-05-29): probe `/avatars/<userId>.jpg`. If it
 * resolves, render the user's current photo + a "Change photo" button.
 * Otherwise fall back to the existing "Upload a profile photo" empty
 * state. Probe is cheap (one img request, cached after first load).
 */
function BracketSavePanelSaved({
  t,
  userId,
  shareUrl,
  onShare,
}: {
  t: ReturnType<typeof useTranslations>;
  userId: string | null;
  shareUrl: string | null;
  onShare: () => Promise<void>;
}) {
  const [avatarStatus, setAvatarStatus] = useState<
    "unknown" | "exists" | "missing"
  >("unknown");
  const avatarSrc = userId
    ? `/avatars/${encodeURIComponent(userId)}.jpg`
    : null;

  useEffect(() => {
    if (!avatarSrc) {
      setAvatarStatus("missing");
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setAvatarStatus("exists");
    };
    img.onerror = () => {
      if (!cancelled) setAvatarStatus("missing");
    };
    // Cache-bust so the probe sees the actual current state after an
    // upload-then-back navigation in the same tab.
    img.src = `${avatarSrc}?_probe=${Date.now()}`;
    return () => {
      cancelled = true;
    };
  }, [avatarSrc]);

  const hasAvatar = avatarStatus === "exists";

  return (
    <div className="bracket-save-panel" data-state="saved">
      <div className="bracket-save-panel-headline">
        <span className="bracket-save-panel-tick" aria-hidden="true">✓</span>
        <span>{safeT(t, "bracket.save.saved", "Bracket saved. You can edit any pick before kickoff.")}</span>
      </div>
      <div className="bracket-save-panel-actions">
        <button
          type="button"
          className="bracket-save-panel-cta-primary"
          onClick={() => void onShare()}
          disabled={!shareUrl}
        >
          <span aria-hidden="true">↗</span>
          <span>{safeT(t, "bracket.save.share_cta", "Share my bracket")}</span>
        </button>
        {hasAvatar && avatarSrc ? (
          <a
            className="bracket-save-panel-cta-secondary bracket-save-panel-cta-avatar"
            href="/profile"
            aria-label="Change profile photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="bracket-save-panel-avatar-thumb"
              src={avatarSrc}
              alt=""
              width={28}
              height={28}
            />
            <span>{safeT(t, "bracket.save.change_photo", "Change photo")}</span>
          </a>
        ) : (
          <a
            className="bracket-save-panel-cta-secondary"
            href="/profile"
          >
            <span aria-hidden="true">📷</span>
            <span>{safeT(t, "bracket.save.upload_photo", "Upload a profile photo")}</span>
          </a>
        )}
      </div>
      {!hasAvatar ? (
        <p className="bracket-save-panel-foot">
          {safeT(t, "bracket.save.saved_foot", "Add a profile photo so your friends can spot you on the leaderboard.")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Prominent state-aware Save & Share panel that sits directly under the
 * final match card. Tim 2026-05-21 — the existing Save bracket button
 * was buried below LockSummary + leaderboard; viral-loop conversion
 * needs the save → sign-in → share path to read as one unmistakable
 * flow the moment the user finishes their 104th pick.
 *
 * State machine:
 *   - incomplete         → "X more picks to lock in" (non-CTA hint)
 *   - complete + anon    → gold "Save my bracket" + auth pitch; click
 *                          opens the SignupModal and chains the save
 *                          via the pendingSaveAfterAuth effect.
 *   - complete + authed
 *     - not yet saved    → gold "Save my bracket"
 *     - saved            → "Bracket saved ✓" + native-share CTA +
 *                          link to profile photo upload
 */
function SaveBracketPanel({
  totalCompleted,
  totalPicks,
  authStatus,
  authLoading,
  bracketId,
  saveOk,
  submitState,
  onSave,
  onRequestSignup,
  championName,
}: {
  totalCompleted: number;
  totalPicks: number;
  authStatus: string;
  authLoading: boolean;
  bracketId: string | null;
  saveOk: boolean;
  submitState: string;
  onSave: () => void;
  onRequestSignup: () => void;
  /** Actual predicted champion country (e.g. "Argentina"). Null when
   *  the cascade hasn't resolved a winner yet. Plumbed so the share
   *  text reads with the real pick instead of the literal "Your
   *  champion" placeholder (Tim 2026-05-24). */
  championName: string | null;
}) {
  const t = useTranslations();
  const complete = totalCompleted >= totalPicks;
  const remaining = Math.max(0, totalPicks - totalCompleted);
  const isAuthed = !authLoading && authStatus === "authenticated";
  const saved = saveOk && !!bracketId;

  // Share URL: prefer the persisted server-side share guid (set on
  // save), fall back to the synthetic guid from bracketId.
  const [shareGuid, setShareGuid] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!saved) return;
    // tournament.id is captured by the BracketBuilder closure — we use
    // the well-known WC2026 key here because this panel only mounts on
    // /world-cup-2026. Future tournaments will plumb this as a prop.
    setShareGuid(loadStoredShareGuid("wc2026", "ssr_user"));
  }, [saved]);
  // Friendly handle for signed-in users so the share URL renders as
  // `/s/0800tim` instead of `/s/<random-guid>`. Falls through to the
  // server share guid when handle is null or contested (Tim 2026-05-24).
  const panelAuth = useUser();
  const authHandle = slugifyDisplayName(panelAuth.profile?.display_name ?? null);
  const guid = resolveShareGuid({
    serverShareGuid: shareGuid,
    authUserId: null,
    authHandle,
    bracketId,
  });
  const shareUrl = guid ? shareUrlFor(guid) : null;

  const onShare = async (): Promise<void> => {
    if (!shareUrl) return;
    await shareContent({
      title: buildShareTitle(),
      // Body only, no URL inline. shareContent passes `url` separately
      // and the host OS attaches it; embedding it in the text too causes
      // WhatsApp / iMessage to render the URL twice (Tim 2026-05-24).
      text: buildShareTextBody({
        champion: championName ?? null,
        guid,
        isComplete: true,
      }),
      url: shareUrl,
    });
  };

  if (!complete) {
    let remainingText: string;
    try {
      remainingText = t("bracket.save.remaining", { count: remaining });
    } catch {
      remainingText = `${remaining} ${remaining === 1 ? "more pick" : "more picks"} to lock in your bracket and share.`;
    }
    return (
      <div className="bracket-save-panel" data-state="incomplete">
        <p className="bracket-save-panel-hint">{remainingText}</p>
      </div>
    );
  }

  if (saved) {
    // Avatar probe: HEAD the user's avatar URL to decide whether to
    // render the current photo + "Change photo" button, or the empty-
    // state "Upload a profile photo" CTA. We use a hidden Image probe
    // (cheaper than fetch + works on stale-while-revalidate). Tim
    // 2026-05-29: if the user already uploaded a photo, show it here
    // and just offer a Change button instead of pretending they haven't.
    const userId = panelAuth.user?.id ?? null;
    return (
      <BracketSavePanelSaved
        t={t}
        userId={userId}
        shareUrl={shareUrl}
        onShare={onShare}
      />
    );
  }

  // complete + not yet saved
  return (
    <div className="bracket-save-panel" data-state="ready">
      <div className="bracket-save-panel-headline">
        <span className="bracket-save-panel-tick" aria-hidden="true">🏆</span>
        <span>{safeT(t, "bracket.save.complete_headline", "All 104 picks made. Lock in your bracket.")}</span>
      </div>
      <button
        type="button"
        className="bracket-save-panel-cta-primary"
        onClick={() => {
          if (isAuthed) {
            onSave();
          } else {
            onRequestSignup();
          }
        }}
      >
        <span>{safeT(t, "bracket.save.cta", "Save my bracket")}</span>
        <span aria-hidden="true">→</span>
      </button>
      <p className="bracket-save-panel-foot">
        {isAuthed
          ? safeT(t, "bracket.save.foot_authed", "Saves your bracket to your profile so it follows you across devices.")
          : safeT(t, "bracket.save.foot_anon", "We'll send a one-time sign-in code (Telegram, WhatsApp, or email). Your picks here will merge into your profile automatically.")}
      </p>
      {submitState ? (
        <p className="bracket-save-panel-status">{submitState}</p>
      ) : null}
    </div>
  );
}
