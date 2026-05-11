import type {
  EventMessage,
  MatchInit,
  Message,
  Player,
  StateFrame,
  Team,
} from "@tournamental/spec";
import { SPEC_VERSION } from "@tournamental/spec";
import type { StreamSource } from "./store";

/**
 * In-process synthetic stream source for the AR-FR 2022 final.
 *
 * This exists so the renderer demo route boots without depending on the
 * statsbomb-replay or mock-producer agents. It emits a believable spec
 * stream at 10 Hz, time-scaled so the full ~150 minutes of regulation +
 * extra time + penalty shootout finishes in around 90 seconds of wall
 * clock by default.
 *
 * It is NOT a substitute for the real producer — kickoff times and event
 * locations are stylised, not statistically accurate. Acceptance is the
 * final score line: 3–3 (regulation+ET) and 4–2 (pens).
 */

const ARG_PLAYERS: Player[] = [
  { id: "ARG_1", name: "E. Martínez", number: 23, position: "GK" },
  { id: "ARG_2", name: "Molina", number: 26, position: "RB" },
  { id: "ARG_3", name: "Romero", number: 13, position: "CB" },
  { id: "ARG_4", name: "Otamendi", number: 19, position: "CB" },
  { id: "ARG_5", name: "Tagliafico", number: 3, position: "LB" },
  { id: "ARG_6", name: "De Paul", number: 7, position: "CM" },
  { id: "ARG_7", name: "Fernández", number: 24, position: "CM" },
  { id: "ARG_8", name: "Mac Allister", number: 20, position: "CM" },
  { id: "ARG_9", name: "Di María", number: 11, position: "RW" },
  { id: "ARG_10", name: "Messi", number: 10, position: "ST" },
  { id: "ARG_11", name: "Álvarez", number: 9, position: "ST" },
];

const FRA_PLAYERS: Player[] = [
  { id: "FRA_1", name: "Lloris", number: 1, position: "GK" },
  { id: "FRA_2", name: "Koundé", number: 5, position: "RB" },
  { id: "FRA_3", name: "Varane", number: 4, position: "CB" },
  { id: "FRA_4", name: "Upamecano", number: 17, position: "CB" },
  { id: "FRA_5", name: "T. Hernández", number: 22, position: "LB" },
  { id: "FRA_6", name: "Tchouaméni", number: 8, position: "CM" },
  { id: "FRA_7", name: "Rabiot", number: 14, position: "CM" },
  { id: "FRA_8", name: "Griezmann", number: 7, position: "AM" },
  { id: "FRA_9", name: "Dembélé", number: 11, position: "RW" },
  { id: "FRA_10", name: "Mbappé", number: 10, position: "ST" },
  { id: "FRA_11", name: "Giroud", number: 9, position: "ST" },
];

const ARG: Team = {
  id: "ARG",
  name: "Argentina",
  short_name: "ARG",
  kit: { primary: "#75AADB", secondary: "#FFFFFF", text: "#000033" },
  players: ARG_PLAYERS,
};

const FRA: Team = {
  id: "FRA",
  name: "France",
  short_name: "FRA",
  kit: { primary: "#0055A4", secondary: "#FFFFFF", text: "#FFFFFF" },
  players: FRA_PLAYERS,
};

/** Standard FIFA pitch (100 × 64 m). */
const FIELD = { length: 100, width: 64, units: "m" as const };

/**
 * Each goal entry produces an event.goal + event.score_change at minute t.
 * Times are minutes from kickoff (regulation/ET).
 */
const GOALS: Array<{ minute: number; team: "ARG" | "FRA"; scorer: string; commentary: string }> = [
  { minute: 23, team: "ARG", scorer: "ARG_10", commentary: "GOAL — Messi from the spot, 1-0 Argentina." },
  { minute: 36, team: "ARG", scorer: "ARG_9", commentary: "GOAL — Di María, 2-0 Argentina." },
  { minute: 80, team: "FRA", scorer: "FRA_10", commentary: "GOAL — Mbappé from the spot, 2-1." },
  { minute: 81, team: "FRA", scorer: "FRA_10", commentary: "GOAL — Mbappé volleys it in, 2-2." },
  { minute: 108, team: "ARG", scorer: "ARG_10", commentary: "GOAL — Messi pokes it home, 3-2 Argentina." },
  { minute: 118, team: "FRA", scorer: "FRA_10", commentary: "GOAL — Mbappé hat-trick from the spot, 3-3." },
];

/**
 * Penalty shootout sequence — Argentina won 4-2.
 * Order in the final: FRA Mbappé scored, ARG Messi scored, FRA Coman saved, ARG Dybala scored,
 * FRA Tchouaméni missed, ARG Paredes scored, FRA Kolo Muani scored, ARG Montiel scored.
 */
const PENALTIES: Array<{ team: "ARG" | "FRA"; player: string; outcome: "scored" | "missed" | "saved"; commentary: string }> = [
  { team: "FRA", player: "FRA_10", outcome: "scored", commentary: "Mbappé scores. 0-1." },
  { team: "ARG", player: "ARG_10", outcome: "scored", commentary: "Messi scores. 1-1." },
  { team: "FRA", player: "FRA_9", outcome: "saved", commentary: "Coman saved by E. Martínez." },
  { team: "ARG", player: "ARG_8", outcome: "scored", commentary: "Dybala scores. 2-1." },
  { team: "FRA", player: "FRA_6", outcome: "missed", commentary: "Tchouaméni misses." },
  { team: "ARG", player: "ARG_7", outcome: "scored", commentary: "Paredes scores. 3-1." },
  { team: "FRA", player: "FRA_11", outcome: "scored", commentary: "Kolo Muani scores. 3-2." },
  { team: "ARG", player: "ARG_2", outcome: "scored", commentary: "Montiel scores. 4-2 — Argentina are world champions." },
];

/** Produce the full canonical message list, in time order, for the AR-FR final. */
export function buildArFrMessages(): Message[] {
  const init: MatchInit = {
    type: "match.init",
    spec_version: SPEC_VERSION,
    match_id: "fifa-wc-2022-final-arg-fra-2022-12-18",
    sport: "soccer",
    field: FIELD,
    teams: [ARG, FRA],
    start_time: "2022-12-18T15:00:00Z",
    venue: "Lusail Stadium",
    competition: "FIFA World Cup 2022 — Final",
    producer: "synthetic-arfr-v0.1",
  };

  const messages: Message[] = [init];

  // Build state frames at 10 Hz across regulation + ET (130 min) and shootout.
  // We compress to event-time ms (since match.init) using a fast scale so the
  // full match plays in ~90 seconds of wall clock at the driver's default
  // tick rate. The driver applies its own pacing.
  const FRAME_HZ = 10;
  const FRAME_MS = 1000 / FRAME_HZ;
  const REGULATION_MIN = 90;
  const ET_MIN = 30;

  // We don't need every frame to be unique-positioned — moving players a bit
  // is enough to exercise the renderer's lerp + animation FSM. Use a smooth
  // sinusoid per player so legs/yaw change frame-over-frame.
  const allPlayers: Array<{ p: Player; baseX: number; baseY: number }> = [];
  ARG.players.forEach((p, i) => {
    allPlayers.push({ p, baseX: -10 - (i % 4) * 10, baseY: -22 + (i % 5) * 11 });
  });
  FRA.players.forEach((p, i) => {
    allPlayers.push({ p, baseX: 10 + (i % 4) * 10, baseY: -22 + (i % 5) * 11 });
  });

  // Period markers and goals.
  messages.push({ type: "event.kickoff", t: 0, team: "ARG" });
  messages.push({ type: "event.period_start", t: 0, period: 1 });
  messages.push({
    type: "event.commentary",
    t: 0,
    text: "Kickoff — Argentina vs France, World Cup Final.",
    speaker: "PA",
  });

  // Frame stream: emit frames at 10 Hz across the match, but dedupe — we
  // emit one frame per second worth of motion to keep the message list
  // reasonable (~7800 frames otherwise). The renderer happily lerps at
  // any input rate; 1 Hz gives clear lerp visibility.
  const totalSeconds = (REGULATION_MIN + ET_MIN) * 60;
  for (let s = 0; s <= totalSeconds; s += 1) {
    const t = s * 1000;
    messages.push(buildStateFrame(t, allPlayers, s));
  }

  // Insert goals + score changes at their minute marks.
  let argScore = 0;
  let fraScore = 0;
  for (const g of GOALS) {
    const t = g.minute * 60 * 1000;
    messages.push({ type: "event.shot", t: t - 200, player: g.scorer, target: [g.team === "ARG" ? 50 : -50, 0, 1.5], on_target: true });
    messages.push({ type: "event.goal", t, player: g.scorer, team: g.team });
    if (g.team === "ARG") argScore += 1;
    else fraScore += 1;
    messages.push({ type: "event.score_change", t: t + 1, home: argScore, away: fraScore });
    messages.push({ type: "event.commentary", t: t + 2, text: g.commentary, speaker: "Commentator" });
  }

  // End of regulation + ET.
  messages.push({ type: "event.period_end", t: REGULATION_MIN * 60 * 1000, period: 2 });
  messages.push({ type: "event.period_start", t: REGULATION_MIN * 60 * 1000 + 1, period: 3 });
  messages.push({ type: "event.period_end", t: (REGULATION_MIN + ET_MIN) * 60 * 1000, period: 4 });

  // Penalty shootout.
  const shootoutStartT = (REGULATION_MIN + ET_MIN) * 60 * 1000 + 60_000; // 1-min break.
  messages.push({ type: "event.penalty_shootout_start", t: shootoutStartT });
  messages.push({
    type: "event.commentary",
    t: shootoutStartT,
    text: "Penalty shootout. Argentina vs France.",
    speaker: "PA",
  });

  let homeShootout = 0;
  let awayShootout = 0;
  PENALTIES.forEach((pk, idx) => {
    const t = shootoutStartT + (idx + 1) * 30_000;
    messages.push({
      type: "event.penalty_attempt",
      t,
      player: pk.player,
      team: pk.team,
      outcome: pk.outcome,
      target: [pk.team === "ARG" ? 50 : -50, 0, 1.2],
    });
    if (pk.outcome === "scored") {
      if (pk.team === "ARG") homeShootout += 1;
      else awayShootout += 1;
    }
    messages.push({ type: "event.commentary", t: t + 1, text: pk.commentary, speaker: "Commentator" });
  });

  const shootoutEndT = shootoutStartT + (PENALTIES.length + 1) * 30_000;
  messages.push({
    type: "event.penalty_shootout_end",
    t: shootoutEndT,
    winner: "ARG",
    score: { home: homeShootout, away: awayShootout },
  });
  messages.push({
    type: "event.match_end",
    t: shootoutEndT + 100,
  });
  messages.push({
    type: "event.commentary",
    t: shootoutEndT + 200,
    text: "Argentina win the World Cup, 4-2 on penalties after 3-3 in extra time.",
    speaker: "Commentator",
  });

  return messages;
}

function buildStateFrame(
  t: number,
  layout: Array<{ p: Player; baseX: number; baseY: number }>,
  step: number,
): StateFrame {
  const players = layout.map(({ p, baseX, baseY }, i) => {
    const phase = (step / 8) + i;
    const x = baseX + Math.sin(phase) * 2.0;
    const y = baseY + Math.cos(phase * 0.8) * 1.5;
    const speed = Math.abs(Math.cos(phase * 0.5)) * 4.5;
    return {
      id: p.id,
      pos: [x, y] as [number, number],
      facing: Math.atan2(Math.cos(phase * 0.8) * 1.5, Math.sin(phase) * 2.0),
      anim: ((): "idle" | "walk" | "run" | "sprint" => {
        if (speed < 0.5) return "idle";
        if (speed < 2.5) return "walk";
        if (speed < 5) return "run";
        return "sprint";
      })(),
    };
  });

  const ballPhase = step / 6;
  return {
    type: "state",
    t,
    ball: {
      pos: [Math.sin(ballPhase) * 25, Math.cos(ballPhase * 1.3) * 18, 0.2 + Math.abs(Math.sin(ballPhase * 2)) * 3],
      vel: [Math.cos(ballPhase) * 5, -Math.sin(ballPhase * 1.3) * 4, 0],
    },
    players,
    period: t < 45 * 60 * 1000 ? 1 : t < 90 * 60 * 1000 ? 2 : t < 105 * 60 * 1000 ? 3 : 4,
    clock_display: clockOf(t),
  };
}

function clockOf(t: number): string {
  const totalSec = Math.floor(t / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Stream source that walks the canonical AR-FR message list at a configurable
 * rate. Default rate plays the full ~150-min sequence in ~90 seconds — fast
 * enough to demo, slow enough to read the score line on each goal.
 */
export function syntheticArFrSource(opts: { tickMs?: number } = {}): StreamSource {
  const tickMs = opts.tickMs ?? 50;
  const messages = buildArFrMessages();
  let timer: ReturnType<typeof setInterval> | null = null;
  let idx = 0;

  return {
    start(onMessage, onStatus) {
      onStatus("synthetic");
      // Emit init + first event synchronously so the HUD and scene can render
      // before the first tick fires.
      const drainInitial = () => {
        while (idx < messages.length) {
          const m = messages[idx];
          if (m.type === "match.init" || m.type === "event.kickoff" || m.type === "event.period_start") {
            onMessage(m);
            idx += 1;
            continue;
          }
          break;
        }
      };
      drainInitial();

      const messagesPerTick = Math.max(1, Math.floor(messages.length / Math.max(1, 90_000 / tickMs)));
      timer = setInterval(() => {
        if (idx >= messages.length) {
          if (timer) clearInterval(timer);
          timer = null;
          return;
        }
        for (let i = 0; i < messagesPerTick && idx < messages.length; i += 1) {
          onMessage(messages[idx]);
          idx += 1;
        }
      }, tickMs);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

// Re-export the canonical message list so tests / debug tooling can inspect
// the synthetic match without running the timer.
export { ARG, FRA, GOALS, PENALTIES };
export type { Player as SyntheticPlayer } from "@tournamental/spec";
