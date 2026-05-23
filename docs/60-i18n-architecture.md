# 60, Internationalisation architecture

> Authoritative reference for how Tournamental ships in 22 languages. Where every locale file lives, how the detection chain works, how a contributor adds or improves a translation, and what the boundaries are around brand terms, trademark, and tournament-specific copy.

This is the architectural plan. The contributor-facing how-to lives in [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md). The user-facing announcement is the blog post `apps/marketing/src/content/blog/2026-05-24-translators-call.mdx`.

## What we're building

Tournamental ships English-only today. The 2026 FIFA World Cup&trade; brings players from every qualifying nation onto the same leaderboard. We want each of those players to read the picks page, the share landing, the OG cards, the join modal, and the marketing site in a language they are comfortable with, with a sensible default that does not require them to find the dropdown first.

The shape of the change:

1. Every user-facing string moves out of `.tsx` / `.astro` source and into a per-locale JSON file under a `locales/` directory.
2. A detection chain in middleware resolves the right locale on every request, no client-side flash, no wrong-language paint.
3. A `LocalePicker` dropdown sits in the AppBar (web) and the burger drawer (mobile + marketing) so users can override the auto-detect.
4. Translations are produced by Claude in a one-shot batch session, with ongoing diffs handled the same way. There is no third-party translation API spend.

Two apps need this. `apps/web` (Next.js 14 App Router) uses [`next-intl`](https://next-intl.dev). `apps/marketing` (Astro 4) uses Astro's built-in i18n. `apps/auth-sms` has a handful of user-facing strings (OTP message body, email subject) and uses a tiny in-process lookup keyed on the locale that the web app passes through on the OTP request.

## The supported locale catalogue (22 locales)

The catalogue is the union of:

- A language spoken in every one of the 48 nations qualified for FIFA World Cup 2026™.
- Spanish + Portuguese variants (pt-BR vs pt-PT) because the brands and idioms diverge enough.
- Hungarian and Te Reo Māori (explicit additions; Hungary is not qualified but the diaspora is large, Māori is a co-official language of New Zealand).
- Simplified Chinese (zh-CN) even though China is not qualified, because the Chinese-speaking diaspora across qualified nations is significant.

| Locale | Native name | Notes | RTL? | ICU plural rules |
| --- | --- | --- | --- | --- |
| `en` | English | The source of truth. Every other file mirrors its keys. | no | `one`, `other` |
| `es` | Español | Latin-American Spanish default; targets MEX, ARG, COL, URU, PAR, ECU + ESP. Use the *tú* register, not *usted*. | no | `one`, `other` |
| `pt-BR` | Português (Brasil) | Brazilian Portuguese. Footballing terminology follows Globo Esporte / SporTV conventions. | no | `one`, `other` |
| `pt-PT` | Português (Portugal) | European Portuguese for Portugal + Cape Verde. Differs from pt-BR on tense formality and a handful of football terms. | no | `one`, `other` |
| `fr` | Français | France + Belgium (fr) + Canada (fr) + Côte d'Ivoire + Senegal + Haiti + DR Congo + Maghreb teams who default to fr. | no | `one`, `other` (large numbers per CLDR) |
| `de` | Deutsch | Germany + Austria + Switzerland (de). Use *Du* register for player-facing copy. | no | `one`, `other` |
| `it` | Italiano | Italian Switzerland (Ticino). Tournament-specific terminology follows Gazzetta dello Sport conventions. | no | `one`, `other` |
| `nl` | Nederlands | Netherlands + Belgium (nl) + Curaçao. | no | `one`, `other` |
| `ja` | 日本語 | Japan. Default to plain/polite (です/ます) register, not honorific. | no | `other` only |
| `ko` | 한국어 | South Korea. 합니다 (formal) register. | no | `other` only |
| `ar` | العربية | Modern Standard Arabic. Covers KSA, EGY, MAR, ALG, TUN, IRQ, JOR, QAT. | **yes** | `zero`, `one`, `two`, `few`, `many`, `other` |
| `zh-CN` | 中文（简体） | Simplified Chinese. Mainland conventions. | no | `other` only |
| `fa` | فارسی | Iranian Persian (not Dari, not Tajik). Standard Tehran register. | **yes** | `one`, `other` |
| `tr` | Türkçe | Turkey. | no | `one`, `other` |
| `hr` | Hrvatski | Croatia. | no | `one`, `few`, `other` |
| `bs` | Bosanski | Bosnia and Herzegovina. Latin script. | no | `one`, `few`, `other` |
| `cs` | Čeština | Czechia. | no | `one`, `few`, `many`, `other` |
| `sv` | Svenska | Sweden. | no | `one`, `other` |
| `no` | Norsk (Bokmål) | Norway. Bokmål, not Nynorsk. | no | `one`, `other` |
| `uz` | Oʻzbekcha | Uzbekistan. Latin script. | no | `one`, `other` |
| `hu` | Magyar | Hungary (diaspora). | no | `one`, `other` |
| `mi` | Te Reo Māori | New Zealand co-official. Used for the Aotearoa / NZ audience that wants it. | no | `one`, `other` (rough; see CLDR `mi`) |

**Total: 22 locales.** RTL layout flips on `ar` and `fa`.

## Filesystem layout

```
apps/web/
  locales/
    en.json                # source of truth
    es.json                # mirror of en.json keys, Spanish values
    pt-BR.json
    pt-PT.json
    fr.json
    de.json
    it.json
    nl.json
    ja.json
    ko.json
    ar.json
    zh-CN.json
    fa.json
    tr.json
    hr.json
    bs.json
    cs.json
    sv.json
    no.json
    uz.json
    hu.json
    mi.json
  i18n/
    config.ts              # next-intl config + locale list export
    middleware.ts          # locale-resolution helpers used by middleware.ts
    country-locale.ts      # ISO country code → locale code table

apps/marketing/
  src/
    locales/
      en.json              # marketing-specific strings (longer prose)
      ... (22 locale files, same keys as en.json)
    i18n/
      config.ts
```

The marketing site has its own `locales/` because its content (blog, press releases, longer prose) is distinct from the play app. Headers and footers are shared via a small `packages/i18n-shared/` workspace package that lives at the repo root and exposes the locale catalogue + the country-locale table to both apps.

## Detection chain

Every request walks this list and stops at the first hit. The middleware runs on the edge (Cloudflare → Vercel-style edge runtime) so it adds <5ms to the request.

1. **Explicit URL prefix.** `play.tournamental.com/fr/world-cup-2026` always wins. This is the canonical shareable URL. If the visitor's auto-detected locale differs from the URL, we leave the URL alone and update the cookie. URL wins, no flash.
2. **`vt_locale` cookie.** Set by the LocalePicker dropdown. Persists for 1 year on `.tournamental.com` so it covers the play app, the marketing site, and `auth.tournamental.com`. `SameSite=Lax` so the cookie comes through on subdomain navigations.
3. **`CF-IPCountry` header.** Cloudflare emits this on every request. We look up the country in `country-locale.ts` and use the resulting locale. Multi-language countries default to the dominant business language (CH → de, BE → nl, CA → en); a banner shown on the first visit invites those users to switch via the dropdown.
4. **`Accept-Language` header.** Browser preference. We honour the first supported locale in the user's list, including subtag matching (`pt-PT` accepts `pt`, `pt-BR` etc.).
5. **`en` fallback.** Always.

```ts
// apps/web/i18n/middleware.ts (sketch)
export function resolveLocale(req: NextRequest): Locale {
  const url = new URL(req.url);
  const prefix = url.pathname.split("/")[1] as Locale | undefined;
  if (prefix && LOCALES.includes(prefix)) return prefix;

  const cookie = req.cookies.get("vt_locale")?.value as Locale | undefined;
  if (cookie && LOCALES.includes(cookie)) return cookie;

  const cf = req.headers.get("cf-ipcountry") ?? "";
  const fromCountry = COUNTRY_LOCALE[cf];
  if (fromCountry) return fromCountry;

  const accept = req.headers.get("accept-language") ?? "";
  const fromAccept = pickFromAcceptLanguage(accept, LOCALES);
  if (fromAccept) return fromAccept;

  return "en";
}
```

The middleware rewrites internal URLs to the prefixed form so the rest of the stack only ever sees `/fr/world-cup-2026`, never the bare `/world-cup-2026`. This eliminates the cache-poisoning class of bug where one visitor's locale leaks into another visitor's cached response.

## Country → locale mapping

The 48-nation lookup is in `apps/web/i18n/country-locale.ts`. The full table is below; multi-language defaults are commented inline. Add a country here and the auto-detect picks it up on the next deploy.

| ISO | Country | Default locale | Why |
| --- | --- | --- | --- |
| MX | Mexico | `es` | |
| US | United States | `en` | |
| CA | Canada | `en` | Quebec users select `fr` via dropdown |
| BR | Brazil | `pt-BR` | |
| AR | Argentina | `es` | |
| CO | Colombia | `es` | |
| UY | Uruguay | `es` | |
| PY | Paraguay | `es` | |
| EC | Ecuador | `es` | |
| ES | Spain | `es` | |
| PT | Portugal | `pt-PT` | |
| CV | Cape Verde | `pt-PT` | Crioulo speakers fall through; pt-PT is the official language |
| FR | France | `fr` | |
| BE | Belgium | `nl` | Wallonia users select `fr` via dropdown |
| CH | Switzerland | `de` | Romandy users select `fr`; Ticino selects `it` |
| DE | Germany | `de` | |
| AT | Austria | `de` | |
| IT | Italy | `it` | |
| NL | Netherlands | `nl` | |
| CW | Curaçao | `nl` | |
| JP | Japan | `ja` | |
| KR | South Korea | `ko` | |
| SA | Saudi Arabia | `ar` | |
| EG | Egypt | `ar` | |
| MA | Morocco | `ar` | |
| DZ | Algeria | `ar` | |
| TN | Tunisia | `ar` | |
| IQ | Iraq | `ar` | |
| JO | Jordan | `ar` | |
| QA | Qatar | `ar` | |
| IR | Iran | `fa` | |
| TR | Türkiye | `tr` | |
| HR | Croatia | `hr` | |
| BA | Bosnia and Herzegovina | `bs` | |
| CZ | Czechia | `cs` | |
| SE | Sweden | `sv` | |
| NO | Norway | `no` | |
| UZ | Uzbekistan | `uz` | |
| HU | Hungary | `hu` | |
| NZ | New Zealand | `en` | Māori speakers select `mi` via dropdown |
| ZA | South Africa | `en` | |
| AU | Australia | `en` | |
| GB | United Kingdom | `en` | |
| (other countries) | | `en` | Default catch-all |

48-country coverage but only ~25 countries appear; the rest default to one of the same 22 locales.

## ICU MessageFormat

Every string with a count or a date uses ICU MessageFormat so per-locale rules work natively. Example for the join-modal "members" line:

```json
{
  "syndicate.members": "{count, plural, =0 {No members yet} one {# member} other {# members}}"
}
```

Russian, Arabic, Czech, Polish, and Slovenian have multiple plural forms. ICU handles all of them. The translator does not need to remember which language has six plural forms; the format names the cases explicitly (`zero`, `one`, `two`, `few`, `many`, `other`).

Dates use `Intl.DateTimeFormat`:

```ts
new Intl.DateTimeFormat(locale, { dateStyle: "long" })
  .format(new Date("2026-06-11"));
// en: 11 June 2026
// fr: 11 juin 2026
// es: 11 de junio de 2026
// ja: 2026年6月11日
```

Currency uses `Intl.NumberFormat` with the entry-fee currency (`NZD`, `BRL`, `EUR`, etc.) as the format target. The locale picks the digit grouping and decimal separator; the currency code stays as the source value on the pool.

## RTL handling

Arabic and Farsi flip the page direction. The middleware sets `<html dir="rtl" lang="ar">` on the response. The CSS sweep is small:

- Every component that uses physical `margin-left` / `padding-right` / `text-align: left` switches to logical properties (`margin-inline-start`, `padding-inline-end`, `text-align: start`).
- Icons that point one direction (arrows, chevrons) get a CSS flip in RTL: `[dir="rtl"] .vt-arrow { transform: scaleX(-1); }`.
- The AppBar's flex order does not change; flexbox is direction-aware by default.

The first RTL sweep happens once `en.json` extraction is complete; the components touched are mostly the AppBar, the LocalePicker, the join modal, and the leaderboard. The bracket builder is mostly icon-free and works correctly under RTL today.

## OG card localisation

The satori-rendered OG cards (`/api/og/bracket`, `/api/og/syndicate`, `/api/og/leaderboard`, `/api/og/bracket-birdseye`) all currently render English-only labels (R32, QF, SF, CHAMPION, etc.). When a card is shared from a non-English session, the URL carries `?locale=fr` and the satori tree reads localised labels from a small `apps/web/lib/og/og-strings.ts` table.

The card sizes and layouts stay identical across locales; only the text strings + the dateline tournament-name suffix change. Fonts already include CJK and Arabic via DejaVu Sans / Noto fallback.

## Performance + cache

- Each locale ships its own JSON, loaded once per session. Average file size is ~10-20KB gzipped, so a cold load is one small request. The bundle is code-split so the user only ever downloads their locale.
- The middleware writes `Vary: Accept-Language, Cookie` to the response so CDN cache keys differentiate locales correctly. URL-prefixed pages (which most are after rewrite) cache fine because the path already encodes the locale.
- The OG card endpoints take `?locale=` as a cache key, so each locale gets its own cached PNG.

## What we do NOT translate

- **Brand names.** "Tournamental" stays Tournamental in every locale. Same for "WhatsApp", "Telegram", "Cloudflare", "Drips Network", etc.
- **FIFA tournament name.** The phrase "FIFA World Cup 2026™" stays exactly that on first reference per locale, with the trademark symbol. Subsequent references can use a localised "the World Cup" / "la Coupe du Monde" / etc.
- **Sponsor names.** Whatever the sponsor signed off in their sponsor agreement.
- **Three-letter team codes.** ARG, BRA, MEX, JPN, etc. stay as-is. The locale-specific full team name does get translated, but the codes are international.
- **Code identifiers.** Slugs, JSON keys, environment variables, HTTP headers stay English-only.

## Phasing

| Phase | Scope | When |
| --- | --- | --- |
| **P1: docs + scaffolding** | This doc; the contributor guide; the blog post; install next-intl; create the `locales/` directory; ship a working `en.json` with the top-nav + home hero + odds page + auth modal strings; build the LocalePicker; wire the detection chain. Dev only. | This session |
| **P2: string extraction** | Sweep every component for hardcoded text. Replace with `t("key")` via next-intl hooks. Organise `en.json` by surface. | Next session |
| **P3: 22 locale translations** | One Claude session: produce all 22 locale files in one batch, commit. | After P2 |
| **P4: RTL polish** | Convert physical to logical CSS properties on the small set of components that need it. Audit ar + fa under `<html dir="rtl">`. | After P3 |
| **P5: OG card locale labels** | Localise the satori-rendered card labels. Pass `?locale=` through every share URL. | After P4 |
| **P6: marketing site i18n** | Astro built-in i18n for the marketing pages. Reuse the same `country-locale.ts` table via the shared workspace package. | After P5 |

Phases 1-3 are the minimum viable "the play app speaks 22 languages" milestone. 4-6 are polish.

## Contributor flow

A community translator who wants to improve the French copy:

1. Forks the repo, clones, runs `pnpm install`.
2. Opens `apps/web/locales/fr.json`.
3. Improves the value for a key. Keys NEVER change in a translation PR.
4. Optional: runs `pnpm i18n:validate` (script in P2) which checks every locale has the same key set as `en.json` and warns on missing ICU `other` clauses.
5. Opens a pull request titled `i18n(fr): improve <surface> copy`.
6. CI runs the validator on the PR. Reviewer is whichever maintainer has the locale's native-speaker flag.
7. Merged → next deploy ships the improved copy.

See [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md) for the full step-by-step.

## Why we are not using a SaaS translation tool

- Crowdin / Lokalise are excellent for 100+ language enterprise products. For a 22-locale single-developer project with a small founding contributor pool, the overhead (separate account, separate dashboard, separate PR flow) is larger than the value.
- Google Translate / DeepL APIs cost money per character and produce literal translations that miss brand voice + football-specific idiom.
- Claude (the AI you are reading this from) produces the initial 22-locale set as part of a normal chat session. Cost: zero marginal dollars beyond the Anthropic subscription. Quality: high enough that human contributors can correct + refine via PRs.

## Open questions

1. **Region pickers**. For locales like English-NZ vs English-US (date formatting and spelling), do we ship `en` only and let the dropdown surface a sub-region preference, or do we ship `en-NZ` and `en-US` as separate files? Recommendation: keep `en` as one file, use `Intl.DateTimeFormat(navigator.language)` for date locales, accept that "color" vs "colour" follows the team's choice (NZ English wins; consistent with the rest of the codebase).
2. **A future Welsh / Catalan / Basque request**. Community-driven; if a translator PRs a high-quality `cy.json`, we accept it and add it to the catalogue. The architecture supports unlimited additional locales; nothing in the code hardcodes the 22 number.
3. **Right-to-left mirror for the bracket tree**. The current tree visually flows left-to-right (group stage on the left, final on the right). In RTL languages should the tree flow right-to-left? Open call; the safe default is to keep the tree direction LTR even under RTL HTML (the bracket is a sport convention, not a reading convention), with the surrounding chrome flipped.

## Cross-references

- Contributor how-to: [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md)
- Brand voice rules: [15-tournamental-brand-and-positioning.md](15-tournamental-brand-and-positioning.md)
- Launch announcement: `apps/marketing/src/content/blog/2026-05-24-translators-call.mdx`
- next-intl docs: https://next-intl.dev
- Astro i18n docs: https://docs.astro.build/en/guides/internationalization/
- CLDR plural rules (per locale): https://unicode-org.github.io/cldr-staging/charts/47/supplemental/language_plural_rules.html
