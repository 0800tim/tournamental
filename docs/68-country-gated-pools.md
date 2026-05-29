# 68, Country-gated public pools (spec)

> **Status: spec for review, NOT yet implemented.** Tim greenlights
> this doc before any code lands.
>
> **Problem.** A NZ brand (Rebel Sport-style) wants to sponsor a
> prize pool that is publicly listed in the Tournamental directory
> but only winnable by NZ residents. The simplest, fairest, lowest-
> friction proxy for "NZ resident" we have is "their verified mobile
> number's country code is +64". The same pattern applies to UK
> (+44), AU (+61), BR (+55), and every other market where a brand
> wants to gate prize eligibility.
>
> **Solution in one sentence.** Add an optional country allow-list
> to each pool, validated against the joiner's WhatsApp/SMS-OTP-
> verified phone number at the moment of join.

## Design decisions baked into this spec

The following were confirmed before writing:

| Decision | Choice |
|---|---|
| Single vs multiple countries per pool | **Multiple** (data model as array from day 1; UI defaults to single-pick) |
| Visibility on the public directory | **Yes** (flag badge on the directory card so visitors self-select) |
| What happens to existing members if the restriction changes | **Grandfather them in** with admin warning at edit time |
| Ineligible UX | **Friendly stop + upsell** to a directory filtered to pools they can join |

Everything in this spec follows those four choices.

## 1. Data model

### New column on `syndicates`

A new migration adds one nullable column to `syndicates`:

```sql
-- apps/game/migrations/0012_syndicates_country_gate.sql
ALTER TABLE syndicates
  ADD COLUMN allowed_phone_countries TEXT NULL;
COMMENT ON COLUMN syndicates.allowed_phone_countries IS
  'Optional CSV of E.164 dial codes (no plus) that a joiner''s
   verified phone must start with, e.g. "64" or "64,61". NULL means
   no restriction (open to anyone with a verified phone).';
```

**Why a CSV column rather than a join table:** the cardinality is
tiny (1 to ~5 codes per pool, ever) and we don't need to query "all
pools that allow +64" anywhere on the hot path. A CSV string keeps
reads/writes single-row, indexes are unnecessary, and migration is
trivial. If we ever do query that way (e.g. for the directory
filter), a GIN index on a generated column or a small denorm table
is a 30-min addition.

**Format.** Stored as the bare dial codes separated by commas, no
plus signs, no spaces: `"64"`, `"64,61"`, `"44"`. Empty string and
NULL both mean "open". We canonicalise to NULL on write when the
admin clears the restriction.

### TypeScript surfacing

Update `SyndicateRow` and the public DTO:

```ts
// apps/web/lib/syndicate/persistence.ts
interface SyndicateRow {
  // ...existing fields...
  /** CSV of E.164 dial codes (no plus), or null = open. */
  allowed_phone_countries: string | null;
}

// apps/web/lib/syndicate/public-directory.ts
interface PublicPoolDto {
  // ...existing fields...
  /** Parsed array of allowed dial codes, or empty = open. */
  allowed_phone_countries: string[];
}
```

A pair of helpers lives in `apps/web/lib/syndicate/country-gate.ts`
(new file):

```ts
export function parseAllowedCountries(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[1-9]\d{0,3}$/.test(s));
}

export function serialiseAllowedCountries(arr: string[]): string | null {
  const cleaned = arr.map((s) => s.replace(/\D/g, "")).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)).join(",") : null;
}

export function phoneMatchesAllowed(phoneE164: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;          // no restriction = open
  if (!phoneE164.startsWith("+")) return false;   // defensive
  const digits = phoneE164.slice(1);
  return allowed.some((dial) => digits.startsWith(dial));
}
```

`phoneMatchesAllowed("+64211234567", ["64","61"])` → `true`.
`phoneMatchesAllowed("+447700900123", ["64"])` → `false`.

## 2. Pool creation + edit UI

### Where it lives in the form

A new visually-prominent section "Lock entries to my country" sits
directly below the existing "Prize / Sponsorship" section, with a
heavier visual treatment than the other form sections so brand
admins giving away local prizes can't miss it.

Tim's specific UX direction: most brands giving away prizes WILL
want this on (local-shipping-only e-commerce, in-country
experiences, local liquor laws, etc.), so even though the default
is OFF (open), the toggle must be unmissable + the default country
picked when toggled ON must be auto-detected so it's a literal
one-click operation:

```
┌─ Prize / Sponsorship ──────────────────────────────┐
│ Prize text:           [______________________]     │
│ Entry fee:            [   ] [NZD ▼]                │
│ Bonus prize:          [______________________]     │
└────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════╗
║  🔒  Lock entries to one or more countries           ║
║                                                       ║
║   ◯ ───●  Only people from 🇳🇿 New Zealand can enter  ║
║                                                       ║
║   Most brands lock entries when prizes can't ship    ║
║   overseas or are local experiences. Verified via    ║
║   the joiner's mobile country code (+64, +44, etc).  ║
║                                                       ║
║   ┌─ shown when toggle is ON ────────────────────┐   ║
║   │ Allowed countries:                           │   ║
║   │   🇳🇿 New Zealand (+64)        [remove]      │   ║
║   │   🇦🇺 Australia (+61)          [remove]      │   ║
║   │                                              │   ║
║   │   [ + Add another country ▼ ]                │   ║
║   └──────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════╝
```

Visual notes:

- **Outer box** uses a stronger accent border (existing accent
  colour token) so it reads as a high-stakes setting, not just
  another field.
- **Lock icon** (🔒) in the heading reinforces what the setting
  does at-a-glance.
- **The toggle text auto-fills with the detected country** as soon
  as it's available, e.g. "Only people from 🇳🇿 New Zealand can
  enter" or "Only people from 🇬🇧 the United Kingdom can enter".
  This is the killer UX detail Tim called out: a brand admin sees
  their own country in the toggle label and clicks once.
- **Default state**: toggle is OFF (open to all). Required by
  spec; backed by Zod default `allowed_phone_countries: []`.
- **When toggled ON**: the country list auto-populates with the
  detected country as the first chip. Admin can immediately save
  or add more countries.
- **Min 1 country when locked**: removing the last chip while the
  toggle is ON forces the toggle back to OFF (preserves invariant).
- **Picker source**: reuse the existing `COUNTRY_CODES` array
  already in `SyndicateForm.tsx` (NZ/AU/GB/US/IE/ZA/IN/BR/DE/FR);
  promote it to `apps/web/lib/syndicate/countries.ts` shared with
  the join UI's badge/notice rendering.

### Auto-detection of the admin's country

The "detected country" surfaced in the toggle label comes from a
two-source detection helper:

```ts
// apps/web/lib/syndicate/detect-country.ts (new)
export function detectAdminCountry(opts: {
  cfIpCountry?: string;          // Cloudflare CF-IPCountry header (ISO-2)
  ownerPhoneE164?: string;       // their verified phone, if known
}): { iso2: string; dial: string; name: string; flag: string } | null
```

Detection order:

1. **Cloudflare `CF-IPCountry` header** (already forwarded by the
   existing edge config). ISO-2 country → mapped to dial code via
   the shared countries list.
2. **Owner's verified phone country code** (parsed from
   `owner_phone` if present). Always present at form-render time
   for an authenticated admin.
3. **Fallback to NZ** (since Tournamental is NZ-headquartered and
   the bulk of pool admins are NZ-based in v1).

The detected country is rendered in the toggle label and pre-
selected as the first chip when the toggle is flipped ON. It is
never auto-applied (the toggle must be ticked); we are biasing
toward visibility, not coercion.

### Server-side validation

Add to `createSyndicateInputSchema` (and the upcoming
`updateSyndicateInputSchema`):

```ts
allowed_phone_countries: z
  .array(z.string().regex(/^[1-9]\d{0,3}$/, "Invalid dial code"))
  .max(10, "Maximum 10 countries per pool")
  .optional()
  .default([]),
```

The persistence layer canonicalises with `serialiseAllowedCountries()`
before write.

### Server-side validation

Add to `createSyndicateInputSchema` (and the upcoming `updateSyndicateInputSchema`):

```ts
allowed_phone_countries: z
  .array(z.string().regex(/^[1-9]\d{0,3}$/, "Invalid dial code"))
  .max(10, "Maximum 10 countries per pool")
  .optional()
  .default([]),
```

The persistence layer canonicalises with `serialiseAllowedCountries()`
before write.

## 3. Public directory

### Pool card change

Add a "country gate" badge to the pool card in
`apps/web/app/pools/PoolDirectory.tsx`:

```
┌─ Pool card ────────────────────────────────┐
│ [logo]  Rebel Sport WC26                   │
│         FIFA World Cup 2026                │
│         "Pick the bracket, win prizes..."  │
│                                            │
│         [Free entry] [Prize: $5k] 🇳🇿 NZ only │
│                                            │
│         432 members                        │
└────────────────────────────────────────────┘
```

Badge text cases:

| # of countries | Badge example |
|---|---|
| 0 (no restriction) | (badge hidden entirely) |
| 1 | `🇳🇿 NZ only` |
| 2 | `🇳🇿🇦🇺 NZ + AU only` |
| 3 | `🇳🇿🇦🇺🇬🇧 NZ + AU + UK only` |
| 4 | `🇳🇿🇦🇺🇬🇧🇮🇪 NZ + AU + UK + IE only` |
| 5+ | `🇳🇿🇦🇺🇬🇧🇮🇪 +N countries only` (first 4 flags + count) |

The 5+ badge has a hover/tap tooltip that lists all included
countries verbatim.

### Optional directory filter (v1.5, not v1)

Defer for now. v1 ships with the badge only. v1.5 adds a filter
"Only show pools I'm eligible for" once the user has a verified
phone in their session. This is one extra `WHERE` clause + a
toggle in the directory header; not in this spec to keep v1 small.

## 4. Join flow enforcement

The check fires in **one place server-side** (the source of truth)
and **mirrors client-side** for nice UX. Server is authoritative.

### Server-side (authoritative)

In `apps/web/app/api/v1/syndicates/[slug]/join/route.ts` POST
handler, immediately after the user's phone has been verified via
OTP and before `addMember()` is called, add:

```ts
import { parseAllowedCountries, phoneMatchesAllowed } from "@/lib/syndicate/country-gate";

const allowed = parseAllowedCountries(syndicate.allowed_phone_countries);
if (!phoneMatchesAllowed(verifiedPhoneE164, allowed)) {
  // Owners bypass their own pool's restriction (they administer it).
  if (userId !== syndicate.owner_user_id) {
    return Response.json(
      {
        ok: false,
        reason: "country_restricted",
        allowed_countries: allowed,
        directory_url: `/pools?eligible_for=${encodeURIComponent(verifiedPhoneE164)}`,
      },
      { status: 403 },
    );
  }
}
```

The `directory_url` is what the client uses to render the
"upsell to other pools" CTA.

**Owner exemption is explicit.** A brand HQ'd in Sydney can set up
a NZ-only pool from their +61 phone; the owner is configuring, not
playing. This is consistent with how `owner_user_id` already
bypasses other restrictions.

### Client-side (UX mirror)

`JoinFlowClient.tsx` (and the `DoneStep` rendering pipeline) gets
a new "ineligible" branch:

```tsx
// In the DoneStep switch on status:
case "country_restricted":
  return <CountryRestrictedScreen allowed={r.allowed_countries} directoryUrl={r.directory_url} />;
```

New component `apps/web/components/join/CountryRestrictedScreen.tsx`:

```
┌──────────────────────────────────────────────┐
│                                              │
│              🌏                              │
│                                              │
│  This pool is for 🇳🇿 New Zealand residents.  │
│                                              │
│  We use your mobile country code to keep     │
│  prize eligibility fair. Your number isn't   │
│  from one of the allowed countries:          │
│                                              │
│        🇳🇿 New Zealand (+64)                  │
│                                              │
│  Good news, there are pools open to you.     │
│  We've filtered the directory:               │
│                                              │
│    [ Browse pools you can join → ]           │
│                                              │
│  Or sign up with a different verified phone. │
│                                              │
└──────────────────────────────────────────────┘
```

The "Browse pools you can join" button links to
`/pools?eligible_for=+44...` (URL-encoded). Backend filters the
directory to pools where `allowed_phone_countries` is NULL or
contains the user's dial code.

### When does the check fire, OTP-first or phone-entry-first?

**The check fires AFTER OTP success, not at OTP request time.** Reasons:

1. We need to be SURE the phone is theirs, otherwise an attacker
   could test/probe valid country codes by trying random numbers
   in someone else's range.
2. The OTP cost (~$0.01 per send) is trivial vs the friction of
   gating earlier.
3. Showing the friendly "ineligible" screen after they've already
   typed + verified their phone is more dignified than "your phone
   country is wrong, please go away" at the entry field.

**However**, the join page DOES surface the restriction up-front,
above the phone-entry field, so almost no one with an ineligible
phone will bother to verify. That's the goal.

### Up-front messaging on the join page

`JoinFlowClient.tsx`'s landing step (phone entry) gets a small
notice when the pool has a country gate:

```
┌─ Join "Rebel Sport WC26" ───────────────────┐
│                                             │
│  🇳🇿 NZ residents only                       │
│  You'll need a verified +64 mobile to join. │
│                                             │
│  [Phone: +64 ___________]                   │
│  [ Send WhatsApp code ]                     │
└─────────────────────────────────────────────┘
```

For multi-country pools: `🇳🇿🇦🇺 NZ + AU residents only`.

This is the single most important piece of UX: it sets expectation
BEFORE the user invests typing/verifying.

## 5. Admin edit flow

The pool admin can edit the country restriction post-creation via
the existing pool-settings page (already wired for branding edits).
The edit form re-renders the same "Entry eligibility" section.

### Grandfather warning

When the admin changes the restriction in a way that would now
exclude existing members:

1. On the edit form, after they hit Save, the server-side route
   counts members whose `verified_phone` does NOT match the new
   restriction.
2. If `n > 0`, the API returns a `requires_confirmation: true`
   response with a count, the route surfaces a confirmation dialog:

```
┌──────────────────────────────────────────────┐
│ Heads up                                     │
│                                              │
│ 12 existing members do not match the new     │
│ country restriction.                         │
│                                              │
│ They will STAY in your pool (grandfathered)  │
│ but new joiners with the same phone country  │
│ will be blocked.                             │
│                                              │
│    [ Cancel ]   [ Save and grandfather ]     │
└──────────────────────────────────────────────┘
```

3. Confirm → save proceeds with no member changes. Cancel → no
   change.

### Future tightening: "kick the mismatching" toggle

Out of scope for v1. Can be added as an explicit button on the
confirmation dialog later: `[ Save and remove 12 members ]`. v1
ships grandfather-only because it's the right default.

## 6. Test plan

### Unit tests

`apps/web/lib/syndicate/country-gate.test.ts`:

| Test | Input | Expected |
|---|---|---|
| Open pool accepts any phone | allowed=[], phone="+447700..." | true |
| NZ pool accepts NZ | allowed=["64"], phone="+64211..." | true |
| NZ pool rejects UK | allowed=["64"], phone="+44770..." | false |
| ANZAC pool accepts NZ + AU | allowed=["64","61"], phone="+61455..." | true |
| ANZAC pool rejects UK | allowed=["64","61"], phone="+44770..." | false |
| Parse normalises odd input | csv=" 64 , +61 ,, "  | ["64","61"] |
| Serialise dedupes | arr=["64","64","61"] | "64,61" |
| Invalid dial code rejected | input=["abc","0"] in Zod | validation error |

### Integration tests

`apps/web/app/api/v1/syndicates/[slug]/join/route.integration.test.ts`:

- Create NZ-only pool, join with +64 → 200 ok, member active.
- Create NZ-only pool, join with +44 → 403 country_restricted.
- Owner of NZ-only pool joins with their +61 phone → 200 ok
  (owner exemption).
- Edit pool from open to NZ-only with 3 +44 members → grandfather
  warning, members stay active.
- Public directory hydrates with the `allowed_phone_countries`
  array correctly.
- `?eligible_for=+64...` query filters directory correctly.

### Manual smoke (vtorn-dev)

1. Create a public NZ-only pool.
2. Verify the directory badge appears.
3. Try to join from a UK number → see ineligible screen with
   correct copy + working upsell link.
4. Join from a NZ number → success.
5. Edit pool to add Australia → verify members + directory update.
6. Tighten back to NZ-only with a +61 grandfathered member →
   confirmation dialog fires; on save member stays.

## 7. Migration + rollout

1. **DB migration** (`0012_syndicates_country_gate.sql`) — adds the
   column, defaults NULL for all existing pools (= open). Safe,
   non-breaking.
2. **Ship to vtorn-dev first** behind no feature flag (the field
   is optional + opt-in by the admin).
3. **Manual smoke test** on vtorn-dev with at least one NZ-only and
   one ANZAC-style pool.
4. **Promote to prod** with `pnpm --filter @vtorn/cicd-tools run
   publish-all -- --env=production --apps=web` (and re-publish admin
   if its forms need parity; check during build).
5. **Backfill nothing.** Existing pools stay open until their admins
   choose to restrict.

## 8. Non-goals + edge cases

**Non-goals for v1:**

- Geo-IP fallback. The phone-country proxy is the spec; we do not
  do IP-geo verification.
- Multiple-phone-per-user. We assume one verified phone per user
  session (consistent with existing OTP flow).
- "Exclude" rules (e.g. "anywhere EXCEPT US"). Allow-list only.
- Pool-level minimum age, ID verification, residency proof. These
  are bigger features; this spec is scoped to "phone-country
  proxy" only.

**Edge cases handled:**

| Case | Behaviour |
|---|---|
| Owner has non-matching phone | Owner is always exempt (administers, doesn't play). |
| User changes their phone post-join to a non-matching country | Their existing membership is unaffected (grandfather pattern). Future joins to other restricted pools use the new phone. |
| Pool has 11+ countries selected | Zod rejects in the API; UI disables "Add country" button at 10. |
| User's phone is +1 (US/Canada share dial code) | Both US and Canada residents pass a "+1 only" pool. This is documented in the admin help text. If we ever need to split US vs CA, we'd add a libphonenumber dependency to extract the area code; out of scope for v1. |
| User has no verified phone yet | Existing join flow already requires phone verification before adding member. No change. |
| Pool is private (is_public=0) | Country gate still applies. A private NZ-only pool with a shared invite link still rejects non-NZ joiners. |

## 9. File touch list

For implementation reference (not implementing yet, just so the
reviewer can sanity-check scope):

| File | Change |
|---|---|
| `apps/game/migrations/0012_syndicates_country_gate.sql` | NEW — adds column |
| `apps/web/lib/syndicate/persistence.ts` | UPDATE — SyndicateRow + INSERT/UPDATE SQL |
| `apps/web/lib/syndicate/schema.ts` | UPDATE — Zod schemas (create + update) |
| `apps/web/lib/syndicate/country-gate.ts` | NEW — parse/serialise/match helpers + tests |
| `apps/web/lib/syndicate/countries.ts` | NEW — shared country list (moved from SyndicateForm) |
| `apps/web/lib/syndicate/public-directory.ts` | UPDATE — DTO + query (`?eligible_for=` filter) |
| `apps/web/app/syndicates/new/SyndicateForm.tsx` | UPDATE — new "Entry eligibility" section, use shared countries list |
| `apps/web/app/syndicates/[slug]/settings/SyndicateSettingsForm.tsx` | UPDATE — same section in edit form, grandfather confirmation |
| `apps/web/app/pools/PoolDirectory.tsx` | UPDATE — render country badge, support `?eligible_for=` |
| `apps/web/components/join/JoinFlowClient.tsx` | UPDATE — up-front notice on phone-entry screen, handle `country_restricted` response |
| `apps/web/components/join/CountryRestrictedScreen.tsx` | NEW — the friendly-stop screen |
| `apps/web/app/api/v1/syndicates/[slug]/join/route.ts` | UPDATE — enforcement after OTP, before addMember |
| `apps/web/app/api/v1/syndicates/[slug]/route.ts` (PATCH) | UPDATE — grandfather warning logic |

Approximate diff size: ~600 LOC across ~13 files (most of it the
new screen + schema/migration boilerplate). One day of focused
implementation work + half a day of manual smoke testing.

## 10. Sample admin help copy (for the brand-facing UI)

Short paragraph that lives under the "Entry eligibility" section to
set expectations:

> **How country restriction works.** Joiners verify their mobile
> number with a one-time code over WhatsApp. We check the country
> code of that verified number, e.g. +64 for New Zealand or +61
> for Australia. Only joiners whose number matches your allowed
> countries can enter the pool. This is a phone-country proxy, not
> a residency check; an expat using a NZ SIM abroad can still join
> a NZ-only pool. For most brand promotions, this is a reasonable
> proxy and is much lower friction than ID verification. If you
> need stricter eligibility (proof of residency, age verification),
> talk to us about a bespoke setup.

## 11. Decisions confirmed pre-implementation

The three open questions above were resolved by Tim 2026-05-29:

1. **Backdoor override code: no.** Keep it simple. If brands later
   ask for it, defer to v2.
2. **5+ countries badge: `+N countries only` with tooltip** (as
   originally specced).
3. **Form default: "Open to all"** but the country-lock toggle is
   given a prominent visual treatment (heavier border, lock icon,
   own section), and the toggle label auto-fills with the admin's
   detected country (Cloudflare `CF-IPCountry` → fallback to
   verified phone country code → fallback to NZ). One click locks
   to detected country. See section 2 for the updated UI mock and
   detection helper spec.

---

Last updated 2026-05-29. Status: implementation greenlit by Tim;
starting on branch `feat/country-gated-pools`.
