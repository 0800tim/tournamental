/**
 * Identifies the Tournamental Oracle account (Molly, @Molly).
 *
 * The Oracle joins pools as a member so she shows up in the member list
 * and on the leaderboard, but she does not pay an entry fee, so she is
 * excluded from the pot / prize total of any paid pool. A $10 pool with
 * 16 members where one is the Oracle holds $150, not $160.
 *
 * Tim 2026-06-10: keep it simple, identify her by user_id in code (no DB
 * flag, no env). The Crate is currently the only paid pool she is in.
 */

const ORACLE_USER_IDS = new Set<string>(["u_df0d91458cd44272bcd6d5"]);

export interface OracleCandidate {
  readonly user_id?: string | null;
}

export function isOracleMember(m: OracleCandidate): boolean {
  return !!m.user_id && ORACLE_USER_IDS.has(m.user_id);
}

/** Count of members who pay the entry fee, i.e. everyone bar the Oracle. */
export function payingMemberCount(members: readonly OracleCandidate[]): number {
  return members.reduce((n, m) => (isOracleMember(m) ? n : n + 1), 0);
}
