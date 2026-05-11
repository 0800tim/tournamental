# Note — "Save", not "Lock", in user copy

> Why every user-facing button reads "Save" but the field on disk is still
> `lockedAt`.

## TL;DR

- **User-facing copy**: always "Save" / "Saved" / "Save my pick" /
  "Save bracket". Never "Lock".
- **Internal field names and error codes**: stay as `lockedAt`,
  `oddsAtLock`, `lockMultiplier()`, `kickoff_lockout`,
  `match_already_started`. The scoring engine reads these.
- **Internal CSS classes**: `is-locked`, `bracket-lock-*`,
  `mpr-locked-banner` etc. stay. They're not user-visible.

## Tim's spec, verbatim

> "The word 'lock' sounds final. The idea is that you can change your
> picks game by game as long as you get in before match kickoff for the
> win-lose draw selection. Other people have spin-off games above and
> beyond this, like in-match play, which they can build on by API;
> that's the whole deal, but ours will be changeable for each match
> right before kickoff, so just say 'save' instead of 'lock', and then
> people can save and share, and they can change at any time."

In short: the **policy** ("no changes after kickoff") is intact —
that's the `kickoff_lockout`. The **verb** in the UI is "Save" because
the user is mentally saving an editable doc, not locking a vault.

## Where the rename lands

Inside `apps/web`:

- All button labels: "Lock pick" → "Save pick", "Lock final" → "Save
  bracket", "Lock it in" → "Save pick".
- Toast / status text: "Pick locked" → "Pick saved", "Locked-in odds"
  → "Saved odds", "locked {time}" → "saved {time}".
- Empty-state and help copy: "Lock the bracket before kickoff…" →
  "Save your bracket. You can change any pick until that match kicks off."
- Modal copy: "Lock in your prediction" → "Save your pick". The
  autopick confirm modal lost the "not a lock" line.
- Page metadata (OpenGraph + Twitter card descriptions) for
  `/world-cup-2026`, `/world-cup-2026/landing`,
  `/world-cup-2026/share/[bracketId]`.

Inside `apps/marketing`:

- The hero / how-it-works / world-cup-2026 / why pages all read "save"
  for the user-facing verb.
- Blog posts (`apps/marketing/src/content/blog/*.mdx`) are NOT changed —
  they're historical artefacts.

Inside `docs/`:

- This file (an explainer for future agents).
- `docs/12-odds-and-predictions.md` "Lock rules" section renamed to
  "Save and lockout rules" with a header note about the technical vs.
  user vocabulary.
- `docs/45-per-match-pick-popup-and-api.md` gets a "Save, not Lock"
  section at the top explaining the same.

## What stays as "Lock"

These are internal — they're field names, error codes, function names,
CSS classes, or comments quoting Tim's original spec line ("lock off
any changes … at kickoff (0 minutes)"). Changing them risks breaking
the scoring engine, the API contracts, or downstream consumers.

| Token                     | Where                                                    |
| ------------------------- | -------------------------------------------------------- |
| `lockedAt`                | Field on `MatchPrediction` and `Bracket` (scoring input) |
| `oddsAtLock`              | Field on `MatchPrediction` (odds snapshot for scoring)   |
| `lockMultiplier()`        | `packages/bracket-engine` scoring function               |
| `kickoff_lockout`         | The deadline policy name                                 |
| `match_already_started`   | HTTP 409 error code from `PUT /v1/picks/:userId/:matchId` |
| `LockSummary` (component) | Components imported by callers/tests                     |
| `BracketTreeProps.lockedKeys`, `onToggleLock` | SVG-tree prop names (unused live, kept for the future bracket tree) |
| CSS: `bracket-lock-*`, `is-locked`, `mpr-locked-banner`, `mp-locked-odds` | Selectors used by tests + stylesheet |

If you're an agent adding new user-visible copy: read this list. If
your new string fits the "policy" sense (the server says no), it's
"saved" or "save"; if your string is a field name or an error code, it
stays "locked" / "lockedAt" / "lockout".

## Regression test

`apps/web/__tests__/save-not-lock-codebase-guard.test.ts` walks every
.tsx/.ts under `apps/web/app` and `apps/web/components` and fails if a
capital-L `Lock` survives after the internal-identifier allowlist is
stripped. The allowlist matches the table above. A future PR that
re-introduces "Lock pick" or "Lock in your bracket" will fail at CI.

## Why this rename matters for the product

Bracket prediction games (Yahoo, ESPN, NCAA pools) usually use "lock"
to mean "you've submitted; you can't change it now". Tim's product is
different: every match can be re-picked until that specific match
kicks off (not the tournament start, not the previous round — that
match). The "save and share now, change later" pattern is closer to a
Google Doc draft than a Yahoo bracket submission. Using "Save" tells
users they can keep tweaking.

The early-save multiplier rewards conviction: pick a long-shot now and
your multiplier is bigger than if you save the same pick five minutes
before kickoff. Late saves still count — they just earn less. That's
the closest the user copy comes to needing to say "lock", and even
there "save" is more accurate because every save resets the multiplier
clock.
