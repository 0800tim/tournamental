---
name: syndicate-create
description: Create a branded syndicate via the game-service API. Slug validation, branding, format, returns live URL.
license: Apache-2.0
---

# When to use this skill

The user wants to spin up a branded prediction pool. Office
sweepstake, friends WhatsApp group, fan-club ladder, creator
audience. They land on `play.tournamental.com/syndicates/new` and
fill the form; you orchestrate the API calls.

# How to do it

## 1. Pick a slug

Slugs live at `play.tournamental.com/s/<slug>`. Constraints from
[`docs/syndicates.md`](../../docs/syndicates.md) (if present; else
the rules baked into `apps/game/src/lib/syndicate-slug.ts`):

- 3-32 chars, lowercase a-z, 0-9, hyphens only.
- No reserved words. The reserved list is fetched via
  `GET https://game.tournamental.com/v1/syndicate/reserved`.
- Fuzzy collision check: `nba` and `n-b-a` should both reject if
  one is taken.

## 2. Validate via the API

```bash
curl -sS https://game.tournamental.com/v1/syndicate/slug-check \
  -H 'content-type: application/json' \
  -d '{"slug":"my-fancy-pool"}'
# 200 {ok:true} or 409 {ok:false,reason:"reserved|taken|fuzzy-collision"}
```

## 3. Create

The user must be signed in (Supabase JWT or personal API key
`tnm_live_...`).

```bash
curl -sS https://game.tournamental.com/v1/syndicate \
  -H "authorization: Bearer $TOURNAMENTAL_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "slug": "my-fancy-pool",
    "name": "My Fancy Pool",
    "format": "podium",
    "tournament": "fifa-wc-2026",
    "branding": {
      "logo": "data:image/png;base64,...",
      "primary": "#f5c542",
      "tagline": "Settle this once and for all."
    }
  }'
```

Response: `201 {id, slug, url, joinUrl}`.

## 4. Hand back the URL

`url` is `https://play.tournamental.com/s/<slug>`. `joinUrl`
includes a short-lived invite token; share that one to friends so
their first-time auth is one-tap.

# Acceptance checks

- The returned `url` resolves with HTTP 200 in a curl GET.
- The user lands on a page with their branding visible.
- The syndicate appears in `GET /v1/me/syndicates` for the
  creating user with role `owner`.

# Boundaries

- DO NOT mint a syndicate without an authenticated session. The
  API will 401 anonymous attempts.
- DO NOT bypass `/v1/syndicate/slug-check` — even if you "know"
  the slug is free, the API runs the same check and rejects
  duplicates; trust the server.
- DO NOT upload a branding logo > 256 KB. The route limits at
  256 KB; larger uploads should go through the future
  `/v1/syndicate/branding/upload` route (`docs/syndicates.md`
  future-work section).
