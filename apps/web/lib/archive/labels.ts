/**
 * Accessible names for the archive home's knockout list.
 *
 * The visible row is "flag Spain 1-0 aet Match": the link text alone
 * ("Match") repeats thirty-odd times on the page, so screen-reader link
 * lists cannot tell them apart. The link gets a full name instead.
 */

export interface KnockoutRowLike {
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly method: string | null;
}

/** "1-0 aet", "6-4 pens" or "won" when scores are unknown. */
export function knockoutScoreText(k: KnockoutRowLike): string {
  const score =
    k.homeScore !== null && k.awayScore !== null
      ? `${Math.max(k.homeScore, k.awayScore)}-${Math.min(k.homeScore, k.awayScore)}`
      : "won";
  const suffix = k.method === "et" ? " aet" : k.method === "pens" ? " pens" : "";
  return `${score}${suffix}`;
}

/** Link name: "Match details: Round of 16, Spain won 1-0 aet". */
export function knockoutLinkLabel(stageLabel: string, winnerName: string, k: KnockoutRowLike): string {
  const score = knockoutScoreText(k);
  const outcome = score === "won" ? `${winnerName} won` : `${winnerName} won ${score}`;
  return `Match details: ${stageLabel}, ${outcome}`;
}
