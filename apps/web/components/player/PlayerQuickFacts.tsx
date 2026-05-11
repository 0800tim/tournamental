/**
 * <PlayerQuickFacts />, small grid of stat-card facts under the hero.
 *
 * Drops any fact whose source value is missing (Wikidata is patchy, and
 * we'd rather show three solid facts than five with three "-" rows).
 */

import { ageOnDate, type PlayerRecord } from "@/lib/players";

export interface PlayerQuickFactsProps {
  readonly player: PlayerRecord;
  /** Override "today" for deterministic snapshot tests. ISO date. */
  readonly nowIso?: string;
}

interface Fact {
  readonly label: string;
  readonly value: string;
}

export function PlayerQuickFacts({ player, nowIso }: PlayerQuickFactsProps) {
  const facts: Fact[] = [];
  const now = nowIso ?? new Date().toISOString();
  const age = ageOnDate(player.dob, now);
  if (age !== null) facts.push({ label: "Age", value: `${age}` });
  if (player.dob) facts.push({ label: "Born", value: player.dob });
  if (player.club) facts.push({ label: "Club", value: player.club });
  if (player.code) facts.push({ label: "Country", value: player.code });
  if (typeof player.shirtNumber === "number") {
    facts.push({ label: "Shirt", value: `#${player.shirtNumber}` });
  }
  if (facts.length === 0) return null;
  return (
    <ul
      className="player-quick-facts"
      aria-label={`Quick facts about ${player.name}`}
      data-testid="player-quick-facts"
    >
      {facts.map((f) => (
        <li key={f.label} className="player-quick-fact">
          <div className="player-quick-fact-label">{f.label}</div>
          <div className="player-quick-fact-value">{f.value}</div>
        </li>
      ))}
    </ul>
  );
}
