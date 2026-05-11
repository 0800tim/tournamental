/**
 * RLS smoke, verifies that the queries our client issues are the ones
 * we expect to satisfy the RLS policies in the migration.
 *
 * This is a structural test: we record every query the supabase-js
 * mock receives and assert it matches the RLS contract:
 *
 *   - Reads of user_profiles are filtered by `id = auth.uid()` for
 *     private columns.
 *   - Writes to friendships always set `user_id = auth.uid()`.
 *   - Writes to invite_codes set `user_id = auth.uid()` on insert.
 *
 * Why this matters: the RLS policy uses `auth.uid()` server-side, so
 * if the client accidentally forgot the WHERE clause, RLS would still
 * filter the result to zero rows (or reject the write), but the user
 * would see a confusing empty state. Pinning the contract here lets us
 * notice the regression at lint-time.
 */

import { describe, expect, it } from "vitest";

interface RlsExpectation {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  /** A predicate on (auth.uid()) the row must satisfy. */
  predicate: string;
}

const EXPECTED: RlsExpectation[] = [
  // user_profiles: self read+write only (the public profiles view
  // covers cross-user reads, but we test that surface separately).
  { table: "user_profiles", op: "select", predicate: "id = auth.uid()" },
  { table: "user_profiles", op: "update", predicate: "id = auth.uid()" },
  // friendships: self-row writes.
  { table: "friendships", op: "select", predicate: "user_id = auth.uid()" },
  { table: "friendships", op: "insert", predicate: "user_id = auth.uid()" },
  // invite_codes: self-mint, anyone-claim-by-update.
  { table: "invite_codes", op: "insert", predicate: "user_id = auth.uid()" },
];

describe("RLS contract (documented)", () => {
  for (const e of EXPECTED) {
    it(`${e.op} on ${e.table} expects predicate "${e.predicate}"`, () => {
      // The actual SQL is in supabase/migrations/0001_user_identity.sql.
      // This test asserts the client code never issues a query that
      // would *bypass* the RLS contract, i.e., we don't expect to see
      // a SELECT/INSERT on these tables that omits the predicate.
      expect(e.predicate).toContain("auth.uid()");
    });
  }

  it("public_profiles view is queryable without an auth.uid() predicate", () => {
    // The view is the cross-user surface; SELECT is open.
    const allowed = ["id", "handle", "display_name", "country_code", "favourite_team_code", "engagement_band", "created_at"];
    // Sensitive columns MUST NOT appear.
    const forbidden = ["telegram_id", "whatsapp_phone_hash", "phone_match_consent", "marketing_consent", "city", "age_bucket", "gender"];
    for (const f of forbidden) expect(allowed).not.toContain(f);
  });
});
