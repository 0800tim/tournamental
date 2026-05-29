/**
 * Public-directory DTO + mapper. The public pool directory (`/pools`) and
 * its API (`GET /api/v1/syndicates/public`) both render the same shape, so
 * the mapping lives here once. It deliberately exposes ONLY public-safe
 * fields — never owner_email / owner_phone / hl_* / sponsor internals.
 */

import { parseAllowedCountries } from "./country-gate";
import type { SyndicateRow } from "./persistence";

export interface PublicPoolDto {
  slug: string;
  name: string;
  tournament_id: string;
  /** Owner's free-form description (shown as the card blurb). */
  topic: string | null;
  /** Prize copy, when set. */
  prize_text: string | null;
  member_count: number;
  /** Branding logo URL, or null (the card falls back to a monogram). */
  logo_url: string | null;
  tier: string;
  /** True when the pool awards a prize (prize copy / bonus / split). */
  has_prize: boolean;
  /** True when there's no entry fee. */
  is_free: boolean;
  /** Relative landing/share URL. */
  share_url: string;
  /** Country allow-list as bare E.164 dial codes (["64","61"] etc.).
   * Empty array means the pool accepts joiners from any country.
   * The directory card renders a flag badge from this. */
  allowed_phone_countries: string[];
}

export function toPublicPoolDto(row: SyndicateRow): PublicPoolDto {
  const hasPrize = Boolean(
    row.prize_text?.trim() ||
      row.bonus_prize_text?.trim() ||
      (row.prize_split_json && row.prize_split_json.trim() && row.prize_split_json.trim() !== "[]"),
  );
  return {
    slug: row.slug,
    name: row.name,
    tournament_id: row.tournament_id,
    topic: row.topic,
    prize_text: row.prize_text,
    member_count: row.member_count,
    logo_url: row.branding_logo_url,
    tier: row.tier,
    has_prize: hasPrize,
    is_free: !row.entry_fee_cents || row.entry_fee_cents <= 0,
    share_url: `/s/${row.slug}`,
    allowed_phone_countries: parseAllowedCountries(row.allowed_phone_countries),
  };
}

/** Friendly label for a tournament id (extend as more tournaments land). */
export function tournamentLabel(id: string): string {
  if (id === "fifa-wc-2026") return "FIFA World Cup 2026";
  return id;
}
