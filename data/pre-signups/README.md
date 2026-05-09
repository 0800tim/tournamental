# `data/pre-signups/`

Phase-0 sink for syndicate pre-launch signups submitted to
`/api/syndicate/intent`. Each request is persisted as a single JSON file
keyed by ISO timestamp + 4-byte random suffix.

## Why a flat directory of JSON?

Until `apps/api` ships with Postgres (per `docs/22-deployment-and-tunnels.md`),
this is the simplest way to capture intent without losing data. It's
intentionally low-tech:

- Each file is independent — no concurrent-write coordination needed.
- An operator can `ls -la` to see how the campaign is going.
- A single `cat *.json | jq -s '.'` exports the whole list when the API
  finally stands up.

## Schema (one file per signup)

```jsonc
{
  "id": "2026-05-09T14-22-31-001Z_a1b2c3d4",
  "received_at_utc": "2026-05-09T14:22:31.001Z",
  "kind": "friends" | "office" | "public",
  "syndicate_name": "Mum's Fantasy Crew",
  "your_name": "Tim",
  "email": "tim@example.com",
  "telegram": "@tim" | null,
  "country": "NZL"
}
```

## PII handling

All files in this directory **except this README** are gitignored. Don't
copy them into the repo, don't paste their contents into PR descriptions,
don't ship them to a third party without consent. The form footer warns
the user the email is used for invite emails only.

## Migration to the API

When `apps/api` is ready, the route handler in
`apps/web/app/api/syndicate/intent/route.ts` should switch from `fs.writeFile`
to a `fetch(API_URL + "/v1/syndicate/intent", …)` call, and a one-shot
script can scan this directory and POST every existing JSON file to the
new API. After the migration the `apps/web` route handler keeps the
write-to-disk fallback for offline development only.
