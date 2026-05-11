/**
 * Shared TypeScript shapes for the auth + identity surface.
 *
 * These types mirror the Supabase Postgres schema (see
 * supabase/migrations/0001_user_identity.sql). They are deliberately
 * loose (`string | null` everywhere optional) so that defensive reads
 * from a partially-populated row don't crash.
 */

export type AgeBucket =
  | "<18"
  | "18-24"
  | "25-34"
  | "35-44"
  | "45-54"
  | "55-64"
  | "65+";

export type Gender = "male" | "female" | "non-binary" | "prefer-not-to-say";

export type EngagementBand = "cold" | "warm" | "hot";

export type WatchesVia =
  | "streaming"
  | "free-to-air"
  | "stadium"
  | "highlights"
  | "mixed";

export type FriendSource =
  | "telegram"
  | "whatsapp_invite"
  | "phone_match"
  | "manual";

export type InviteSource =
  | "share_card"
  | "manual"
  | "telegram_bot"
  | "whatsapp_share";

export interface UserProfile {
  id: string;
  handle: string;
  display_name: string | null;
  created_at: string;
  last_seen_at: string;

  age_bucket: AgeBucket | null;
  gender: Gender | null;

  country_code: string | null;
  city: string | null;
  timezone: string | null;

  favourite_team_code: string | null;
  follows_leagues: string[] | null;
  watches_via: WatchesVia | null;

  visit_count: number;
  last_visit_date: string | null;
  engagement_band: EngagementBand;

  telegram_id: number | null;
  whatsapp_phone_hash: string | null;

  marketing_consent: boolean;
  analytics_consent: boolean;
  phone_match_consent: boolean;

  updated_at: string;
}

/** Subset of UserProfile exposed publicly via the public_profiles view. */
export interface PublicProfile {
  id: string;
  handle: string;
  display_name: string | null;
  country_code: string | null;
  favourite_team_code: string | null;
  engagement_band: EngagementBand;
  created_at: string;
}

export interface Friendship {
  user_id: string;
  friend_id: string;
  source: FriendSource;
  created_at: string;
  removed_at: string | null;
}

export interface InviteCode {
  code: string;
  user_id: string;
  source: InviteSource;
  created_at: string;
  expires_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
}

/** What the Zustand user-store / useUser() hook exposes to the UI. */
export interface AuthState {
  status: "loading" | "guest" | "authenticated" | "unconfigured";
  user: { id: string; email: string | null; phone: string | null } | null;
  profile: UserProfile | null;
}
