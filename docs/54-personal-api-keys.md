# 54, Personal API keys

> Self-service personal API key flow for the Tournamental REST API and
> the MCP server. Logged-in users mint, view, regenerate, and revoke
> their own keys from `/profile/api-keys`. The keys are first-class
> credentials for writes against the public API surface, and the
> `TOURNAMENTAL_USER_KEY` value an MCP client (Claude Desktop, Cursor,
> Continue) reads from its config block.

This doc complements:

- [docs 12](12-odds-and-predictions.md) , the game-service API surface
  these keys authenticate against.
- [docs 32](32-auth-and-privacy.md) , the broader auth plane (Supabase
  sessions, Telegram bot tokens, SMS OTP).
- [docs 53](53-mcp-server.md) , the MCP server. Personal API keys are
  the canonical user-tier credential there.
- [docs 22](22-deployment-and-tunnels.md) , where the new game-service
  routes are deployed.

The admin-issued, ops-rotated API keys at `apps/admin/.../api-keys` are
a SEPARATE surface for staff users; personal keys are end-user owned and
end-user revoked.

## Why a personal-key flow

Until this PR, every authenticated write to the Tournamental REST API
required a Supabase session JWT. That works fine from the web app, but
it blocks three concrete contributor stories that the
`tournamental.com/engineering` walkthrough relies on:

1. **MCP server-config snippets.** Claude Desktop and Cursor want a
   single string in `claude_desktop_config.json` , there is no way to
   stuff a Supabase access token into a config file without writing a
   refresh loop. A long-lived personal key gives them one stable
   string they can rotate at will.
2. **Build-on-Tournamental sample apps.** A contributor's twenty-minute
   bracket app needs a bearer token to POST a bracket. Adding the
   supabase-js client just for an offline auth refresh is overkill.
3. **CI checks and integration tests** that hit prod-shaped endpoints.

Personal keys are the answer in every case.

## Token format

```
tnm_live_<32-char-base62>
```

| Segment | Length | Purpose |
| ------- | ------ | ------- |
| `tnm_live_` | 9 | Brand prefix , recognisable in code samples and egress filters. |
| `<base62>` | 32 | Cryptographically random body, log2(62) ~= 5.95 bits/char, approx 190 bits of entropy. |

The token is generated server-side via `randomBytes` + base62
rejection-sampling so the output distribution is uniform (a naive
`% 62` would bias the first four characters). See
`apps/game/src/routes/user-api-keys-crypto.ts`.

Example: `tnm_live_aBcDeFgH1234567890abcdef12345678`

### Display prefix

The first 16 characters of any minted token (`tnm_live_aBcDeFgH`) are
the **display prefix**. This is what we store in `key_prefix`, render
in the dashboard, and put in audit logs. The display prefix is
deterministic , given a plaintext, you can always derive its prefix ,
but contains far too little entropy to be brute-forceable.

The display prefix is the only segment of any key that ever leaves
the `user_api_keys` table.

## Auth header contract

Every call to a write endpoint that wants to authenticate as the key's
owner sends:

```
Authorization: Bearer tnm_live_<32-char-base62>
```

The game-service's `resolveAuthFromHeader` looks at the value's shape
and routes:

| Header value starts with | Path |
| ------------------------ | ---- |
| `tnm_live_` | Personal API key lookup against `user_api_keys`. |
| Anything else | Treated as a Supabase HS256 JWT. |

A malformed personal key fails closed; we deliberately do NOT fall
through to JWT parsing because a `tnm_live_` prefix that doesn't
verify is almost certainly a typo, not a JWT.

The MCP server forwards the same header on user-tier tool calls (see
[docs 53](53-mcp-server.md)), so a single key authenticates writes
through both the REST surface and the MCP toolbox.

## Endpoints

All four endpoints live at `/v1/me/api-keys` on the game-service. They
all require a valid Supabase session for the caller; the mint and
regenerate endpoints additionally reject the dev-trust `X-User-Id`
header (you cannot mint a key without a verified session, on any
environment).

### `GET /v1/me/api-keys`

Lists the caller's keys. Returns metadata only; never returns the
plaintext or the hash.

```json
{
  "keys": [
    {
      "id": "kQ8h2N4XmVbQ9z2",
      "label": "Claude Desktop, laptop",
      "prefix": "tnm_live_aBcDeFgH",
      "scopes": ["bracket:write", "picks:write", "share:write"],
      "rate_limit_rpm": 600,
      "created_at": "2026-05-11T09:14:22.000Z",
      "last_used_at": "2026-05-11T11:02:55.000Z",
      "revoked_at": null,
      "status": "active"
    }
  ]
}
```

### `POST /v1/me/api-keys`

Mints a new key. Request body:

```json
{
  "label": "Claude Desktop, laptop",
  "scopes": ["bracket:write", "picks:write", "share:write"]
}
```

`scopes` is optional; omit it and the server picks the user-tier
default (`bracket:write`, `picks:write`, `share:write`). Invalid scope
values are 400-rejected.

Response (`201 Created`):

```json
{
  "id": "kQ8h2N4XmVbQ9z2",
  "label": "Claude Desktop, laptop",
  "prefix": "tnm_live_aBcDeFgH",
  "scopes": ["bracket:write", "picks:write", "share:write"],
  "rate_limit_rpm": 600,
  "created_at": "2026-05-11T09:14:22.000Z",
  "last_used_at": null,
  "revoked_at": null,
  "status": "active",
  "key": "tnm_live_aBcDeFgH1234567890abcdef12345678"
}
```

The `key` field is the **only place the plaintext ever appears**. The
client UI shows it once with a "copy now" banner; the user is expected
to save it to their password manager or MCP config.

### `DELETE /v1/me/api-keys/:id`

Revokes a key. Always returns `204 No Content` on success; no body.
The row is preserved (`revoked_at` is stamped) so the audit trail is
intact, but the key cannot authenticate any further requests.

Revoking another user's key (or a key that doesn't exist) returns 404.

### `POST /v1/me/api-keys/:id/regenerate`

Convenience: revokes the old key, mints a new one with the same label
and scopes, and returns the new plaintext. Wrapped in a single SQLite
transaction so a half-completed regenerate cannot leave the user
without a key.

Response is the same shape as `POST /v1/me/api-keys`.

## Rate-limit defaults

Personal keys carry a per-key `rate_limit_rpm` (requests per minute).
The user-tier default is 600 rpm , the same budget the MCP user-tier
tools quote in [docs 53](53-mcp-server.md). The column is in the
schema so a future "raise my limit" flow only needs UI + audit work,
not a migration.

Until that ships, the limit cannot be changed via the API; ops can
edit it directly with a SQL update for partner clients.

## Scope vocabulary

The MVP scope set covers every public-API write the
`tournamental.com/engineering` walkthrough exercises:

| Scope | Tools / endpoints |
| ----- | ----------------- |
| `bracket:write` | `POST /v1/bracket/submit`, the MCP `submit_bracket` tool. |
| `picks:write` | `PUT /v1/picks/:userId/:matchId`, the MCP `update_pick` tool. |
| `share:write` | `POST /v1/bracket/:id/share-guid`, the MCP `save_share_guid` tool. |

A key without a scope cannot call the matching endpoint. Adding a new
scope is a docs/54 update + a route-level check; the scope vocabulary
is part of the public API surface, not a free-form string.

## Revoke vs regenerate

Both endpoints end the life of a credential. The semantics differ:

| Action | Mints a new key? | Same id? | Common reason |
| ------ | ---------------- | -------- | ------------- |
| `DELETE /v1/me/api-keys/:id` | No | n/a | "I lost the device, this key is compromised, kill it." |
| `POST /v1/me/api-keys/:id/regenerate` | Yes | No (new id) | "I want to rotate the secret without changing the label or losing the row id in my own config." |

Regenerate always issues a fresh `id` so an attacker who held the old
key cannot resurrect it with a known id. The label and scopes carry
over for ergonomics.

## Security model

The personal-key surface is high-value (a key authenticates writes to
a user's account). The defences:

1. **Plaintext is shown once.** The `POST` mint response is the only
   surface that ever contains the plaintext. The web UI stores it in
   React state, never `localStorage` or `sessionStorage`. The state is
   wiped on `pagehide` so a browser tab restore cannot leak it.
2. **Hash at rest.** The DB stores `scrypt$<saltHex>$<hashHex>` ,
   Node's built-in `scrypt` with a 16-byte random salt and the
   parameters used by `apps/vstamp` (N=2^14, r=8, p=1, 64-byte
   output). The algorithm tag in the prefix lets a future migration
   to argon2id flip the algorithm without a schema change.
3. **Lookup by prefix, verify by hash.** Auth resolution narrows the
   lookup to a single row via `key_prefix`, then constant-time
   compares the scrypt output. The plaintext never lives anywhere on
   disk; the prefix gives us O(1) lookup without storing the secret
   in plaintext.
4. **Audit log records the prefix only.** When a personal key
   authenticates a call (game-service `resolveAuthFromHeader`
   returns `source: "personal_key"`), the response carries the
   `keyId` and `keyPrefix` , no plaintext. The MCP server's
   `mcp_audit.jsonl` already records only the resolved user id and
   the tool name; with this PR it gains a `key_prefix` field for
   personal-key calls.
5. **Mint requires a verified Supabase session.** The mint and
   regenerate endpoints reject the dev-trust `X-User-Id` header on
   every environment. Listing and revoking still honour the dev
   header in non-production so local development against a
   pre-migrated session keeps working.
6. **25-key per-user cap.** Stops a runaway script from minting
   thousands of keys against one account. Tunable via
   `MAX_KEYS_PER_USER` in `apps/game/src/routes/user-api-keys.ts`.

## Schema

`apps/game/migrations/0005_user_api_keys.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_api_keys (
  id              TEXT PRIMARY KEY,                -- nanoid, public-facing
  user_id         TEXT NOT NULL,                   -- Supabase auth user id
  label           TEXT NOT NULL,                   -- user-supplied name
  key_prefix      TEXT NOT NULL,                   -- "tnm_live_" + first 8 chars
  key_hash        TEXT NOT NULL,                   -- scrypt encoded hash
  scopes          TEXT NOT NULL DEFAULT '[]',      -- JSON array of scope strings
  rate_limit_rpm  INTEGER NOT NULL DEFAULT 600,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  revoked_at      INTEGER
);

CREATE INDEX        idx_user_api_keys_user   ON user_api_keys(user_id);
CREATE UNIQUE INDEX idx_user_api_keys_prefix ON user_api_keys(key_prefix);
```

`key_prefix` is unique. The 16-character prefix has roughly 47 bits of
entropy (log2(62) * 8); a collision over the lifetime of the table is
astronomically unlikely, and a clash on insert is a 5xx the caller
retries.

## End-user flow

The `/profile/api-keys` page renders four blocks:

1. **Hero + explainer** , three sentences setting expectations
   ("Use these keys to authenticate writes... We never show the
   plaintext after creation").
2. **Mint form** , label input plus a scopes multi-select
   (defaults to all three scopes selected). The "Generate key"
   button is disabled until a label is set.
3. **Plaintext display** , when a key is freshly minted, a
   highlighted card shows the plaintext in a copy-to-clipboard chip
   with a banner: "Copy this now. We will never show it again." The
   card auto-clears when the user dismisses it or leaves the tab.
4. **Keys table** , label, prefix, created, last used, status,
   actions (Regenerate / Revoke).
5. **Code samples** , three tabs (curl, fetch, MCP config) showing
   the same authenticated request with `<your-key>` or the freshly
   minted plaintext substituted in.
6. **Footnotes** , links to the build-on-Tournamental engineering
   blog post, docs/53 (MCP), and the public `tournamental.com/api`
   portal.

Discoverability:

- The desktop nav's "More" dropdown gains an "API keys" entry.
- The `/profile` editor gains a "Developer" section linking to
  `/profile/api-keys`.

## What's parked for v0.2

- **Custom rate-limit tier per key.** The column is in the schema;
  the UI to bump it is not. Ops can do a manual SQL update for
  partner clients in the meantime.
- **OAuth-style scopes UI.** The MVP defaults every key to all three
  user-tier scopes. A scope picker that talks the user through which
  surfaces a key needs is on the roadmap once we have more than three
  scopes.
- **Webhook for key revocation.** Today a revoke is fire-and-forget;
  partner integrations have to poll. A future webhook will push the
  revoke to the MCP server's in-memory rate-limit cache so a revoked
  key stops working in seconds, not minutes.
- **Per-key audit drill-down.** The `last_used_at` field is in the
  schema but the UI doesn't yet surface "what did this key call?".
  Once the MCP audit log lands on the dashboard, the keys table will
  link each row to its call history.
