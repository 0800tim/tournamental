# Cold-Outreach Email Variants - Football Audiences

Four pitch variants for the four big football-centred audiences. All four open the same door (a free, branded WC2026 prediction pool) but the hook, the prize, and the leverage are different per segment.

Pulled from the Tournamental Partner Pool Playbook (Drive) and adapted for each audience.

**Mailer settings (all variants):**

- From: `Tim Thomas <info@tournamental.com>`
- Reply-to: `info@tournamental.com`
- Sender footer: `Tournamental (a Growth Spurt Ltd brand) - Auckland, NZ - info@tournamental.com - reply NO to opt out`
- Per-domain throttle: max 1 send per 24h, max 40 sends/day in any one batch.

The merge tags in `{{...}}` come from the master blast CSV (`_master-blast-list.csv`): `{{NAME}}`, `{{FIRST_NAME}}`, `{{COMPANY}}`, `{{COUNTRY}}`, `{{WHY_TARGET}}`, `{{SLUG}}`.

---

## 1. CLUBS - senior, amateur, and grassroots football clubs

**Use for:** every entry in `nz-football-clubs`, `uk-football-clubs`, `brazil-football-clubs`, `portugal-football-clubs`, `spanish-language-football-clubs`, `de-it-fr-nl-football-clubs`, `usa-football-clubs`, `canada-football-clubs`.

**The hook:** every-match-day re-engagement with your members and supporters. Prize is club-controlled (signed kit, match-day experience, a season ticket, club merch).

**Subject lines (A/B these):**

- A: `A 5-minute branded prediction pool for {{COMPANY}} during WC2026`
- B: `{{COMPANY}} prediction pool, free, 5 minutes to set up`
- C: `{{FIRST_NAME}}, a free WC2026 engagement loop for {{COMPANY}}`

**Body:**

```
Hi {{FIRST_NAME}},

I run Tournamental, a NZ-based free-to-play prediction-pool platform built around the FIFA World Cup 2026.

The pitch in one line: {{COMPANY}} runs a branded prediction pool for the run of the tournament; your members pick every match; the leaderboard updates live; you set the prize (signed kit, match-day experience, club merch); members re-engage with the club every match day for six weeks.

No money handling on our side. No takes, no fees. Free for the standard tier.

You can set it up yourself in 5 minutes at:

   play.tournamental.com/syndicates/new

You upload your logo, type the prize details, pick the brand colours, save. The pool page is live and you have a share URL to fire to your member list. If you can post to Facebook, you can do this.

Alternative: reply with your logo, prize details, and brand colours and we will build it for you within a working day. Same product, same price (free).

Why {{COMPANY}}: {{WHY_TARGET}}

If you want a 90-second walkthrough video first, just reply WALK and I'll send one back.

Cheers,
Tim Thomas
Tournamental (a Growth Spurt Ltd brand)
Auckland, NZ
info@tournamental.com

Reply NO if you'd rather we did not reach out again.
```

---

## 2. FEDERATIONS - national associations + regional/state/county football federations

**Use for:** every entry in `global-football-federations`, plus the federation rows inside `nz-football-clubs.csv`, `uk-football-clubs.csv` (County FAs), `portugal-football-clubs.csv` (Distritais), and the regional federations inside the spanish-language and de-it-fr-nl lists.

**The hook:** one yes from a federation reaches every affiliated club. AFL (Lisboa) governs 400+ clubs. London FA covers thousands of teams. Cal South Youth has 250,000 registered players. Federations are the audience-multiplier targets.

**Subject lines:**

- A: `Free WC2026 prediction pool for {{COMPANY}} member clubs`
- B: `One link, every affiliated club: WC2026 pool from Tournamental`
- C: `{{FIRST_NAME}}, can we run a free national pool for {{COMPANY}}?`

**Body:**

```
Hi {{FIRST_NAME}},

I run Tournamental, the open-source prediction-pool platform for the FIFA World Cup 2026.

Specific ask: would {{COMPANY}} forward an invite to your affiliated clubs to spin up free branded WC2026 prediction pools, with {{COMPANY}} carrying a co-branded master pool for the federation itself?

Why federations: every affiliated club gets their own branded prediction-pool page in five minutes (we host, you brand it). The federation carries one master pool. Member clubs that run their own pool also feed their leaderboard into your federation table, so you get a national snapshot of where the football imagination lives for six weeks.

We do not handle money. The federation picks the federation-level prize. Each affiliated club picks its own prize. Free, standard tier. No fees ever, no per-seat charges, no upsell.

What we are asking the federation to do:

   1. Let us send your affiliated clubs a one-paragraph invite (you can review the copy first).
   2. Carry a federation-master pool at play.tournamental.com/s/{{SLUG}} with your logo.
   3. Mention the pool in your next member-comms cycle.

What we do for you:

   1. Build the federation master pool (we can have it ready inside a working day).
   2. Provide the per-club join URL template with merge tags for your existing comms tool (MailChimp / HubSpot / Klaviyo / ActiveCampaign formats supplied).
   3. Aggregate the leaderboard back into your federation dashboard at the end of every match day.

I am happy to jump on a 15-minute call if useful. Or just say yes and we will send the member-club invite copy for your approval.

{{WHY_TARGET}}

Cheers,
Tim Thomas
Tournamental (a Growth Spurt Ltd brand)
Auckland, NZ
info@tournamental.com

Reply NO if you'd rather we did not reach out again.
```

---

## 3. MEDIA, PODCASTS, NEWSLETTERS, BIG SOCIAL ACCOUNTS

**Use for:** every entry in `football-media-13-countries.csv`, plus the larger creators inside `youtube-football-under-10k.csv` (top quartile of that file).

**The hook:** prediction pools are content. A media partner's pool gives them a six-week match-day content loop, a sponsorship inventory unit they didn't have, and a way to drive listeners back to their own brand every day of the tournament.

**Subject lines:**

- A: `A co-branded WC2026 prediction pool for your listeners`
- B: `{{FIRST_NAME}}, a content-loop for {{COMPANY}}, six weeks of match-day engagement`
- C: `Free WC2026 pool for {{COMPANY}} audience (with affiliate revenue)`

**Body:**

```
Hi {{FIRST_NAME}},

I run Tournamental, an open-source free-to-play prediction-pool platform built around the FIFA World Cup 2026.

For {{COMPANY}}, the play is a co-branded prediction pool your audience joins via one link. Every match day they come back to fill or check their bracket. That's a six-week engagement loop your audience already wants and you get to brand and sponsor.

Two ways to monetise it:

   1. Sponsored: one of your existing show sponsors carries the pool as a "{{SPONSOR}} x {{COMPANY}} bracket" - your inventory, your rate.
   2. Affiliate: Tournamental's standard tier carries opt-in affiliate links on share cards (kit retailers, ticket marketplaces). Every join from your pool routes affiliate clicks to you. You set the share.

Free on the standard tier. White-label premium tier available if you want zero Tournamental branding visible.

Content angles built in:

   - Pre-match: "your bracket vs the consensus" segment using live pool data.
   - Mid-match: live leaderboard graphic for your stream / story.
   - Post-tournament: aggregate report on how your audience predicted the final.

Setup is 5 minutes at play.tournamental.com/syndicates/new (you upload your logo, set the prize, pick colours, save). Or reply and we build it for you inside a working day.

{{WHY_TARGET}}

If your audience size is significant (you are in the top quartile of football media we have mapped), we will personally handle the build, the embed snippets, and the matchday graphics for free.

Cheers,
Tim Thomas
Tournamental (a Growth Spurt Ltd brand)
Auckland, NZ
info@tournamental.com

Reply NO if you'd rather we did not reach out again.
```

---

## 4. ACADEMIES + YOUTH-SOCCER ORGANISATIONS

**Use for:** every entry in `football-academies-13-countries.csv`, the school-football contacts inside `nz-football-clubs.csv` and `uk-football-clubs.csv`, plus the youth associations.

**The hook:** kids + parents = a family unit. Each academy member is 2 to 4 emails of audience. Prediction pools are kid-friendly (no betting, no money, just picks) and turn dinner-table conversation into an academy talking point for six weeks.

**Subject lines:**

- A: `Free family-friendly WC2026 prediction pool for {{COMPANY}} kids`
- B: `Pick every match together: a free pool for {{COMPANY}} families`
- C: `{{FIRST_NAME}}, a six-week WC2026 game for {{COMPANY}} parents and kids`

**Body:**

```
Hi {{FIRST_NAME}},

I run Tournamental, an open-source free-to-play prediction-pool platform built around the FIFA World Cup 2026.

The pitch for {{COMPANY}}: a free branded prediction pool every family at the academy joins. Kids pick the matches with their parents. The leaderboard updates live. You pick the prize (a free school of football week, a kit voucher, an experience day). For six weeks the World Cup is a {{COMPANY}} talking point at every kitchen table.

Specifically NOT a betting product. No money, no entry fees, no winnings. Just picks and bragging rights. Safe for under-13s; we follow age-gate rules in every jurisdiction we operate in.

Why this works for academies:

   1. Re-engages the lapsed parents who signed their kid up but stopped paying attention.
   2. Gives the kids something to do on rainy training days.
   3. Photo opportunities for your socials every match day (kid vs parent leaderboard rivalry plays great).
   4. Recruitment hook for the new term: "join our academy, get into the pool".

You set it up in five minutes at play.tournamental.com/syndicates/new. Or reply and we build it for you within a working day. Free, standard tier.

{{WHY_TARGET}}

Happy to send a 90-second video showing how it would look for a family at {{COMPANY}}, just reply VIDEO.

Cheers,
Tim Thomas
Tournamental (a Growth Spurt Ltd brand)
Auckland, NZ
info@tournamental.com

Reply NO if you'd rather we did not reach out again.
```

---

## A/B test recommendations

Two columns are worth A/B-ing inside the first 48 hours so you can pick the winners for the bulk blast:

1. **Subject lines**: send the A subject to one half of each segment, B to the other. Read the open rate at +12h and lean into the winner. The C subject is a fallback if both A and B underperform; do not run all three in parallel against the same list slice.
2. **Body length**: the variants above are 220 to 280 words. Some segments (small NZ amateur clubs, podcaster DMs) read shorter is better. A short variant ("Free WC2026 prediction pool for {{COMPANY}}; play.tournamental.com/syndicates/new; reply with logo + prize and we build it; free, standard tier") at 60 words is worth testing for the 10% lowest-leverage rows.

## Compliance footer (every send)

```
Tournamental is a Growth Spurt Ltd brand based in Auckland, New Zealand.
Reply NO to opt out and we will not contact you again about Tournamental.
Privacy notice: https://tournamental.com/privacy
```

Required by PECR (UK), GDPR (EU), CASL (Canada), LGPD (Brazil), LFPDPPP (Mexico), and the NZ Privacy Act. Same line works in every jurisdiction.
