# Tournamental Launch Playbook

> **Goal**: get the open-sourced-everything story in front of every audience that should care, in the right order, in the right voice, with the right artefacts. Designed to be executed by one person (Tim) over 48 hours.

The story has a unique hook the wider builder community has not yet seen:

> *Most projects open-source their code. Tournamental open-sources the **entire idea**, bracket app, 3D match renderer, blockchain prediction-receipts, marketing site, business model, affiliate splits, brand book, design docs, late-night decision logs. Built solo with Claude over a long week. Apache 2.0. Day one.*

Lead with the strangeness. The audiences below all have heard "we open-sourced our code" too many times to care. They haven't heard "I open-sourced my edge."

---

## 0. Pre-flight (do once before any posting)

- [ ] Repo public, README links work, `LICENSE` is Apache 2.0
- [ ] `play.tournamental.com` resolves and the bracket loads without errors
- [ ] Press release live at `tournamental.com/press/2026-05-12-everything-open-source/`
- [ ] Hero image rendered at `/press/2026-05-12-everything-open-source-hero.jpg`
- [ ] Short demo video (30–60 sec) recorded: open bracket → make picks → 3D renderer cameo → "all of this is on GitHub" tag-out. Upload to YouTube **unlisted** + grab the URL.
- [ ] Twitter/X handle confirmed (`@tournamental` or whatever's chosen)
- [ ] One canonical short link to the repo: `https://github.com/0800tim/tournamental` (or set up a redirect at `tournamental.com/code`)
- [ ] A pinned tweet drafted (see §3 below)

---

## 1. Tech blogs, pitch templates

Send **personalised** emails. Generic mass-blasts get filed under spam. Order matters: hit the AI-builder press first, where the story has the most native fit.

### 1a. Primary AI-builder publications (send first, day 1)

| Outlet | Contact | Why this story fits |
| --- | --- | --- |
| **The Pragmatic Engineer** (Gergely Orosz) | `news@pragmaticengineer.com` + DM on X | Build-log content sweet spot; loves real numbers + honest failures |
| **Latent Space** (Swyx) | newsletter@latent.space | AI-builder community of record; the "I built this with Claude" angle is their wheelhouse |
| **TLDR Newsletter** (AI edition) | `dan@tldrnewsletter.com` | High-volume reach; needs a 2-sentence summary + link |
| **AI Snake Oil** (Arvind Narayanan) | DM via Substack | Critical lens, but if they cover it the audience trusts it |
| **The Rundown AI** | `team@therundown.ai` | Volume play; cover anything with a hook + screenshot |

**Pitch email, primary AI-builder send:**

> Subject: *I open-sourced my entire startup idea, not just the code, before launch. Built solo with Claude in a week.*
>
> Hi [name],
>
> I'm Tim Thomas, founder of Tournamental, a tournament-prediction platform for the 2026 World Cup. We launch publicly tonight, but the genuinely odd thing isn't the product. It's that I've put the **entire idea** on GitHub before any user has signed up.
>
> The code is open. The 27 design docs are open. The business model is open. The marketing site is open. The Drips Network contributor-revenue plumbing is open. The 90+ session notes documenting every architectural reversal across the build are open. Apache 2.0 for code, CC-BY 4.0 for docs. Day one.
>
> Built solo over 72 hours of focused work with Claude as the engineering partner, up to 12 parallel agent sessions at peak, coordinated by a `CLAUDE.md` orchestrator protocol that's also part of the open-sourced material. Contributors get paid in real time on Ethereum mainnet via Drips Network. No invoices, no negotiation.
>
> The thesis: in an AI-fluent world, keeping an idea private doesn't protect it, it just slows the version that ships first. Tournamental tests the opposite bet, hard.
>
> Repo: https://github.com/0800tim/tournamental
> Press release: https://tournamental.com/press/2026-05-12-everything-open-source
> Live product: https://play.tournamental.com
> 60-sec demo: [unlisted YouTube link]
>
> Happy to do a 20-minute call, a recorded walkthrough of the build pattern, or just hand over screenshots and quotes. The press release is liftable verbatim if useful.
>
> Tim
> +64 [phone]
> press@tournamental.com

### 1b. Mainstream tech press (send day 2, with reach from §1a as social proof)

| Outlet | Angle | Contact |
| --- | --- | --- |
| **TechCrunch** | "Solo founder, AI engineering partner, the entire business public on day one", angle: the new economics of consumer product launches | `tips@techcrunch.com` |
| **The Verge** | Sports + crypto + AI intersection, blockchain-verified predictions for WC 2026 | `tips@theverge.com` |
| **Wired** | The bet against trade secrets in the AI era | `pitches@wired.com` |
| **Decoder podcast (Nilay Patel)** | If §1a hits, pitch a podcast slot, the meta-story (open-sourcing strategy) is Nilay's beat | `decoder@theverge.com` |
| **404 Media** | Independent angle: indie builder vs. big platforms | `tips@404media.co` |
| **Hacker News** | Self-submit; pinned story can do 50k visits in 24h | n/a, see §4 |

### 1c. Sports-tech and prediction-market press (send day 2)

| Outlet | Why |
| --- | --- |
| **Sports Business Journal** | The broadcaster-facing pitch: trustless WC 2026 prize draws |
| **Sportico** | Same |
| **Polymarket / Kalshi blog mentions** | If you pitch them an integration, they often blog about partners |
| **Front Office Sports** | The "fan-engagement product, but open" frame |

---

## 2. Reddit launch

Reddit is the highest-leverage single channel for an AI-builder story. Get the *order* right.

### Order of operations

1. **Day 1, morning UTC**, `/r/programming` with a build-log-flavoured title (see below). Self-text post, not link-only.
2. **Day 1, +4h**, `/r/SideProject` with a "show & tell" framing.
3. **Day 1, +8h**, `/r/ClaudeAI`, the "built solo with Claude over 72 hours" angle. Native fit.
4. **Day 2**, `/r/LocalLLaMA` (if you have an angle about the orchestrator pattern that doesn't require Claude specifically), `/r/MachineLearning` (only if you have a real engineering deep-dive, otherwise skip), `/r/opensource`.
5. **Day 2 PM**, sports-fan subs: `/r/soccer`, `/r/worldcup`, but ONLY pitching `play.tournamental.com`, not the meta-story. They'll downvote a developer-flavoured post on sight.

### Title templates (use 1, don't reuse the same one)

- `I open-sourced my entire startup, not just the code, the marketing site, the business model, the failure logs, before launching it. Here's why and what's in the repo.`
- `Built a 3D bracket-prediction platform solo with Claude in 72 hours, then put the whole idea on GitHub. The bet: AI-fluent builders fork it and ship a better version by next weekend.`
- `Show HN-style writeup: open-sourcing the *idea*, not just the implementation, before a startup has a single user.`
- `Tournamental is launching tonight. The product is a bracket-prediction game for WC 2026. The unusual part: I open-sourced the brand book, business model, and revenue model along with the code. Apache 2.0. Day one.`

### Reddit body, copy-paste base

```
Hey everyone, I'm Tim, solo founder of Tournamental. Going live tonight.

What we built: a bracket-prediction platform for the FIFA World Cup 2026, with a 3D match-renderer for watch-along viewing and blockchain-anchored "prediction receipts" so every pick is independently verifiable as having been made before kickoff.

The unusual bit: I've open-sourced the **entire** idea before launch. Not just the code (Apache 2.0). Also:
- 27 design docs, including the scoring algorithm, the on-chain pool design, the affiliate split formula
- The marketing site, brand book, and press releases
- 90+ session notes, every architectural decision, every dead-end I reversed, every late-night call I made
- The CLAUDE.md orchestrator protocol I used to coordinate up to 12 parallel agent sessions at peak

Repo: https://github.com/0800tim/tournamental
Live: https://play.tournamental.com
Press release: https://tournamental.com/press/2026-05-12-everything-open-source

The thesis is that in an AI-fluent world, keeping the idea private no longer protects it, it just slows the version that ships first. Easier to test the opposite bet hard.

Happy to answer anything about the build pattern, the parallel-agent dispatching, the scoring engine, the Drips Network contributor-revenue plumbing, or why I think this is the right move. Ask me anything.
```

### Reddit-specific rules to NOT trip

- **Don't ask for upvotes.** Mods nuke that on sight.
- **Don't post the same text in 5 subs in 5 minutes.** Spread over hours.
- **Engage in the comments for the first 90 minutes.** Reddit's ranking algorithm weights early comment velocity hard. If you ghost, the post dies.
- **Use the AMA flair** on `/r/SideProject` and `/r/ClaudeAI` if it's available; it signals you'll show up.

---

## 3. X (Twitter)

Lead the X play yourself; you have the original voice. Pinned thread, daily follow-ups for 7 days.

### Pinned thread, Day 1

Open with the hook, then unspool. Keep each tweet under 270 chars so they share cleanly.

```
Tweet 1 (the hook):
I open-sourced my entire startup tonight.

Not just the code.
The 27 design docs.
The business model.
The marketing site.
The brand book.
The 90+ session notes covering every reversal, every dead-end.

Apache 2.0. Day one. Before a single user has signed up.

Here's why ↓

Tweet 2:
The product is Tournamental, a bracket-prediction game for the 2026 FIFA World Cup, with a 3D match-renderer for watch-along, and blockchain-anchored prediction receipts so every pick is independently verifiable.

But the product isn't the story.

Tweet 3:
Built solo over 72 hours of focused work with Claude as the engineering partner.

Up to 12 parallel agent sessions at peak. One orchestrator (me), one CLAUDE.md protocol, one spec-as-contract rule.

That single rule killed 80% of merge conflicts I expected.

Tweet 4:
The bet:

In an AI-fluent world, keeping an idea private doesn't protect it.

It just slows the version that ships first.

So: open everything. Let a thousand AI-fluent builders fork it on day one and ship a better version by day three.

Tweet 5:
Contributors get paid.

Tournamental routes platform revenue to GitHub identities automatically via Drips Network on Ethereum mainnet. Auditable. Continuous. No invoices, no negotiation.

The split is in the repo. The on-chain wallets are public.

Tweet 6:
What's open?
✅ Apps: bracket, renderer, marketing site, auth-sms
✅ Packages: bracket-engine, plugin-sdk, spec
✅ Docs: scoring, on-chain pool, affiliate splits, brand book
✅ Process: 90+ session notes, CLAUDE.md, AGENT-PROMPTS.md

Apache 2.0 + CC-BY 4.0. github.com/0800tim/tournamental

Tweet 7 (CTA):
If you build with AI agents, clone it, run it, fork it, improve it.
If you write about AI, the press release is liftable verbatim, the repo is your call-out box.
If you make videos or podcasts, I will give you a build-log walkthrough on camera, no NDA.

Email: press@tournamental.com
```

### Daily follow-up tweets (days 2–7)

One per day, drip-feeding angles. Each ends with the repo link.

- **Day 2**, "Here's the orchestrator pattern that ran 12 parallel agents without merge chaos: [link to CLAUDE.md in repo]"
- **Day 3**, "The scoring engine rewards underdog picks with a multiplier. Here's the formula: [link to docs/16-game-modes-and-scoring.md]"
- **Day 4**, "Every pick on the platform is hashed and anchored to Ethereum mainnet before its match kicks off. Cryptographic 'I called it' proof, by design: [link to docs/17-vstamp-and-prediction-iq.md]"
- **Day 5**, "Contributor revenue is on-chain via Drips Network. Here's the split: [link to docs/19-open-source-and-contributor-revenue.md]"
- **Day 6**, A "what I got wrong" thread. Open about a reversal in the session notes.
- **Day 7**, "One week in: forks, contributors, traffic, the open public dashboard." Real numbers only.

### Reply guy strategy

Cold-DMs don't scale. Replies to high-signal accounts do. List of accounts where a reply on the right tweet will land you in a thousand feeds:

- AI-builder voices: `@swyx`, `@simonw`, `@karpathy` (long shot), `@minimaxir`, `@jeremyphoward`, `@AnthropicAI`
- Founder-builder voices: `@levelsio`, `@dhh`, `@patio11`, `@jasonlk`
- Web3-meets-product voices: `@cdixon`, `@balajis`, `@vitalik` (long shot)
- Sports-meets-tech: `@PolymarketIntel`, `@KalshiInc`, `@joerogan` (very long shot, but the AR-FR demo is exactly his vibe)

When any of them tweets about open source, AI-built products, or trust models on the internet, reply with a one-liner that lands the story and the link.

---

## 4. Hacker News

The single most leveraged channel for the dev audience. ONE attempt, get it right.

### Title

Use **"Show HN: Tournamental, I open-sourced an entire startup, not just the code, before launch"**.

Show HN posts get pinned to a separate ranking algorithm and the `Show HN:` prefix signals "I built this." Mods will rewrite editorial-flavoured titles.

### When to post

Tuesday–Thursday between 8am–10am US Eastern. That's HN prime time. Avoid weekends and Fridays.

### Body

```
I'm Tim, solo founder. Tonight we launched Tournamental, a bracket-prediction platform for the 2026 FIFA World Cup. Open-sourced everything: code (Apache 2.0), 27 design docs, business model, marketing site, brand book, 90+ session notes.

Built solo over 72 hours with Claude as the engineering partner, up to 12 parallel agent sessions at peak, coordinated by a single CLAUDE.md protocol that's also in the repo.

What's interesting about the open-source decision isn't the code. It's that the *idea*, the business model, the affiliate splits, the contributor-revenue plumbing, is public too. Bet: in an AI-fluent world, the version of an idea that ships first is the version that wins. So: ship the idea publicly so the whole community ships it faster.

Repo: https://github.com/0800tim/tournamental
Live: https://play.tournamental.com
Press release: https://tournamental.com/press/2026-05-12-everything-open-source
30-sec demo: [unlisted YouTube link]

Stack: TypeScript, Next.js (play app), Astro (marketing), React Three Fiber (3D renderer), Fastify + SQLite (auth/game services), Python (StatsBomb data ingest), Drips Network on Ethereum mainnet (contributor revenue).

Happy to answer anything about the orchestrator pattern, the parallel-agent dispatching, the spec-as-contract rule, the scoring algorithm, or why I think this open-everything bet works in 2026 even if it didn't in 2016.
```

### HN-specific etiquette

- Stay online for the first **4 hours** after posting. Reply to every comment, especially critical ones. Front-page placement depends on early comment activity.
- Don't ask for upvotes anywhere. Don't tweet "we're on HN" until after it's already on the front page.
- If it doesn't make the front page in 90 minutes, it won't. Don't repost the same day.

---

## 5. AI YouTubers and podcast channels

The single most under-exploited channel. AI YouTubers run on stories about builders shipping AI-built products. The "entire idea is open" angle is a fresh hook that none of them have covered yet.

### Tier 1, pitch a 20-minute walkthrough (send first)

These channels run dedicated indie-product-launch segments and have audiences that fork things on the spot.

| Channel | Pitch angle | Email / contact |
| --- | --- | --- |
| **AI Explained** (Philip) | The orchestrator pattern + spec-as-contract + 12 parallel agents | DM on X / `@aiexplained-official` |
| **Matthew Berman** | "Built solo with Claude in a week" demo + walkthrough | matthewberman.ai/contact, DM on X |
| **The AI Daily Brief** (Nathaniel Whittemore) | Daily podcast; loves single-story headlines | DM on X `@nlw` |
| **Wes Roth** | Open-source AI tools beat | DM on X |
| **All-In Podcast** (Chamath, Sacks, Friedberg, Calacanis) | The economics-of-AI-builders angle for their "best ideas" segment | tips@allinpodcast.co |
| **a16z Podcast** | The new economics of consumer launches in AI era | `info@a16z.com` (try a Twitter intro first) |
| **Lenny's Podcast** (Lenny Rachitsky) | The PM angle: how an AI-built product handles roadmap, scope, and shipping | `lenny@lennysnewsletter.com` |
| **Sam Parr / My First Million** | "I open-sourced my edge" is exactly their kind of contrarian indie story | `hello@hubspot.com` for MFM, DM `@theSamParr` |

### Tier 2, submit for coverage

These cover anything well-built; you don't need an interview, just a tip.

- **Two Minute Papers** (Károly Zsolnai-Fehér), only if you have a strong renderer angle
- **Yannic Kilcher**, only if you have an LLM-engineering angle, which the orchestrator protocol gives you
- **Marques Brownlee (MKBHD) / Waveform**, long shot, only if the 3D renderer + watch-along has a viral demo clip
- **Lex Fridman Podcast**, long shot, but you have the right story-shape; reach via `lex@lexfridman.com`
- **Indie Hackers podcast** (Courtland Allen), perfect fit; `courtland@indiehackers.com`

### Pitch email, for podcasts and YouTubers

> Subject: *20-minute build walkthrough: I open-sourced an entire startup before launching it. Built solo with Claude in 72 hours.*
>
> Hi [name],
>
> Big fan of [specific episode they did]. I'm Tim Thomas, solo founder of Tournamental. We launched publicly last night.
>
> The product is a bracket-prediction platform for the 2026 World Cup. The story your audience will care about is that I put the **entire** business, code, design docs, business model, marketing site, brand book, 90+ session notes, on GitHub before a single user signed up. Apache 2.0. Built over 72 hours with Claude as the engineering partner, coordinating up to 12 parallel agent sessions at peak.
>
> What I can give you for a recorded segment:
>
> - A 20-minute screen-share walkthrough of the orchestrator pattern (parallel agents, spec-as-contract, the CLAUDE.md protocol). This is the part nobody else has filmed yet.
> - A live demo of the bracket game, the 3D match-renderer, and the on-chain prediction receipts.
> - The honest take on what didn't work, the session notes are public so I can't pretend it was all smooth.
> - The economics: how Drips Network pays open-source contributors automatically on Ethereum mainnet.
>
> Repo: https://github.com/0800tim/tournamental
> Press kit: https://tournamental.com/press
> Demo reel (60 sec): [unlisted YouTube link]
>
> Happy to record at a time that suits you, your studio if you prefer in-person (I'm in Auckland NZ but flexible), or just send you b-roll and a written walkthrough.
>
> Tim

### YouTube creator-list grease

Most AI YouTubers' first source on a story is **Twitter**. Get the Twitter thread (§3) ranked first; then when you DM them, link the thread *and* the repo. Three of them seeing the same story trending on X is what gets you the email reply.

---

## 6. Discord / community seeding

Drop the launch announcement in places where the right audience already lives. Order matters: announce in your *most engaged* community first; later communities see "the thing trending in those other communities" and weight it accordingly.

| Server | Channel | Notes |
| --- | --- | --- |
| **Anthropic Builders Discord** | `#showcase` | Native fit, drop a 60-word post + repo link |
| **Indie Hackers Discord** | `#launches` | Same |
| **r/SideProject Discord** | `#showcase` | Same |
| **OpenSauced** | community Discord | Get a Drips Network shout-out for the contributor-revenue angle |
| **Drips Network Discord** | `#projects` | They actively promote projects that use Drips for OSS revenue |
| **buildspace** (if still active) | `#projects` | Indie-builder audience |
| **Polymarket / Kalshi communities** | wherever they live | The blockchain-verified-predictions angle |

Sample Discord post (60-word version):

```
Tournamental went live tonight. It's a bracket-prediction platform for WC 2026 with a 3D match renderer and on-chain prediction receipts.

The thing I want feedback on isn't the product, it's the bet: I open-sourced the **entire idea**, code, business model, marketing, brand, 90+ session notes, on day one.

Repo: github.com/0800tim/tournamental
Live: play.tournamental.com
```

---

## 7. Email list / direct contacts

If you have an existing email list (newsletter subscribers, syndicate signups, ex-colleagues), this is the highest-converting single channel. Send a personal-voice email, not a marketing-templated one.

**Email template:**

> Subject: Going live tonight. I want your eyes on something weird.
>
> Hey [first name],
>
> Tournamental launches tonight, the bracket-prediction game for WC 2026 I've been building. Live at play.tournamental.com if you want to play.
>
> The product is fine. The thing I actually want you to see is the **bet** behind it.
>
> I put everything on GitHub before launching. Not just the code. The business model, the marketing site, the brand book, 90 session notes covering every architectural reversal across the build. The whole brain, public, Apache 2.0.
>
> If you find this interesting, three asks:
>
> 1. **Take a look** at the repo, github.com/0800tim/tournamental. Tell me what you think.
> 2. **If you know anyone who writes about AI-built products**, TechCrunch, The Verge, AI YouTubers, podcast hosts, please forward this email or the press release at tournamental.com/press/2026-05-12-everything-open-source.
> 3. **Play a bracket.** It's free. The 3D match-renderer is cool.
>
> Thanks,
> Tim

---

## 8. The 7-day rhythm

Day 1 (launch day):
- 08:00 NZT, Hacker News Show HN
- 10:00 NZT, X pinned thread goes live
- 10:30 NZT, Reddit `/r/programming` post
- 12:00 NZT, Email blast to existing list + direct contacts
- 14:00 NZT, Reddit `/r/SideProject` post
- 16:00 NZT, AI-builder press emails (§1a)
- 18:00 NZT, Reddit `/r/ClaudeAI` post
- 20:00 NZT, Discord seeding (§6)
- All day, reply to everything within 30 minutes

Day 2: Mainstream tech press emails (§1b), follow-up tweet #1, sports subreddits.
Day 3: AI YouTuber / podcast pitches (§5 Tier 1), follow-up tweet #2.
Day 4: Sports-tech press (§1c), follow-up tweet #3.
Day 5: Long-form Substack/blog post on personal site, follow-up tweet #4.
Day 6: First "what I got wrong" thread on X, transparency angle.
Day 7: One-week numbers tweet with real metrics, traffic, forks, contributors.

---

## 9. Metrics to track (single dashboard)

Open a simple Google Sheet, log daily:

- GitHub stars (target: 500 by day 7, 2000 by day 14)
- GitHub forks (target: 50 by day 7)
- Repo traffic (Insights → Traffic), unique visitors and clones
- Play app DAU + bracket-saves (your existing analytics)
- Press coverage URLs as they land
- Top inbound X / Reddit referrals
- Email replies from press pitches (response rate matters more than send rate)

If GitHub stars stall at < 100 by day 3 with no press coverage: the story isn't landing. Revise the pitch and re-pitch a different angle (e.g. lead with the build pattern, not the open-everything decision).

If GitHub stars cross 1000 by day 3: you have a momentum story. Schedule the follow-up press round (mainstream tech press from §1b move from day 2 to day 4 with the "1000 stars in 72 hours" social proof in the subject line).

---

## 10. What not to do

- **Don't post the press release as-is to subreddits.** It reads like a press release. Translate to first-person voice every time.
- **Don't multi-post the same content to subreddits within an hour.** Spread over the day.
- **Don't engage with bad-faith replies.** Lurkers are watching; a calm "happy to walk through the repo if you want" works better than a defensive thread.
- **Don't promise features you don't have.** The repo is the source of truth; anything you can't point to in the repo, don't pitch as live.
- **Don't pitch journalists who clearly haven't covered this beat before.** Personalisation > volume.

---

## 11. The 60-second elevator version

If anyone asks "what is this?" in passing, the answer fits in 60 seconds:

> *Tournamental is a tournament-prediction platform for the 2026 FIFA World Cup. Bracket game with a 3D match renderer and on-chain receipts so every pick is verifiably timestamped before kickoff. Built solo with Claude in 72 hours. The unusual part: I put the entire idea on GitHub before launch, not just the code, the business model, the marketing site, the 90+ session notes. Apache 2.0. Day one. The bet is that in an AI-fluent world, an open idea ships faster than a private one.*

Practise saying that. It's the line you'll repeat 40 times this week.

Good luck.
