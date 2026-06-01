# Tournamental Football Blast Playbook (WC2026 cold-outreach)

**Status:** Ready to execute.
**Author:** Tim + Claude, 2026-06-01.
**Window:** Send everything in the next 48 to 72 hours. WC2026 kicks off 11 June, so every day from here on costs 2 to 5 percent of the engagement window.

This is the **what-to-do-now playbook**. The four per-audience strategy playbooks live alongside this doc:

- [docs/70-playbook-clubs.md](70-playbook-clubs.md)
- [docs/71-playbook-federations.md](71-playbook-federations.md)
- [docs/72-playbook-media.md](72-playbook-media.md)
- [docs/73-playbook-academies.md](73-playbook-academies.md)

The cold-email variants are in [tools/outreach-lists/_email-variants.md](../tools/outreach-lists/_email-variants.md).

## 1. The picture in one paragraph

We have **2,025 verified, deduped email addresses** across five segments (clubs 1,352, stores 288, academies 158, media 140, federations 87) and 13 priority countries. The kickoff is 10 days away. Every email lands in the same time window so we have one shot at a coordinated wave. We send in segment-priority order (federations first, then media, then top clubs, then academies, then stores, then long-tail clubs), capped per-domain and per-day so we don't burn sender reputation, and we run a 48-hour A/B on subject lines inside the first batch so the bulk send picks the winners.

## 2. Final inventory

```
Total verified emails (deduped):       2,025
Plus contact-form-only rows:           ~ 850 (separate pipeline, see docs/68)
                                       -----
Addressable universe:                  ~ 2,875

By segment (verified emails only):
  Clubs                                1,352
  Stores                                 288
  Academies                              158
  Media                                  140
  Federations                             87

By country (verified emails only):
  UK     352   US     280   DE     206
  IT     191   FR     182   PT     155
  CA     155   NL     130   ES      99
  BR      61   AR      51   NZ      45
  MX      36
  Plus 60+ scattered global entries (federations, podcasters).
```

Full breakdown: `tools/outreach-lists/_master-blast-list.csv` (one row per email, columns: email, name, segment, country, source_files, why_target, notes).

## 3. The sequenced 48-hour plan

### Day 0 (today, before send)

- [ ] **Read the 4 per-audience playbooks.** 20 minutes total. Decide which subject-line variant (A vs B) you want to A/B first.
- [ ] **Set up the sender domain warm-up.** If you have not been blasting from `info@tournamental.com` in the last 30 days, send 20 to 30 plain human emails today (replies to inbox, internal team) so the sending IP looks fresh-warm not cold-warm-up. If you use SmartLead / Lemlist / Instantly / Apollo, plug the SMTP and let it ramp.
- [ ] **Build the four sender lists in your tool of choice** (one per segment) from `_master-blast-list.csv`, keep the columns: `email, name, segment, country, source_files, why_target, notes`. The merge tags in the email variants assume those columns by name.
- [ ] **Set the global send-rate cap**: 200 sends/hour, 40 sends/domain/day, 1 send per recipient ever (no auto follow-up sequence until we read the reply rates).
- [ ] **Add the compliance footer** (lifted from the email variants doc) as the universal footer.

### Day 1 - wave 1 (federations + top 30 media)

These are the audience multipliers. Hit them first because a yes from one federation reaches hundreds of clubs.

- [ ] **Federation wave**: all 87 federation rows. Use the federation pitch (variant 2). Send by 10am in each recipient's local time zone. Subject: A.
- [ ] **Top-30 media wave**: hand-pick the 30 highest-leverage media rows from `football-media-13-countries.csv` (the agent flagged the global top-15; add the next 15 from the per-country top-3 lists). Use the media pitch (variant 3). Send by 11am local. Subject: A.
- [ ] **Set a 12-hour open-rate checkpoint.** At 22:00 your time tonight, count opens for both waves. If subject A is winning by >3 percentage points, lock A for the bulk wave. If subject B wins, swap. If it's a wash, lean on A (more direct).

### Day 2 - wave 2 (top-tier clubs + all stores + academy heads)

These are individually addressable, you may want to personalise the first sentence of 50 to 100 of these by hand. Two hours of work, can 2x your reply rate.

- [ ] **Top-200 clubs wave**: pull from `_master-blast-list.csv` where `segment = club` AND the source file is one of `usa-football-clubs`, `canada-football-clubs`, `uk-football-clubs`, the top half of `de-it-fr-nl`, `brazil-football-clubs`, `spanish-language-football-clubs`. Cap at the 200 with the highest social/audience reach (the agents flagged top-10 lists per country). Send by 11am local. Use the club pitch (variant 1). Subject: the wave-1 winner.
- [ ] **Stores wave**: all 288 store rows. Use the store pitch (the one from `Tournamental Partner Pool Playbook` Drive doc, COLD OUTREACH section). Send by 12 noon local. This is the existing pitch you already have, no new variant needed.
- [ ] **Academy heads wave**: all 158 academy rows. Use the academy pitch (variant 4). Send by 14:00 local. Subject: winner of A vs B.

### Day 3 - wave 3 (long-tail clubs + creators)

- [ ] **Long-tail clubs wave**: every remaining `segment = club` row (1,152 entries). Use the club pitch (variant 1). Send by 09:00 local. Subject: wave-1 winner. Cap 200 sends/hour so you finish by 14:00 local.
- [ ] **Football creators wave**: all 203 entries in `youtube-football-under-10k.csv`. Use the media pitch (variant 3), trimmed to the 60-word short variant from the email variants doc. Send by 15:00 local.

### Day 4 onwards - reply work, not new sends

- [ ] Reply to every interested response within 4 hours.
- [ ] Concierge-build the first 20 yes pools (the easier ones, no custom asks).
- [ ] Set a calendar reminder for **8 June** (3 days before kickoff) to send a "Your {{COMPANY}} pool is live, time to invite" nudge to every concierge-built pool that has not yet sent its first member-invite.

## 4. Tools to use

Pick one of these to actually run the blast:

| Tool | Why use it | Watchouts |
| --- | --- | --- |
| **SmartLead.ai** | Built for cold-email warm-up + A/B + reply detection. ~$39/mo. | Imports CSV cleanly. Configure inbox rotation if you have multiple sender mailboxes. |
| **Instantly.ai** | Same league as SmartLead, sometimes a touch better deliverability. | Their API is fiddly; you can drive most of it from the UI. |
| **Lemlist** | Best A/B + personalisation. ~$59/mo. | A bit heavier-weight; only use if you actually want LinkedIn touches too. |
| **Apollo.io** | Full CRM + sequences. ~$49/mo. | If you already pay for Apollo, use it; otherwise SmartLead beats it on pure cold-email cost. |
| **MailChimp / Klaviyo** | Don't use for cold. They will throttle or boot you. | Switch to MailChimp only AFTER recipients have opted in. |
| **HighLevel** | You already have it for your other Growth Spurt work. | You can use HL for the sequence + reply tracking, but configure a separate sub-account so the sender reputation does not bleed into your other workflows. |

**Tim's recommendation given Growth Spurt's existing stack**: a fresh **SmartLead** mailbox for the 72-hour blast, then move the conversations into HighLevel for follow-up after wave-3 lands. SmartLead's deliverability scoring will flag rows that bounce or look like spam-traps inside the first 100 sends, so you'll know to slow down before you burn the IP.

## 5. The top-30 to hand-personalise

These rows are worth a first-sentence rewrite each. Two hours of work for an outsized reply rate.

The full lists are in the per-audience playbooks; the global top-30 cuts across all segments:

**Federations (8)**
1. Lisboa AF (Portugal) - 400+ clubs in one yes
2. London FA (UK) - thousands of London Sunday-league teams
3. AF Porto (Portugal) - 250+ clubs
4. Birmingham FA (UK) - dense West Midlands grassroots
5. USYSA + US Club Soccer (USA) - millions of registered youth players, but lock the bot policy first
6. Canadian Premier League head office (Canada)
7. Cal South Youth Soccer (USA) - 250,000 registered players
8. AF Lisboa Distrital (Portugal) - same Lisboa target via Distrital arm

**Media + Podcasters (10)**
1. Goalhanger / The Rest is Football (UK, 3M weekly) - Gary Neville + Wayne Rooney
2. Fabrizio Romano (25M X) - any forward is content gold
3. 433 (63M IG) - reach engine
4. Globo Esporte + Cartola FC (Brazil) - direct prediction-pool analogue
5. Desimpedidos (13M YT BR)
6. AFTV (1.6M YT) - Robbie Lyle has done sponsored pools before
7. The Athletic Football podcast (UK / global)
8. ESPN FC (USA / global)
9. La Gazzetta dello Sport (Italy)
10. RMC Sport Football (France)

**Top clubs (8)**
1. Inter Miami CF (MLS) - Messi crossover
2. Manchester United Direct (UK) - retail arm of biggest fanbase
3. FC Barcelona Megastore (Spain)
4. SL Benfica (Portugal) - one of the four biggest single-club audiences in Iberia
5. Flamengo (Brazil) - 40 million torcida
6. Toronto FC (Canada) - WC2026 host venue
7. Real Madrid Foundation (academy)
8. Manchester United Soccer Schools (academy)

**Academies (4)**
1. Real Madrid Foundation Sociodeportiva (95 countries, 85k kids)
2. Benfica Campus (250+ academies, 50k kids)
3. Cruyff Foundation (250k kids across 24 countries)
4. Coerver Coaching (200k+ kids across 35 countries)

Personalise the **first sentence** of the email for each of these 30. Reference something specific (a recent match, a player they just signed, a foundation initiative) so the recipient sees it is not a templated blast.

## 6. Reply-rate expectations

These are realistic, not optimistic:

| Segment | Expected reply rate | Notes |
| --- | --- | --- |
| Federations | 15 to 25% | High because the value prop is clear: free, multiplier value, no risk. |
| Top media | 8 to 15% | Sponsored-content angle resonates. Lower than federations because every cold-pitcher in football is hitting them this month. |
| Top clubs | 5 to 10% | Best at the smaller pro / semi-pro tier (NPSL, NRFL Premier, lower-Liga clubs). Big clubs reply rarely but some do. |
| Stores | 3 to 6% | Already-budgeted WC2026 marketing teams. Get to them before their plan is locked. |
| Academies | 8 to 15% | Family / kid angle is fresh; few competitors pitching this. |
| Long-tail clubs | 1 to 3% | Volume play. Even 1% of 1,150 = 11 new partner pools. |
| Football creators (<10k subs) | 1 to 4% | The 60-word short variant gets the best ROI here. |

Combined expected positive replies in the first 72 hours: **80 to 200 yes-or-interested** across all segments. Plan capacity for 200.

## 7. Reply triage

- **Yes, build it for us** → concierge path. Capture logo + prize + colours, build inside one working day, send the "your pool is live" follow-up (template 3 in the Partner Pool Playbook).
- **Interested but tell me more** → 90-second walkthrough video + one-pager attached. Drop a Calendly link for a 15-minute call.
- **Already have a different pool partner** → polite goodbye, ask for permission to follow up next tournament cycle.
- **No / Reply NO** → suppression list. Honour immediately. No second touch.
- **Bounce** → mark in `_master-blast-list.csv`. Do not re-add.

## 8. Compliance and consent

Universal footer (already in the email variants doc):

> Tournamental is a Growth Spurt Ltd brand based in Auckland, New Zealand. Reply NO to opt out and we will not contact you again about Tournamental. Privacy notice: https://tournamental.com/privacy

This footer satisfies PECR (UK), GDPR (EU), CASL (Canada), LGPD (Brazil), LFPDPPP (Mexico), CAN-SPAM (USA, even though it primarily applies to consumer email), and the NZ Privacy Act for **business-to-business** outreach via a published contact channel. Every recipient on the lists is a business contact, not a consumer. Suppression is honoured on first reply.

## 9. What we are NOT doing

- **Not blasting consumer (b2c) email lists.** Every contact here is a business inbox.
- **Not running an auto-followup sequence on day 4.** The reply work is the real product; auto-followup risks burning the relationship before we have read the first replies.
- **Not pitching paid (premium) tier on the cold first touch.** The standard tier is free; that is the door-opener. Premium discussion only after a positive reply.
- **Not using the contact-form auto-submission tool** (`docs/68`) until after this email blast lands and we have read the results.

## 10. Sign-off

- Tim: pending
- Plan version: 1.0

---

**Want me to:**

1. Cut a single squashed CSV by-segment so you can paste straight into SmartLead? (Already exists at `tools/outreach-lists/_master-blast-list.csv`.)
2. Generate the SmartLead campaign-import JSON with the four sequences pre-loaded? (10 minutes of work; say yes if you want it.)
3. Pre-personalise the first sentence of the 30 hand-personalise rows? (1 hour, say yes if you want it.)
4. Send-clock the whole 72 hours into your Google Calendar so the wave handoffs fire automatically? (5 minutes, say yes if you want it.)
