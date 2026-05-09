# 2026-05-10 — vstamp-builder — initial build

**Task:** ship `apps/vstamp/` Phase 1 (off-chain Merkle + Ed25519 signed roots)
per docs/17 (read as `17-vstamp-and-prediction-iq.md`) and docs/21 (Phase 2
context, out of scope here).

**Branch:** `feat/vstamp-receipts`.

## Plan

1. Fastify service on `:3390` matching `apps/api` conventions
   (cors+helmet+rate-limit+sensible, in-memory testable via `app.inject`).
2. Storage: `better-sqlite3` with checked-in migration `0001_init.sql` for
   `leaves`, `roots`, `keys` tables.
3. Crypto: `@noble/hashes` (sha256), `@noble/curves` (ed25519), AES-256-GCM
   from `node:crypto` for key-at-rest using a scrypt-derived KEK.
4. Merkle: domain-separated leaf (`0x00`) and node (`0x01`) hashes; trailing
   duplicate for odd levels (RFC 6962-style). Inclusion proof shape
   `[{sibling, position}, …]`.
5. Receipts: leaf = sha256(0x00 || canonical_json(bracket) || salt) where
   salt is per-receipt 32 bytes random; salt returned to user.
6. Six endpoints: `/v1/vstamp/{issue,finalise/:tournament_id,proof/:leaf_hash,
   root/:tournament_id/:date,verify}` plus `/healthz`.
7. 35+ vitest tests including a *cross-implementation* verifier in
   self-contained JS to prove the proof shape is independently verifiable.
8. README with the exact curl walkthrough shown to actually run.
9. Update `docs/22-deployment-and-tunnels.md` to add port 3390 + suggested
   `vtorn-vstamp.aiva.nz` → `vstamp.vtourn.com`.

## Outcome

**Status: complete.**

- 86 vitest tests pass (target: 35+).
- `pnpm typecheck` clean. `pnpm build` clean.
- End-to-end curl walkthrough: issue → finalise → proof → verify yields
  `{ valid: true }` (verified live on a temp DB; sample receipt in README).
- Cache-Control headers chosen per docs/22:
    - `no-store` on writes, healthz, verify, and pre-finalisation proofs.
    - `public, max-age=60, s-maxage=86400, stale-while-revalidate=604800` on
      finalised proofs and root reads (immutable once sealed → safe at edge).
- Phase 2 explicitly deferred (on-chain anchor, OTS integration, VStamp ID
  issuance, key-rotation API) and noted in README "Phase 2" section.

## Key design notes

- **Salt is the privacy mechanism.** The leaf binds a 256-bit random salt so
  a small bracket space (e.g. 16-team seeding) is not brute-forceable. Server
  never stores the bracket payload; only the leaf hash + tournament_id +
  hashed user_id.
- **Single-leaf trees have `root === leaf` by RFC 6962.** Tests cover this and
  the README calls it out so reviewers don't see it as a bug.
- **Domain separation** (`0x00`/`0x01` prefixes) prevents second-preimage
  attacks. Documented in code comments and README.
- **Admin auth** is a constant-time bearer-token compare. If
  `VSTAMP_ADMIN_TOKEN` is unset, finalise returns 503 (admin disabled) — fail
  closed.
- **Key encryption** uses scrypt(N=16384, r=8, p=1) → AES-256-GCM with random
  salt+nonce per blob. GCM auth tag rejects tampered ciphertext (tested).

## Files touched

- `apps/vstamp/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`,
  `.env.example`, `README.md`
- `apps/vstamp/migrations/0001_init.sql`
- `apps/vstamp/src/{server,context}.ts`
- `apps/vstamp/src/lib/{canonical,merkle,keys,key-store,db,receipts}.ts`
- `apps/vstamp/src/routes/{health,issue,finalise,proof,root,verify}.ts`
- `apps/vstamp/test/{canonical,merkle,keys,receipts,server}.test.ts`
- `apps/vstamp/data/.gitkeep`
- `docs/22-deployment-and-tunnels.md` (added port 3390 + vtorn-vstamp tunnel)

## Out of scope (not in this PR)

- On-chain anchoring (Phase 2; doc 21).
- OpenTimestamps integration.
- VStamp ID human-readable identifier + static proof page at `vtourn.com/v/...`.
- Key rotation API (`/v1/vstamp/keys`).
- Cron-driven daily finalisation (currently manual via admin POST; trivial to
  wrap with a tiny scheduler when game-service comes online).

## Verification

Sample receipt from a live run on this branch:

```
issue    leaf  cc9e5c9a40447f7d3fbb80e0c7a8ff784ab104fa0fad30f0d3561f6b89e7ff89
issue    salt  1058b4caa27d87f34bd5ca5f74d4a14e6fcde0c51eb8d5d1fee74ec6ffcb2650
finalise root  cc9e5c9a40447f7d3fbb80e0c7a8ff784ab104fa0fad30f0d3561f6b89e7ff89
finalise sig   02e0eab3128a24e6808a9b6d52b46a0656ce5687a58488b253f04ee881184c092bec5227d758011cdde54bd6192ac522da14940f27d9c1472d461a03f87ff407
finalise pub   cec1e15b83cf1272aeadbefdac1a48959b7d507276c3270dab226218deb73e9b
verify         { valid: true }
```

Refs: doc/17, doc/22, sessions/2026-05-10_vstamp-builder_initial-build.md
