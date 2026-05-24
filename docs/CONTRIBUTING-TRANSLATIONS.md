# Contributing translations to Tournamental

> Help us speak every World Cup nation's language. This is the human-translator guide. The architectural plan lives in [60-i18n-architecture.md](60-i18n-architecture.md); that one explains the system. This one explains how to add a translation, improve an existing one, or add a new locale we don't ship yet.

## What's live (2026-05-24)

- 22 locales: `en, es, pt-BR, pt-PT, fr, de, it, nl, hr, bs, cs, sv, no, hu, ja, ko, zh-CN, uz, mi, ar, fa, tr`.
- ~390 leaf keys per locale, covering the home page, /odds, /syndicates landing, /s/[guid] share landing, /world-cup-2026 bracket builder, the chrome (AppBar, drawer, footer, BottomNav, locale picker), and the join-pool flow.
- URL-prefix routing: `play.tournamental.com/es/world-cup-2026` renders Spanish; the picker writes that URL automatically and a cookie keeps the preference sticky across navigation.
- RTL flips for `ar` and `fa` (the `<html dir="rtl">` is set server-side by the layout).

## Quick start

1. Fork the repo on GitHub: https://github.com/0800tim/tournamental
2. Clone your fork: `git clone https://github.com/<you>/tournamental && cd tournamental`
3. Install dependencies: `pnpm install`
4. Find the locale file for the language you want to improve: `apps/web/locales/<locale>.json` (e.g. `fr.json`, `es.json`, `pt-BR.json`, ...).
5. Edit the **value** for any key. Do NOT change the key itself, only the value.
6. Validate locally: `pnpm i18n:validate` (runs from the repo root; flags any key that exists in `en.json` but is missing from your locale).
7. Commit on a feature branch: `git checkout -b i18n/fr-improve-join-modal && git commit -sm "i18n(fr): improve join-modal copy"`.
8. Push + open a pull request. Reviewers tag in based on the locale's native-speaker labels.

That's it. The rest of this doc is rules + tips so your PR lands cleanly.

## The locale file format

Every locale is a NESTED JSON file with the same key tree. Values are localised strings. The catalogue is nested (not flat with dotted keys) because next-intl walks the object by dots: `t("home.hero.headline_a")` resolves to `messages.home.hero.headline_a`.

```json
// apps/web/locales/en.json (source of truth)
{
  "_meta": { "locale": "en", "native": "English", "english": "English", ... },
  "nav": {
    "predict": "Predict",
    "save_share": "Save & share",
    "leaderboard": "Leaderboard",
    "pools": "Pools"
  },
  "home": {
    "hero": {
      "headline_a": "Can you predict the entire World Cup?",
      "cta_predict": "Set my picks",
      "cta_pool": "Run a pool",
      "lede": "Nobody has ever done it ... {odds_link}. Twenty-two World Cups, 964 matches, ..."
    }
  },
  "join": {
    "modal": {
      "title": "Join {pool_name}",
      "cta_send_code": "Send login code"
    }
  },
  "syndicate": {
    "members": "{count, plural, =0 {No members yet} one {# member} other {# members}}"
  }
}
```

```json
// apps/web/locales/fr.json
{
  "_meta": { "locale": "fr", "native": "Français", ... },
  "nav": {
    "predict": "Pronostiquer",
    "save_share": "Enregistrer & partager",
    "leaderboard": "Classement",
    "pools": "Pools"
  },
  "home": {
    "hero": {
      "headline_a": "Peux-tu pronostiquer la Coupe du Monde entière ?",
      "cta_predict": "Fais mes pronostics",
      "cta_pool": "Lancer un pool"
    }
  }
}
```

The `_meta` block at the top of each file carries locale metadata (native name, completeness, translators). Don't change its `locale` field; translator names can be added to its `translators` array.

The rules:

- **Keys NEVER change in a translation PR.** Only values. If you think a key should change, open a separate PR labelled `i18n:scope` first.
- **Every locale file must have the same key set as `en.json`.** Missing keys fall back to English at runtime, but the validator will flag your PR. Either translate the missing key or note explicitly in the PR description "intentionally falling back to English".
- **Placeholders stay untouched.** `{pool_name}`, `{count}`, `{handle}` etc. are replaced at runtime; translating them breaks the page. Move them inside your sentence as the grammar requires, but never rename or remove them.
- **ICU MessageFormat syntax is preserved.** The `{count, plural, =0 {...} one {...} other {...}}` block has rigid syntax; the keys (`=0`, `one`, `few`, `many`, `other`, `zero`, `two`) come from the [CLDR plural-rules catalogue](https://unicode-org.github.io/cldr-staging/charts/47/supplemental/language_plural_rules.html). For Czech you need `one`, `few`, `many`, `other`. For Arabic you need all six. The validator will warn if your locale is missing a plural form CLDR says it needs.

## Pluralisation by locale

This catches translators out more than anything else. Some languages have richer plural systems than English.

| Locale | Plural cases CLDR says you need |
| --- | --- |
| `en` | `one`, `other` |
| `es`, `pt-BR`, `pt-PT`, `fr`, `de`, `it`, `nl`, `sv`, `no`, `uz`, `hu`, `tr` | `one`, `other` |
| `ja`, `ko`, `zh-CN`, `mi` | `other` only (no plural distinction in the grammar) |
| `ar` | `zero`, `one`, `two`, `few`, `many`, `other` |
| `cs` | `one`, `few`, `many`, `other` |
| `hr`, `bs` | `one`, `few`, `other` |
| `fa` | `one`, `other` |

If you're not sure what each case means, the CLDR docs spell it out per locale. The validator is the safety net.

## Style rules per locale

These are the per-locale "house style" rules. Native speakers are welcome to challenge or extend these via a PR to this doc.

### English (`en`)

- **NZ English** spelling: colour, organisation, recognise, traveller. Not US English.
- **No em-dashes.** Use commas, semicolons, or standard hyphens. (Tim's hard rule.)
- **No exclamation marks** in player-facing UI copy. We're confident, not shouty.
- **"FIFA World Cup 2026™"** on first reference in any visible surface; subsequent references can say "the World Cup" or "the tournament".

### Spanish (`es`)

- Latin-American Spanish default. Targets Mexico, Argentina, Colombia, etc.
- **`tú` register**, not `usted`. We're talking to a peer who likes football, not addressing a customer service complaint.
- Use the **inverted question mark** ¿ and inverted exclamation ¡ correctly.
- Currency: keep the source currency code (NZD, BRL, etc.); the format is locale-aware via `Intl.NumberFormat`.

### Portuguese (Brazilian, `pt-BR`)

- Brazilian football terminology, not European: "técnico" (not "treinador"), "goleiro" (not "guarda-redes"), "zagueiro" (not "defesa central").
- Informal register (você, not o senhor).

### Portuguese (European, `pt-PT`)

- European Portuguese for Portugal + Cape Verde.
- "Guarda-redes", "treinador", "defesa central". Avoid Brazilianisms.

### French (`fr`)

- **`tu` register** for in-app copy, not `vous`. We're peers.
- Vous is acceptable for legal / disclaimer text where the formal register reads more credibly.
- Use the [non-breaking space](https://en.wikipedia.org/wiki/Non-breaking_space) before `:`, `;`, `?`, `!`, `%` per standard French typography: `Coupe du Monde 2026 :`, `OK ?` etc.

### German (`de`)

- **`Du` register**, not `Sie`. Peer register.
- Capitalise nouns correctly (this is German, not English).
- "Achtelfinale" (R16), "Viertelfinale" (QF), "Halbfinale" (SF), "Finale" (F). These are non-negotiable football terms.

### Italian (`it`)

- **`tu` register**.
- "Ottavi di finale" (R16), "Quarti di finale" (QF), "Semifinali" (SF), "Finale" (F).

### Dutch (`nl`)

- **`je` register**.
- "Achtste finale" (R16), "Kwartfinale" (QF), "Halve finale" (SF), "Finale" (F).

### Japanese (`ja`)

- **です/ます** polite-plain register. Not 敬語 (keigo).
- Use full-width punctuation 「」、。inside Japanese sentences.
- Football terms in katakana where common (バスケット, ボール, ファウル).

### Korean (`ko`)

- **합니다** formal register for UI labels; 해요 (slightly softer) is acceptable in helper text.
- Football terms in Hangeul transliteration where common (골 = goal, 어시스트 = assist).

### Arabic (`ar`)

- **Modern Standard Arabic**. Not Egyptian, not Gulf dialect.
- Right-to-left layout is automatic via `<html dir="rtl">`; you just write the values.
- Use **Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩)** ONLY in body prose; for player-facing scores, percentages, and dates we use Western (0123456789) for consistency across the leaderboard. (This is a deliberate Tournamental choice; some Arabic speakers will push back. Open to revisiting per the open question in the architecture doc.)
- "كأس العالم لكرة القدم 2026™" for the tournament name on first reference.

### Simplified Chinese (`zh-CN`)

- Mainland conventions, not Hong Kong (zh-HK) or Taiwan (zh-TW).
- Use **full-width punctuation** （，。「」） inside Chinese sentences.
- "国际足联世界杯 2026™" for the tournament name on first reference.

### Persian (`fa`)

- **Iranian Persian** (Tehran register). Not Dari (Afghanistan) or Tajik.
- Right-to-left layout via `<html dir="rtl">`.
- "جام جهانی فوتبال ۲۰۲۶™" for the tournament name.

### Turkish (`tr`)

- Use the Turkish dotless ı and dotted i correctly.
- "Son 32" (R32), "Son 16" (R16), "Çeyrek Final" (QF), "Yarı Final" (SF), "Final" (F).

### Croatian (`hr`)

- Latin script.
- "Osmina finala" (R16), "Četvrtfinale" (QF), "Polufinale" (SF), "Finale" (F).

### Bosnian (`bs`)

- Latin script. (Cyrillic Bosnian exists but is not our target.)
- Similar football terms to Croatian + Serbian; if in doubt match the BiH FA website's terminology.

### Czech (`cs`)

- Czech has FOUR plural cases: `one`, `few`, `many`, `other`. The validator will flag if you're missing any.
- "Osmifinále" (R16), "Čtvrtfinále" (QF), "Semifinále" (SF), "Finále" (F).

### Swedish (`sv`)

- "Åttondelsfinal" (R16), "Kvartsfinal" (QF), "Semifinal" (SF), "Final" (F).

### Norwegian (`no`)

- Bokmål, not Nynorsk.
- "Åttedelsfinale" (R16), "Kvartfinale" (QF), "Semifinale" (SF), "Finale" (F).

### Uzbek (`uz`)

- Latin script (Oʻzbekcha lotin), not Cyrillic.

### Hungarian (`hu`)

- Football terms follow Magyar Nemzeti Bajnokság (MNB) conventions.
- Hungarian agglutinates suffixes; expect translations to be ~20-30% shorter than English on average.

### Te Reo Māori (`mi`)

- Long vowels use macrons (ā, ē, ī, ō, ū), not double letters.
- Football is **whutupōro** in te reo; "pao" (kick) is the verb.
- When in doubt, use the [Te Aka Māori Dictionary](https://maoridictionary.co.nz/) as the canonical source.
- Use the standard Māori greeting "Kia ora" sparingly, only where the English source said "Hi" or "Hello".

## What to never translate

| Source | Why | Example |
| --- | --- | --- |
| "Tournamental" | Brand name | Always "Tournamental", never localised |
| "FIFA World Cup 2026™" on first reference | Trademark | After first reference, "the World Cup" can be localised |
| "WhatsApp", "Telegram", "Cloudflare", "Drips Network" | Third-party brand names | These stay English in every locale |
| Sponsor names | Sponsor agreement enforces | Whatever the sponsor's official mark says |
| Three-letter team codes (ARG, BRA, MEX, JPN, ...) | International convention | The full team name DOES get translated |
| Slugs, JSON keys, env vars, HTTP headers | Code identifiers | Never appear in user-facing copy anyway |

## ICU formatting cheatsheet

### Plurals

```json
"X.matches": "{count, plural, =0 {No matches} one {# match} other {# matches}}"
```

The `#` is the literal number substituted at runtime. The `=0` case is optional but recommended for "zero" content (don't render "0 members", render "No members yet").

### Selects (gender, type)

```json
"X.invite": "{gender, select, male {He's invited you to {pool_name}} female {She's invited you to {pool_name}} other {You've been invited to {pool_name}}}"
```

We rarely use gender; most invite copy is gender-neutral.

### Dates

The English source doesn't include date strings directly; the React component formats dates via `Intl.DateTimeFormat(locale, ...)`. You don't need to translate dates in the locale files.

### Numbers + currency

Same: handled at render-time by `Intl.NumberFormat`. Don't put "$10" in the locale file; let the component format it.

## Validation

Before pushing a PR, run:

```
pnpm i18n:validate
```

(Available after Phase 2 lands.) The script checks:

- Every locale has the same key set as `en.json`.
- ICU plural blocks include every case CLDR says the locale needs.
- No locale file has stray keys that aren't in `en.json` (likely a typo in the key).
- Brand-name preservation: "Tournamental", "FIFA World Cup 2026", etc. appear in every locale.
- Placeholder preservation: every `{name}` in `en.json` appears in your locale's matching key.

If any check fails, the validator prints a remediation hint. CI runs the same script on the PR.

## Reviewing a translation PR

If you're a maintainer reviewing a translation PR:

1. **Run the validator** (CI does this; trust CI).
2. **Spot-check 5-10 strings**. Are they idiomatic? Do they preserve placeholders and ICU syntax?
3. **Check the style rules** for that locale (above).
4. **Check brand terms** are preserved.
5. **Don't argue style with native speakers.** If the translator says "in Argentina we'd never say that", trust them and merge. We can revisit later via another PR.

## Adding a new locale (we don't ship)

A community contributor wants to add Welsh (`cy`). Process:

1. Fork the repo.
2. Open a discussion issue first: "Proposing Welsh (cy) as a supported locale". The discussion lets maintainers comment on coverage commitment (a new locale is a small ongoing maintenance load).
3. Once green-lit, create `apps/web/locales/cy.json` mirroring `en.json` keys.
4. Translate ALL keys, not just a subset.
5. Add `cy` to the `LOCALES` array in `apps/web/i18n/config.ts`.
6. Add the country mapping if Wales-specific (`GB-WLS` doesn't really exist as a Cloudflare country code; Welsh speakers will pick `cy` from the dropdown).
7. Add a style rules section to this doc.
8. PR with title `feat(i18n): add Welsh (cy) locale`.

The locale catalogue grows organically. There is no fixed ceiling.

## Compensation + credit

Tournamental is open source under Apache 2.0. Contributors:

- Get **GitHub credit** automatically (every PR shows up in your contributions).
- Get **named credit** in the `THANKS.md` file (any merged i18n PR auto-adds your name on the next release).
- Are **eligible for the Drips Network revenue share** for sustained contributions. See `docs/19-open-source-and-contributor-revenue.md`.

We don't pay per-string for translations. We DO recognise sustained, high-quality contributors via the Drips split when it kicks in.

## Help, questions, push-back

- Open a GitHub Discussion in the i18n category.
- Tag `@0800tim` in a PR comment for direct attention.
- Stand-out work gets a public thank-you in the launch announcements + the chance to be the named native-speaker reviewer for that locale going forward.
