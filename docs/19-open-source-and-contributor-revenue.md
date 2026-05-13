# 19, Open Source, Tournamental, and Contributor Revenue Share

> The structural decision: Tournamental ships **100% open source** and anyone can fork the code. The Tournamental operating company owns the official brand, the official affiliate codes, and the treasury that those codes generate. Contributors to the upstream codebase and builders of games on the platform receive an on-chain, blockchain-tracked share of that treasury, proportional to their scored contributions. This doc specifies how that works without falling into a securities-law trap.

## The shape of the deal

Three things, kept distinct:

1. **The code and protocol**, open source, Apache 2.0 licensed, anyone can fork, run their own Tournamental, set their own affiliate destinations, monetize independently. The protocol is a public good.
2. **The official Tournamental instance + brand**, `tournamental.com`, `@TournamentalBot`, the trademark, the negotiated affiliate deals with sportsbooks and Polymarket. These are private commercial assets owned by **Tournamental**.
3. **The contributor revenue share programme**, Tournamental allocates a fixed percentage of net affiliate revenue (and other monetization lanes from [doc 18](18-monetization.md)) to a pool that streams payments on-chain to scored contributors. This is the part the user shorthands as "blockchain-based equity stakes", but its implementation is a *revenue-share contract*, not literal equity, for legal-clarity reasons explained below.

Anyone can fork; only contributors to the upstream get a slice of the official-instance revenue. Forks succeeding on their own merit help the protocol; they don't dilute upstream contributors because the treasury they feed is whatever the fork operator chooses to set up.

## Why this structure

It threads a narrow needle:

- **Open source maximises adoption and trust.** A closed prediction-game with affiliate links looks like a commercial flytrap; an open one looks like a public utility with optional commercial monetization.
- **Tournamental owning the brand and affiliate codes preserves negotiating power.** Sportsbooks and Polymarket want a single accountable counterparty. They sign deals with Tournamental.
- **Contributor revshare aligns incentives.** Anyone who improves the upstream is improving the platform that drives revenue to the treasury they share in. Same incentive as equity vesting at a startup, with much lower legal load if structured as revshare not equity.
- **Forks are welcome, not threats.** A fork that builds a niche stylized world or a regional feed doesn't compete with Tournamental's affiliate revenue; if anything, it raises the protocol's profile.

## License, Apache 2.0

Not MIT. Not AGPL. Apache 2.0 specifically.

**Why not MIT.** MIT is permissive but lacks an explicit patent grant. For a prediction-game platform with affiliate routing logic that may attract patent-troll attention, the Apache 2.0 explicit patent grant + termination clause matters.

**Why not AGPL.** AGPL would force forks that run as a public service to open-source their changes back. Sounds good but creates real friction for the operators we *want* to attract, broadcasters running white-label, sponsors running branded leagues, etc. AGPL would chill enterprise adoption. Better to maximise ecosystem with Apache 2.0 and capture the official-instance value through brand and affiliate deals.

**The licensing stack:**

```
Code (everything in /apps, /packages, /spec):    Apache-2.0
Documentation (everything in /docs, /prompts):   CC-BY-4.0
Brand assets (Tournamental name, logo, Tournament       (c) Tournamental, all rights
Bot persona, badge artwork, stadium skins):       reserved
```

The brand assets are deliberately *not* open. A fork can use the code; it cannot call itself "Tournamental" or use the wordmark. This is how essentially every open-source-with-commercial-arm project works (Linux + Linux Foundation, Mozilla + Firefox brand, Elasticsearch's old model, etc.).

Add a `TRADEMARK.md` to the repo root spelling this out plainly so forks know what they can and can't borrow.

## The Tournamental operating company

A real company. Tim and the founding team own the equity. The current operating entity is established in New Zealand; the jurisdiction analysis below preserves the historical design-pack reasoning for context.

### Jurisdiction options

| Jurisdiction | Pros | Cons | Verdict |
|--------------|------|------|---------|
| **NZ Limited Company** | Simple, fast, Tim is local. | NZ securities law for any token issuance. Limited international credibility for a global brand. NZ TAB monopoly affects affiliate operations from NZ even for a NZ co. | Workable as a starter; expect to redomicile. |
| **Delaware C-Corp** | Standard for VC-backed; well-understood; clean for issuing later equity to contributors. | US tax / SEC exposure on any token-shaped instrument. Foreign-founder complexity. | Common but heavy. |
| **Cayman Foundation Company** | Designed for blockchain projects with no equity; treasury-holding patterns are mature; tax-neutral. | Less recognised by traditional investors; setup ~$10k–$30k. | **Recommended for the brand+treasury entity.** |
| **Singapore Pte Ltd** | Crypto-friendly, English-language, good banking, well-regulated. | Slightly slower setup than Cayman. | Strong alternative to Cayman. |
| **BVI / Marshall Islands** | Used by some DAO foundations. | Reputational drift; banking gets harder yearly. | Avoid. |

**Recommended structure**: a NZ operating company (`Tournamental NZ Limited`) for day-to-day operations, contractor payments, and tax residency, paired with a **Cayman or Singapore foundation** (`Tournamental Foundation`) that holds the treasury and runs the contributor revenue share programme. The NZ co invoices the foundation for services rendered. This is essentially the structure used by most credible OSS-with-token projects, Optimism, Filecoin, Mina, Aztec, etc.

Cost: $20k–$50k all-in for both entities + first-year compliance. Worth it if the project gets traction; defer until then by running everything through `Tournamental NZ Limited` first and migrating later.

This doc is not legal advice. Engage counsel before formalizing.

## Contributor revenue share, the four mechanisms ranked

The user phrasing is "blockchain-based equity and stakes". The clean way to deliver that experience without the securities-law trap is **revenue share**, not equity, paid on-chain. Four mechanisms, ranked by simplicity and legal load:

### Mechanism A, Drips Network (recommended for v1)

[Drips Network](https://www.drips.network/) is an Ethereum-based protocol for streaming ERC-20 payments to GitHub repos and Ethereum addresses. Used by Radworks, the Ethereum Foundation, ENS, UNICEF, Scroll, Filecoin (for distributing RetroPGF allocations) and others. Streams of any ERC-20 are split across recipients on a configurable schedule.

How Tournamental would use it:
1. Tournamental Foundation deposits a fixed percentage (e.g. 30%) of monthly net affiliate revenue into a Drips treasury wallet, in a stablecoin (USDC).
2. The treasury is configured as a Drip List with up to 200 recipient addresses + GitHub repos.
3. Recipients are scored quarterly via a contribution-impact assessment (see scoring below). Their split percentages update each quarter.
4. Contributors with their GitHub username verified to a wallet address can claim their continuous USDC stream at any time, no permission needed.

Legal load: very low. This is contractual revenue share, not securities. Drips Network has been used in this exact pattern by major foundations, and the IRS / equivalent generally treats inbound USDC streams as ordinary income to the recipient.

Cost: gas to update the Drip List quarterly (~$5–$50 per update on a cheap L2 like Optimism or Base); the protocol itself is fee-free.

### Mechanism B, Quarterly RetroPGF rounds (Optimism's model)

[Optimism's RetroPGF](https://medium.com/ethereum-optimism/retroactive-public-goods-funding-33c9b7d00f0c) allocates fixed budgets retroactively to contributors based on demonstrated impact. The Optimism Foundation has run multiple rounds, allocating tens of millions of OP tokens.

How Tournamental would use it:
1. Tournamental Foundation announces a $X budget for Round N (e.g. $250k/quarter).
2. Contributors apply with evidence of work shipped (PRs merged, games built, content created, tournaments hosted).
3. A panel of "badgeholders" (long-term contributors, opted-in users, governance token-holders if the project has one) vote on impact scores using a curated voting tool.
4. Funds distribute one-time as USDC or Tournamental-branded ERC-20.

Pros: rewards work that's already shipped; less gameable than ongoing streams; closer to "equity round" feel.

Cons: heavier process; requires a voting platform; risk of politicization in early rounds.

**Pragmatic combo**: ship Mechanism A first (Drips, automatic, low-load) and add Mechanism B as a quarterly *bonus* on top once the project has enough contributors to justify the process overhead. This is what Optimism + Filecoin do, Drips for the steady trickle, RetroPGF for the high-impact retroactive rewards.

### Mechanism C, Off-chain accounting + on-chain payout

The most flexible: keep the contribution scoring in a standard internal ledger (Postgres, Notion, even a Google Sheet), pay out monthly in USDC via a multisig wallet (Safe / Gnosis Safe). No on-chain Drip List, no ERC-20 issuance, just direct contractor payments.

Pros: maximum flexibility; no on-chain reorganisation when you want to change the formula.

Cons: less transparent (contributors must trust the internal ledger); doesn't have the "blockchain-tracked equity" marketing story.

Verdict: **fine for the very first months** when there are 5–20 contributors and the foundation hasn't yet been incorporated. Migrate to Mechanism A once there's enough volume to justify the public infrastructure.

### Mechanism D, Formal governance token (defer)

Issue a `$VTORN` ERC-20 with revenue-share rights and on-chain governance. Token-holders vote on protocol changes; revenue distributions are pro-rata.

This is the most "crypto-native" expression of "blockchain-based equity stakes". It is also **almost certainly a security** in the US, UK, EU, Australia, and New Zealand under the Howey test (investment of money in a common enterprise with profits derived primarily from the efforts of others). Issuing it triggers full securities regulation: registration or exemption (Reg D, Reg S, etc.), KYC for holders, geographic blocks for restricted persons, ongoing reporting.

For Tournamental, Mechanism D should be **deferred until year 2+** if and only if a clear regulatory path appears (e.g. via a Cayman foundation structure with appropriate disclosures, or an international DAO model). It is *not* the way to ship the v1 contributor programme.

## Scoring contributions

Whichever mechanism is in play, the scoring model has to be defensible.

### Sources of contribution score

```
Code merged into upstream                          weight 1.0× per LoC of accepted change
                                                   (capped per PR, decaying for boilerplate)
Significant features (anything in docs/09 agents)  flat bounty per acceptance (e.g. 1000 pts)
Bug fixes                                          per-bug bounty by severity
Reviews of others' PRs                             0.2× their PR score per review
Docs improvements                                  0.5× LoC weight
Games / forks built on the platform                opt-in registration; impact-scored
Community moderation                               flat monthly bounty
Major design contributions (specs, RFCs)           per-RFC bounty when accepted
Vulnerability disclosures                          severity-tiered bounty
Localization                                       per-language flat bounty
```

Code contributions auto-score from GitHub via a small TS service (`apps/contribution-scorer/`) reading the GitHub API. PRs merged into protected branches are tallied; LoC changes are capped per file to discourage trivial whitespace farming. Reviews are tallied via PR-review approvals.

For non-code contributions (games built, content, moderation), a quarterly application + light review by a council of 5 maintainers + 2 elected community reps. Council changes annually. This avoids the "founder-gives-friends-tokens" problem.

### Decay and dilution

Old contributions decay. A contribution made today is worth 100% for the next quarter, 80% the quarter after, 60%, 40%, 20%, then 0. Forces ongoing contribution rather than rent-seeking on early commits. Same model Optimism and Filecoin use.

New contributors join the pool every quarter. Existing recipients are mathematically diluted as the population grows; total payout per recipient might decrease even if their absolute score stays flat. Contributors should expect this and the docs should say so plainly.

### Anti-gaming

- **Identity verification.** Contributors register a GitHub identity + an Ethereum address + opt-in PII (jurisdiction at minimum, for tax / sanctions screening at payout time).
- **Multisig council** approves the quarterly score sheet before Drip List updates. 4-of-7 maintainers + community reps.
- **Public score sheet**. Every quarter's allocation is published as a Markdown file in the repo. Anyone can dispute via a GitHub Issue; council adjudicates.
- **Sanctions screening** at payout. Standard OFAC + EU + UK sanctions list check on the recipient's wallet address and self-declared identity. Cheap automated services exist (e.g. Chainalysis KYT, $0.01–$0.10 per check).

## Treasury policy

Tournamental Foundation publishes its treasury policy openly:

```
Affiliate net revenue:                              100%
  → Tournamental Foundation operating reserve (12 mo runway):  50% (capped)
  → Contributor revenue share Drip List:                30%
  → Public goods (sponsored events, OSS deps):          10%
  → Strategic reserve (legal, audits, contingency):     10%
```

The split rebalances annually based on actual revenue. Once operating reserve is full, more flows to contributors and public goods. Once revenue is large, the operating-reserve cap drops to 6 months and more flows out.

Sponsored tournament + Pro subscription + B2B revenue (lanes 1–4 of [doc 18](18-monetization.md)) flow into the same treasury; contributors share in *all* monetization, not just affiliate. This is critical because affiliate is geo-bounded, without including the other lanes, contributors in NZ-style restricted geos couldn't earn from their own work.

## What contributors are signing up for, plain language

The contributor-onboarding page reads roughly:

> When your code is merged into the Tournamental upstream, you become eligible for the contributor revenue share programme. Tournamental Foundation streams a portion of platform revenue, currently 30% of net revenue, to a public address list on the [Drips Network](https://www.drips.network/). Each quarter, your share of that stream is recalculated based on the work you've shipped that quarter and the previous five quarters (with a decay schedule).
>
> This is **not equity**. You don't get voting rights, board seats, or ownership of Tournamental or Tournamental Foundation. You get a share of incoming revenue for as long as you keep contributing and the project keeps earning. Your share decays over time as old work ages out and as new contributors join.
>
> To opt in, register your GitHub username with an Ethereum wallet address at `tournamental.com/contributors/register`. We'll do a basic sanctions check at payout time. Quarterly score sheets are published in the public `payouts/` directory of the repo.
>
> You're free to keep contributing without opting in (some contributors prefer not to receive payments for tax / personal / philosophical reasons). The code is Apache-2.0 either way.

## The fork story

Forks are explicitly endorsed. Every fork can:

- Use 100% of the open-source code.
- Set their own affiliate codes pointing at their own treasury.
- Run their own brand on top of the codebase (subject to the trademark rules, they can't call it Tournamental).
- Rebrand the Tournament Bot, the renderer, the leaderboards.
- Run their own contributor programme, or none at all.
- Optionally upstream improvements back to Tournamental, at which point the contributor would also become eligible for the upstream's revshare.

What forks **cannot** do:

- Use the Tournamental name, wordmark, or logo.
- Use the official `@TournamentalBot` Telegram identity.
- Claim to be the official Tournamental instance.
- Use the official Tournamental Foundation affiliate deal codes (those are tied to Tournamental).

This makes "official Tournamental" a clear, brandable thing, `tournamental.com`, distinguishable from any number of forks that may exist, while keeping the underlying protocol genuinely public.

## Comparable projects (for the README)

These are projects that have shipped a similar OSS-with-foundation-revshare structure and that Tournamental can credibly cite as precedent:

- **Optimism Collective** (`optimism.io`), open-source rollup protocol; Optimism Foundation manages OP token distribution; RetroPGF rounds for OSS contributors.
- **Filecoin Foundation**, open protocol; foundation runs grants + RetroPGF; uses Drips for distribution.
- **Mozilla Foundation**, non-profit owning the Firefox brand on top of an open codebase; commercial revenue funds development.
- **Linux Foundation**, open kernel; corporate-sponsored foundation funds maintainers.
- **Radworks**, open governance protocol; streamed $1M to FOSS dependencies via Drips.
- **Mina Foundation, Aztec Foundation, Scroll Foundation**, all use the "Cayman foundation + open protocol + revshare-to-builders" pattern.

Tournamental isn't claiming to be these, it's positioning *alongside* them as a structurally familiar setup, which lowers legal review friction and makes the "is this legit" question easier for contributors and partners to answer.

## What to ship in v1 (concrete checklist)

This is the shippable version of "open source + contributor revshare" for a v0.1 launch:

- [ ] Apache 2.0 LICENSE file at repo root.
- [ ] CC-BY-4.0 LICENSE file in `/docs`.
- [ ] TRADEMARK.md spelling out the Tournamental brand reservation.
- [ ] CONTRIBUTING.md with the contributor revshare programme summary, link to register.
- [ ] CONTRIBUTORS.md auto-generated from accepted PRs.
- [ ] `apps/contribution-scorer/` Node service polling GitHub, computing per-PR scores.
- [ ] `payouts/2026-q1.md` (and every quarter thereafter), public score sheet, council-signed.
- [ ] Drip List on Optimism / Base mainnet, multisig-controlled by Tournamental Foundation.
- [ ] Sanctions screening hook before each Drip List update.
- [ ] `tournamental.com/contributors/register`, wallet address + GitHub link + jurisdiction + opt-in.
- [ ] Treasury dashboard at `tournamental.com/foundation/treasury`, public, real-time read of the multisig balance + Drip List config + history.

What can be deferred to v2+:

- Formal governance token.
- Full DAO infrastructure (Snapshot voting, etc.).
- RetroPGF rounds (start with Drips-only; layer RetroPGF on once justified).
- Tax reporting / 1099-equivalent for high-value recipients (work with counsel).

## Securities-law reality check

Honest disclosure for contributors and the team: even revenue share programmes can sometimes be characterised as securities. The reasons Tournamental's structure is *probably* fine:

- Contributors do *work* that is rewarded, economic substance is performance-for-payment, not investment-for-yield. (This is the key distinguisher from a token-holder revshare.)
- No upfront purchase of any instrument. No money flows *to* Tournamental from contributors.
- Payouts are denominated in USDC / fiat-pegged stablecoin. No appreciation play.
- Foundation governance is centralized at first; not an investment-in-common-enterprise pattern.

Where the analysis gets harder:

- If contributors start trading their future Drip share with each other (e.g. selling "my future stream" to an investor), that secondary market starts to look like a security.
- If the foundation issues a token that represents "stake in Drip pool", that token is more security-shaped.
- Different jurisdictions apply different tests; contributors in some countries may have local reporting obligations.

Engage real counsel before crossing $100k/quarter in distributions or before any token issuance. The Drips-only v1 should be defensible without specialised crypto-securities counsel.

## Why this matters strategically

A 100%-open-source, foundation-backed Tournamental is **harder to compete against** than a closed product:

- Forks become discovery channels and free QA.
- Contributors have aligned incentives to make the upstream stronger.
- Sponsors and B2B customers feel safer betting on a transparent foundation than a closed startup.
- The Verified Pundit network ([doc 17](17-vstamp-and-prediction-iq.md)) plus the contributor network create a moat made of *people who care about the platform*, not features that can be cloned.

If a competitor copies the codebase, they have to also copy the foundation, the brand, the affiliate deals, and the contributor pool. Far higher activation energy than copying a closed product.

The OSS-with-foundation pattern is the correct shape for a project that wants to become infrastructure. Tournamental becoming infrastructure for prediction-network reputation is the long-term vision in [doc 15](15-tournamental-brand-and-positioning.md). This doc operationalises it.

## Sources

- [Drips Network, open-source funding via streaming](https://www.drips.network/)
- [Drips Docs, protocol introduction](https://docs.drips.network/)
- [Optimism RetroPGF, retroactive public goods funding](https://medium.com/ethereum-optimism/retroactive-public-goods-funding-33c9b7d00f0c)
- [Filecoin / Drips collaboration on RetroPGF distribution](https://www.drips.network/blog/posts/dependency-funding-with-drips)
- [Apache License 2.0, full text](https://www.apache.org/licenses/LICENSE-2.0)
- [Cayman Foundation Companies Law primer](https://www.harneys.com/our-blogs/practical-implications-of-the-cayman-foundation-companies-law/)
- [Howey Test (US securities law summary)](https://www.investor.gov/introduction-investing/investing-basics/glossary/howey-test)
