# 20 — Identity, Humanness Score, and Bot Policy

> Multi-provider social login (Google, Apple, Facebook, X, LinkedIn, GitHub, Discord, WhatsApp, Telegram), native-app contacts integration, and a continuous **Humanness Score** that labels — but does not gate — every account on the platform. Bots are explicitly welcome and labeled; the goal is transparent separation of human and bot prediction skill, not bot exclusion.
>
> Builds on [doc 13](13-telegram-bot-and-auth.md) (which specced Telegram + email magic link + TOTP + passkey). This doc adds the social-graph layer and the humanness scoring.

## Design principles

1. **Identity is plural.** Users link as many providers as they want. More links = stronger humanness signal. We never *require* a specific provider.
2. **Humanness is continuous, not binary.** A score from 0 to 100, displayed publicly on profiles, derived from observable signals. Not a black-box trust score.
3. **Bots are first-class citizens.** Self-declared bots get a special account flavour, separate leaderboards, no penalty. We *want* to know how bots compare to humans.
4. **Friend graphs are core gameplay, not just analytics.** The friends leaderboard, in-person tournament watch parties, and the bot-vs-human comparison all depend on a mutual friend graph that's hard to fake.
5. **Anti-gaming is structural, not adversarial.** A user friending their own bots doesn't lift their humanness score because reciprocity must be cross-verified.
6. **Privacy by design.** We pull only what we need; users can revoke any provider at any time; we never sell personal data; nothing is bundled into ad-targeting.

## Provider matrix

For each provider, what signal it gives, what data we pull, and what it contributes to the Humanness Score.

| Provider | Humanness weight | Friend graph? | Account-age signal | What we pull | Notes |
|----------|------------------|---------------|--------------------|--------------|-------|
| **Google** | High (+15) | Optional via Google Contacts (consent) | Yes (`account_creation` not in OIDC; we proxy via email pattern + profile photo metadata) | name, email, profile photo, locale | Strongest humanness signal at zero cost. Google heavily invests in bot detection upstream of us. |
| **Apple Sign-In** | High (+15) | No | Yes | name (sometimes), email | Apple ID requires phone or trusted recovery; very low fraud rate. |
| **Facebook** | Medium (+10) | Yes (mutual friends only — Meta's API restriction) | Yes | name, email, profile photo, friend count, mutual friends with other Tournamental users | Friend graph is the killer feature here despite Meta's API decline. |
| **X (Twitter)** | Medium (+8) | Limited (following list, paid API tier) | Yes | name, handle, profile photo, account age, follower count | Bot detection here is weak; we trust the signal but weight it lower. |
| **LinkedIn** | High (+12) | Yes (1st-degree connections) | Yes | name, headline, profile photo, connections | High-trust for adult-professional users; less common context. |
| **GitHub** | Medium (+8) for everyone, +20 for Tournamental contributors | No | Yes | name, email, public profile, contribution graph | Proves real long-term human activity for devs. |
| **Discord** | Medium (+6) | Limited (mutual servers) | Yes | username, avatar, mutual servers | Strong for esports / streaming audience. |
| **WhatsApp** | Very High (+20) | Yes (via native app contact picker) | Yes (phone number age via WhatsApp's own checks) | phone number, profile photo, opt-in contact list | The single most predictive signal for "real human in real social network". Native app required. |
| **Telegram** | Medium (+8) — already required as primary auth in [doc 13](13-telegram-bot-and-auth.md) | Yes (via bot, with consent) | Yes | telegram_id, username, profile photo | Already in the stack. |
| **Email magic link** | Low (+2) | No | Domain age | email | Fallback only; barely contributes to humanness. |
| **Passkey (WebAuthn)** | Low (+3) but very high *fraud-resistance* | No | None | none | Doesn't prove humanness alone but proves session integrity. |
| **TOTP** | Zero (already authenticated) | No | None | none | Pure 2FA, doesn't shift humanness. |

A user who links Google + Apple + Facebook + WhatsApp + Telegram immediately has 68 points just from provider stacking. Add long account ages and friend reciprocity and they're easily 90+. A brand-new account with only email magic link sits at 2 — clearly low-humanness, but allowed to play. This is exactly the spectrum we want.

### Why we still want Telegram as primary

Telegram remains the recommended primary auth from [doc 13](13-telegram-bot-and-auth.md) because it's the free push channel and the bot is the centralised interaction surface. Social providers are *additive layers* that boost the Humanness Score and unlock friend-graph features; they're not the primary identity.

The auth picker order:
1. **Sign in with Telegram** (primary; gets you the bot relationship + push).
2. **Sign in with Apple / Google** (just as fast on supported devices; high humanness).
3. **Email magic link** (universal fallback).
4. **Passkey** (one-tap on supported devices).

After signing in, the profile page actively encourages linking more providers with a humanness gauge: *"You're at 28 — link Facebook to add 10 points and unlock friend leaderboards."*

## Native apps and contacts

The web app + Telegram bot are sufficient for many users, but the native iOS / Android apps unlock signals the web cannot:

- **Contacts API.** With explicit OS-level permission, the app reads the user's address book and looks up matches in Tournamental (by phone number hash or email hash — never raw values uploaded). Friend candidates surface in the app: "8 of your contacts already play Tournamental. Add them?"
- **WhatsApp contact picker.** Native iOS / Android share-sheets can hand a contact to the app, letting the user pick specific WhatsApp contacts to invite directly. Friction-light invite flow.
- **Push notifications outside Telegram.** Some users prefer not to use Telegram; native push lets us still reach them for goal alerts and prediction resolutions.
- **Background prediction reminders.** "You haven't predicted this match starting in 5 min" is far higher-conversion as a native push than a Telegram message for users who have the app pinned.
- **Location-aware city leaderboards.** With permission, native GPS unlocks the city-leaderboard placement (replacing the IP-derived geohash for users who opt in).

### The contact-hashing model

We never upload raw phone numbers or emails. The native app:

1. Reads the address book (with permission).
2. Hashes each contact's phone number (E.164 normalised + SHA-256 + a per-user salt).
3. Sends the hashes to Tournamental's API.
4. Server matches the hashes against existing user phone-number-hashes.
5. Returns the *user IDs* of matching Tournamental users.
6. App displays "8 of your contacts play Tournamental" with their Tournamental display names + avatars.

The salt is user-specific so Tournamental cannot cross-reference contacts across the user base. The hashes are stored in Redis with a 7-day TTL; recomputed on next contact-sync. Privacy reviewers can audit this; users can disable contact sync at any time.

This is the same pattern Signal, WhatsApp, and most contact-discovery features use.

## WhatsApp Business integration

Specifically valuable. Two integrations:

### A — WhatsApp account verification (humanness signal)

A user shares a WhatsApp message containing a one-time code we DM them to a designated Tournamental WhatsApp Business number. We confirm their phone number is theirs and that WhatsApp itself (Meta) has previously verified that number. Cost: ~$0.005 per verification message (template message rate). Worth it for a high-quality humanness signal on first-time users.

### B — In-WhatsApp friend invites and group leaderboards

Native iOS share-intent: the user picks "Invite via WhatsApp" → the OS hands a pre-filled WhatsApp message to their friends → friends tap and land on a Tournamental invite page. Conversion rate on this flow is dramatically higher than email or Telegram invite for any user with WhatsApp installed.

For group chats, WhatsApp Business API lets us mirror the Telegram group leaderboard pattern from [doc 13](13-telegram-bot-and-auth.md): a user invites the Tournamental bot into a WhatsApp group, the group becomes a private leaderboard, the bot posts results. Cost is non-zero (Meta's WhatsApp Business API is metered) but the humanness + viral mechanics justify it for engaged groups.

We will price-cap WhatsApp Business usage at ~$1,000/month for the first year and scale based on demonstrated cost-per-engaged-user.

## Humanness Score algorithm

A continuous score 0–100, displayed on every profile.

### Score components

```
humanness = base + provider_stack + friend_reciprocity + behavior_signals - bot_signals
```

Bounded to [0, 100].

### `base` (everyone starts somewhere)

```
0   if anonymous (no auth)
2   if email-only signup
5   if any single OAuth provider (low-quality like email-validated only)
```

### `provider_stack`

Sum of provider weights from the matrix, capped at 50. Diminishing returns past three high-weight providers (encourages diverse provider stacking, not provider-stacking-as-gaming).

### `friend_reciprocity`

The killer signal. Up to 30 points based on:

- **Mutual friend pairs that are *also* connected on a non-Tournamental social network.** A friendship that exists on Tournamental AND on Facebook AND on WhatsApp is much harder to fake than one that exists only on Tournamental.
- **Friend-network density** — how many of *your* friends are friends with *each other*. A real social graph has high local clustering; a bot ring tends to be a star (one centre, many edges to spokes that don't connect to each other).
- **Bidirectional interaction** — predictions made within the same matches as your friends, share-card forwards from a friend to you that you opened.
- **Time-extended consistency** — the friend has been your friend for >30 days, both predictions still active.

Score is not just "how many friends you have" — it's "how does your friend graph look compared to known-human friend graphs". A graph-theoretic comparison runs nightly.

### `behavior_signals` (up to 15)

Things that are hard for casual bots to fake:

- Prediction submissions distributed across waking hours of the user's stated time zone (humans sleep).
- Mix of pre-match and live predictions (humans tend to do both; bots often only one).
- Variable response times to the bot's prediction prompts (humans are inconsistent).
- App / bot interaction patterns (scrolling, tap timing, viewport changes — only available on native + web app, not API).
- Match-watching telemetry (the renderer reports "page focused while match was live"; bots that only call the API don't generate this).

These are *light-touch* behavioural signals, not dystopian biometrics. We never log keystrokes or mouse coordinates; just aggregate timing.

### `bot_signals` (up to −30)

Negative signals that lower humanness without binary-rejecting:

- API-only access (no web/app/bot interaction in 7+ days).
- Highly regular submission timing (low variance in seconds-from-prompt).
- IP / device matches another account (suggests one operator, multiple accounts).
- Wallet-address reuse across accounts (suggests the same controller).
- No outbound friendship requests after 30 days of activity.
- Many accepted incoming friend requests but no outbound — common for fake-friend-ring filler accounts.

Scores are recomputed nightly; the score on a profile is the latest snapshot.

### What humanness *doesn't* do

- It doesn't gate participation. Every user, including 0-humanness, can play, predict, win badges, climb leaderboards.
- It doesn't gate VStamps or Prediction IQ. Verification is independent.
- It doesn't show up on the prediction itself — only on the user's profile.
- It doesn't affect points scored. A bot calling Argentina at 18% gets the same 82 base points as a human.

It's a label, not a permission system.

## Bot policy — explicit and welcoming

Bots are welcome. Many users will run a bot as a research project, a creator-content vehicle, or just for fun. The rules:

### Self-declaration

Users can mark their account as a bot at any time in profile settings:

```
Account type:
  ( ) Human
  ( ) Bot — I run an automated agent that submits predictions on this account
  ( ) Mixed — I sometimes use this account manually, sometimes via automation
```

A self-declared bot account:
- Gets a small bot icon next to its display name everywhere on the platform.
- Lives on the **Bot Leaderboards** in addition to the global / country / city / friend boards.
- Is *encouraged* to publish its strategy in profile bio (a researcher's "this is my Polymarket-arbitrage bot" is celebrated content).
- Has full access to the same API surface as any user; no rate-limit penalty.
- **Earns a small honesty bonus**: +1% on all points awarded, in recognition of self-declaration.

### Detection of undeclared bots

For accounts that we suspect are bots but haven't self-declared, the system applies the negative `bot_signals` to their humanness score but does not auto-flip their account type. Users are nudged via the bot:

> *"We've noticed your activity pattern looks automated. If you're running a bot, you can mark your account as one in settings — bots are welcome here, and self-declared bots get a small honesty bonus on points."*

After 30 days of continued bot-pattern activity without declaration, the account is flagged with a small *suspected-bot* indicator on the profile (visually distinct from the *self-declared bot* indicator). This is a soft signal, not a ban.

### Three leaderboards instead of one

Every leaderboard has three flavours:

- **Combined** (default — all accounts mixed).
- **Humans only** (filters out self-declared and suspected bots).
- **Bots only** (just the self-declared and suspected bots).

Users pick which view they want. The Bots-only leaderboard is genuinely interesting content — a public competition between automated strategies on real markets. Likely a draw for crypto-native and quant-flavoured audiences.

### Anti-gaming

- Bot ring detection (graph analysis): a star pattern with one human and many declared bots that all friend each other is normal. A star pattern where the *centre* claims to be human and all spokes are pretending to be human and all only friend the centre — classic bot ring. Caught by graph clustering checks.
- Bot accounts cannot push their owner's humanness score up via the friend-reciprocity layer. The `friend_reciprocity` calculation excludes friend-ships where the friend is bot-flagged.
- Cross-provider phone-number-uniqueness check at signup: if a phone number is already linked to another account, the new account can't claim that phone-based humanness.

## API for third-party integrations

A read-only public API endpoint exposes humanness:

```
GET /api/users/:id/humanness
{
  "user_id": "u_01HX...",
  "humanness_score": 76,
  "tier": "human",                       // "human" | "mixed" | "bot" | "unknown"
  "self_declared_bot": false,
  "suspected_bot": false,
  "providers_linked": ["telegram", "google", "apple", "whatsapp", "facebook"],
  "humanness_updated_at": "2026-05-09T03:00:00Z"
}
```

Useful for:
- Third-party analytics tools that want to filter bot prediction data out of "wisdom of the crowd" calculations.
- Sponsors that want to require humanness > 50 for entry to a sponsored challenge.
- Sportsbook affiliate partners that may want humanness-filtered traffic for premium CPA tiers.

## Privacy and user controls

In one place — accessible from any profile screen — the user can:

- Disconnect any linked provider (humanness re-scores immediately).
- Wipe imported contacts (server deletes hashes; Redis TTL takes care of stale).
- Switch between Human / Bot / Mixed account type.
- Export all stored data (GDPR / CCPA standard).
- Delete account (hard delete after a 30-day undo window).
- View their humanness-score breakdown so they can see *why* they're at the score they are.

The breakdown view is genuinely useful for users — and it makes the system feel transparent, not Kafkaesque.

## Data shapes (Redis, with snapshots to CDN)

```
user:<id>                       → public profile blob (humanness fields included)
auth_links:<user_id>            → set of {provider, provider_user_id, linked_at}
provider_lookup:<provider>:<id> → user_id (for OAuth resolution)
phone_hash:<sha256>             → user_id (with salt rotation)
contacts:<user_id>              → set of contact-hash → matched_user_id (24h TTL)
humanness_history:<user_id>     → ZSET (timestamp → score), 90-day window
friendship_graph                → external graph DB (Neo4j / Memgraph / DuckDB on
                                  parquet) for nightly graph-analysis jobs
```

The friendship graph is heavy enough that a small graph DB is worth it; we use it for the friend-reciprocity calculation only. Day-to-day reads still come from Redis sets.

## Sequencing — what to ship first

**v0.1 (renderer + game core launch).** Telegram + email magic link + passkey (already specced in [doc 13](13-telegram-bot-and-auth.md)). No Humanness Score yet; everyone displays as "human" by default.

**v0.2 (multi-provider OAuth).** Add Google + Apple + Facebook OAuth. Compute Humanness Score with provider-stack + behaviour signals only (no friend reciprocity yet). Display on profiles.

**v0.3 (friend graph).** Add X / LinkedIn / GitHub / Discord / WhatsApp providers. Native iOS / Android apps with contacts integration. Friend reciprocity layer in the score.

**v0.4 (bot policy).** Self-declaration UI; suspected-bot detection; three-flavour leaderboards. Anti-gaming graph analysis nightly.

Each step is independently shippable.

## Acceptance criteria

- [ ] User can link 5+ providers from a single profile screen with no provider taking >30s to connect.
- [ ] Humanness Score breakdown view is correct, complete, and updates within 5 minutes of a provider change.
- [ ] Native app contacts sync surfaces matched friends in <2s for a 500-contact address book.
- [ ] Bot self-declaration is reversible at any time (a user who switches mid-tournament keeps their existing predictions).
- [ ] Three-flavour leaderboards (Combined / Humans / Bots) all render in <300ms from CDN JSON.
- [ ] Friend ring detection identifies a planted-bot-ring of 5 accounts in nightly testing.
- [ ] Phone-number-hash store is salted, never reversible, and TTL'd appropriately.
- [ ] Privacy controls (export, delete, disconnect) work without an email-to-support handoff.

## Sources

- [Sign in with Apple — REST API](https://developer.apple.com/documentation/sign_in_with_apple/)
- [Google Identity — OAuth 2.0 / OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
- [Facebook Login (Limited Login) for friend graph](https://developers.facebook.com/docs/facebook-login/)
- [LinkedIn OAuth + connections API](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication)
- [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Signal / WhatsApp contact-discovery hashed-PSI primer](https://signal.org/blog/private-contact-discovery/)
