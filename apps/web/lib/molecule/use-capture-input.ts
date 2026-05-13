/**
 * `useMoleculeCaptureInput` — derive the prediction-card overlay shape
 * (champion / runner-up / third-place / path-to-gold / share guid) from
 * the same client-side state the molecule scene reads.
 *
 * Lives outside `MoleculeScene` so the capture flow doesn't have to
 * thread props through (or grab a ref into) the R3F component. The hook
 * is SSR-safe: every browser-only read is guarded so the first paint is
 * always "no bracket yet" and the cascade hydrates on mount.
 *
 * Cache-wise: this is a per-render local memo. We do NOT round-trip to
 * the network; the bracket lives in localStorage and the cascade runs in
 * a pure function from `@tournamental/bracket-engine`. The molecule scene
 * already pays the same cost on every render, so duplicating it here
 * costs a single extra pass per molecule-page load — well within budget.
 */

import { useEffect, useMemo, useState } from "react";

import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type Tournament,
} from "@tournamental/bracket-engine";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { localUserId, loadDraft } from "@/lib/bracket/storage";
import { derivePathToGold } from "@/lib/molecule/path";
import { loadStoredShareGuid } from "@/lib/share/share-guid-storage";
import { resolveShareGuid } from "@/lib/share/share-text";

import type {
  CaptureChampion,
  CaptureInput,
  CapturePathEntry,
} from "./capture";

export interface UseMoleculeCaptureInputArgs {
  readonly tournament: Tournament;
  /** Optional authenticated user id (from useUser, once PR #138 lands). */
  readonly authUserId?: string | null;
  /** Display handle to render on the share card. */
  readonly handle?: string | null;
}

export interface MoleculeCaptureInputResult {
  /** Falsy until the bracket is hydrated from localStorage. */
  readonly ready: boolean;
  /** Resolved share guid for the user's bracket — drives `/s/<guid>` + QR. */
  readonly shareGuid: string;
  /** Display handle, surfaced as "@handle" on the card. */
  readonly handle: string | null;
  /** Overlay payload for `captureAndCompose`. */
  readonly captureInput: Omit<CaptureInput, "shareGuid" | "handle">;
  /** True when the user has any champion the card can lean on. */
  readonly hasChampion: boolean;
}

function teamMeta(tournament: Tournament, code: string | null | undefined): {
  name: string;
  kitPrimary: string | null;
} | null {
  if (!code) return null;
  const t = tournament.teams.find((x) => x.id === code);
  if (!t) return null;
  return {
    name: t.name,
    kitPrimary: t.kit?.primary ?? null,
  };
}

function buildChampion(
  tournament: Tournament,
  code: string | null | undefined,
): CaptureChampion | null {
  const meta = teamMeta(tournament, code);
  if (!meta || !code) return null;
  return {
    code,
    name: meta.name,
    kit: meta.kitPrimary ? { primary: meta.kitPrimary } : null,
  };
}

export function useMoleculeCaptureInput(
  args: UseMoleculeCaptureInputArgs,
): MoleculeCaptureInputResult {
  const { tournament, authUserId, handle } = args;
  const [userIdLocal, setUserIdLocal] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [storedGuid, setStoredGuid] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = localUserId();
    setUserIdLocal(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
    const guid = loadStoredShareGuid(tournament.id, id);
    if (guid) setStoredGuid(guid);
    setHydrated(true);
  }, [tournament.id]);

  // Run a single-pass cascade — same shape MoleculeScene does, minus
  // the iterative re-pass loop. The capture only needs the *final*
  // champion + path; if the user's bracket happens to leave knockouts
  // unresolved the cascade returns nulls and the overlay degrades
  // gracefully (no podium row, no path strip).
  const cascaded = useMemo<CascadedBracket | null>(() => {
    if (!bracket) return null;
    const legacy = bracketToCascadeInput(tournament, bracket, userIdLocal);
    let result = cascade(tournament, legacy);
    for (let pass = 0; pass < 6; pass += 1) {
      const overlays = Object.values(bracket.knockoutPredictions)
        .map((p) => {
          const k = result.knockouts.find((x) => x.id === p.matchId);
          if (!k) return null;
          const team = p.outcome === "home_win" ? k.home.team : k.away.team;
          return team ? { match_id: p.matchId, winner: team } : null;
        })
        .filter((x): x is { match_id: string; winner: string } => x !== null);
      const before = result.knockouts.filter((k) => k.effective_winner).length;
      result = cascade(tournament, { ...legacy, knockouts: overlays });
      const after = result.knockouts.filter((k) => k.effective_winner).length;
      if (after === before) break;
    }
    return result;
  }, [bracket, tournament, userIdLocal]);

  const captureInput = useMemo<Omit<CaptureInput, "shareGuid" | "handle">>(() => {
    if (!cascaded) {
      return {
        size: "landscape",
        tournamentName: "World Cup 2026",
        champion: null,
        runnerUp: null,
        thirdPlace: null,
        knockoutPath: [],
      };
    }
    const final = cascaded.knockouts.find((k) => k.stage === "f");
    const tp = cascaded.knockouts.find((k) => k.stage === "tp");

    const championCode = final?.effective_winner ?? final?.predicted_winner ?? null;
    const runnerUpCode =
      final && final.effective_winner
        ? final.home.team === final.effective_winner
          ? final.away.team
          : final.home.team
        : null;
    const thirdPlaceCode = tp?.effective_winner ?? null;

    const champion = buildChampion(tournament, championCode);
    const runnerUp = buildChampion(tournament, runnerUpCode);
    const thirdPlace = buildChampion(tournament, thirdPlaceCode);

    // Path-to-gold for the predicted champion.
    const path = derivePathToGold(cascaded, championCode);
    const knockoutPath: CapturePathEntry[] = [];
    for (const b of path.bonds) {
      // Map the cascade's stage labels onto the share-card stage set.
      // The cascade uses `r32 | r16 | qf | sf | tp | f`; we map `f`→`final`
      // and skip anything that doesn't have a card slot.
      const stage =
        b.stage === "f"
          ? "final"
          : b.stage === "r32"
            ? null // share card pyramid doesn't reserve an r32 row
            : (b.stage as "r16" | "qf" | "sf" | "tp");
      if (!stage) continue;
      // Opponent code = whichever of (a, b) isn't the champion. The
      // share card surfaces the OPPONENT each round, that's the
      // storytelling beat.
      const oppCode = b.a === championCode ? b.b : b.a;
      const meta = teamMeta(tournament, oppCode);
      knockoutPath.push({
        stage,
        teamCode: oppCode,
        teamName: meta?.name ?? oppCode,
      });
    }

    return {
      size: "landscape",
      tournamentName: "World Cup 2026",
      champion,
      runnerUp,
      thirdPlace,
      knockoutPath,
    };
  }, [cascaded, tournament]);

  const shareGuid = useMemo(
    () =>
      resolveShareGuid({
        serverShareGuid: storedGuid,
        authUserId: authUserId ?? null,
        bracketId: bracket?.bracketId ?? userIdLocal,
      }),
    [storedGuid, authUserId, bracket?.bracketId, userIdLocal],
  );

  return {
    ready: hydrated,
    shareGuid,
    handle: handle ?? null,
    captureInput,
    hasChampion: !!captureInput.champion?.code,
  };
}
