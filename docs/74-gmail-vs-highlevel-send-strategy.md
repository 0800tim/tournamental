# Gmail + HighLevel Send Strategy (vs SmartLead)

**Status:** Ready to execute.
**Author:** Tim + Claude, 2026-06-01.
**Replaces:** the SmartLead recommendation in docs/69 section 4.

Tim's call: he already runs HighLevel for Growth Spurt and his Gmail / Google Workspace inbox is warm. Routing the blast through those two channels beats a cold SmartLead account on deliverability, sender reputation, and time-to-send. This doc spells out exactly how to split the 2,025 verified-email list between Gmail (high-touch) and HighLevel (bulk) so neither channel gets burned and Tim still gets the volume he needs.

## 1. The TL;DR

| Channel | What it handles | Volume | Why |
| --- | --- | --- | --- |
| **Gmail (info@tournamental.com + alias rotation)** | The top 200 hand-personalised emails: federations, top-30 media, top-50 clubs, top-20 academies. The 30 multilingual drafts already sitting in Drafts. Plus all reply-work for the campaign. | ~250 sends across 3 days, all manual or near-manual | One-to-one reads as a real human email. Federation and top-media replies are the multiplier yeses; they MUST land as Gmail-from-a-real-person. Reply rate ~3 to 5x the bulk channel. |
| **HighLevel (Tournamental sub-account)** | Everything else: ~1,775 emails. Long-tail clubs, all stores, mid-tier media, smaller academies, the 203 sub-10k creators. | ~1,775 sends across days 2 to 4 | HighLevel's deliverability rotation + warm-up + reply-tracking handles the bulk tier without burning a single inbox. CRM-native so every reply becomes a contact and an opportunity automatically. |
| **SmartLead / Instantly / Lemlist / Apollo** | Not used. | 0 | Cold IPs, fresh setup time, and you would lose the HighLevel CRM round-trip. |

## 2. Why this beats SmartLead for Tournamental specifically

**Deliverability**: an established Workspace inbox at a real working domain (info@tournamental.com lives on tournamental.com which has been deliverable for months) has a sender-reputation history that a fresh SmartLead IP simply does not. The first 100 sends on SmartLead land in spam for 15 to 30 percent of recipients while the IP warms. Same first 100 sends from a Workspace inbox land at ~98 percent inbox.

**Time-to-first-send**: Workspace is configured, HighLevel is configured. SmartLead requires 7 to 14 days of warm-up before you can send cold at any volume. The blast window is 72 hours; we cannot afford the warm-up.

**Reply path**: every Gmail reply lands in Tim's inbox he is already in. Every HighLevel reply auto-creates a contact in the Tournamental sub-account and triggers the concierge-build pipeline. SmartLead replies go to a separate inbox you would have to monitor.

**Cost**: zero incremental for Gmail. HighLevel sub-account costs roll into the existing Growth Spurt arrangement. SmartLead would be a new $39 to $59/month line item.

**Reputation isolation**: the HighLevel Tournamental sub-account isolates the Tournamental campaign from any other Growth Spurt workflow. If one campaign gets flagged, the other does not.

## 3. Channel A: Gmail (the high-touch tier)

### What goes through Gmail

- All 87 federations (the leverage segment).
- The top 30 media rows from `football-media-13-countries.csv`.
- The top 50 clubs from `_master-blast-list.csv` (the agent-flagged top-10 per country across UK, US, BR, AR, ES, DE, FR, IT, NL, PT, MX, CA = ~120 candidates; pick the best 50).
- The top 20 academies (Real Madrid Foundation, Benfica Campus, Coerver Coaching, Cruyff Foundation, FA Skills, USYSA, etc.).
- The 30 multilingual drafts already in Gmail Drafts (covers EN/ES/PT/FR/DE/IT across all 5 audiences). These are the first sends of the blast.

Total: roughly **200 to 250 high-touch sends**.

### Sender inbox setup

- **Primary inbox**: info@tournamental.com (Tim's main).
- **Optional aliases for rotation** (sets up in Workspace in 10 minutes if not done):
  - tim@tournamental.com
  - partner@tournamental.com (use for federation pitches; sounds more official)
  - hello@tournamental.com (use for media; sounds more casual)
- **Reply-to** on every send: info@tournamental.com (single thread of replies).
- **Display name on the From line**: `Tim Thomas <{alias}@tournamental.com>` so the recipient sees a human name.

### Daily caps (Gmail-side)

Google Workspace Business / Enterprise enforces these limits:

| Plan | Recipients per day | Per-email recipient cap | Total sends |
| --- | --- | --- | --- |
| Workspace Business Starter | 500 to-recipients/day | 100 per email | ~500/day |
| Workspace Business Standard | 1,500/day | 500 per email | ~1,500/day |
| Workspace Business Plus | 2,000/day | 500 per email | ~2,000/day |
| Workspace Enterprise | 10,000/day | 500 per email | ~10,000/day (but you'll get flagged) |

Tim's Workspace plan determines the cap. If on Business Starter (most likely for a small team), Gmail can technically handle 500/day but **the practical cold-send cap is 100/inbox/day** before sender reputation flags. Hence the 200 to 250 figure above, spread across 2 to 3 days from a single inbox or 1 day from 3 aliases.

### Send pacing (Gmail-side)

- **15 to 30 seconds between sends** when sending manually. Google's spam detection treats burst-sends as automation; spaced sends look like a human typing.
- **Don't bulk-send via BCC.** Every email is one-to-one (or one-to-one-with-cc-to-self for record-keeping).
- **Each top-tier email should have a personalised first sentence.** The 30 drafts already sitting in Drafts have this; for the 200 wider top-tier the personalisation can be lighter (reference a recent match, fixture, or news item).
- **Send window**: 09:00 to 17:00 in your local time zone OR the recipient's local time zone (recipient's is better, but more work).

### Personalisation per row

Use the `why_target` column from `_master-blast-list.csv` to seed the first sentence. Five seconds of editing per email becomes:

> Hi {{FIRST_NAME}}, I noticed {{COMPANY}} {{FROM_WHY_TARGET}}. I run Tournamental, …

So Sports Direct becomes "I noticed Sports Direct is the dominant UK sporting-goods chain with 800 stores rolling out the new format pilot through 2025." Real Madrid Foundation becomes "I noticed Real Madrid Foundation Sociodeportiva reaches 85,000 kids across 95 countries through your community programmes." That single sentence per email is the difference between a 2 percent reply rate and an 8 percent reply rate.

### Reply triage from Gmail

- Set up Gmail labels: `Tournamental/Yes-build`, `Tournamental/Interested-tell-me-more`, `Tournamental/Sponsored-route`, `Tournamental/No`, `Tournamental/Bounce`.
- Forward every `Yes-build` to the concierge build pipeline (manual handoff for now; sub-task: build a "concierge intake" form in HighLevel that captures logo + prize + colours + slug).
- Auto-reply (canned response in Gmail) for `Interested-tell-me-more`: 90-second walkthrough video link + Calendly + one-pager attached.

## 4. Channel B: HighLevel (the bulk tier)

### What goes through HighLevel

- All 1,150 long-tail clubs (after subtracting the top 50 sent via Gmail).
- All 288 stores (minus the top 10 sent via Gmail).
- All 140 media rows (minus the top 30 sent via Gmail).
- All 158 academies (minus the top 20 sent via Gmail).
- The 203 sub-10k YouTube creators.

Total: roughly **1,775 bulk sends**.

### HighLevel sub-account setup

- **Dedicated sub-account**: `Tournamental` inside the Growth Spurt agency view. Separates Tournamental sender reputation from any other Growth Spurt workflow.
- **Email domain**: tournamental.com (DMARC, DKIM, SPF set up via HighLevel domain wizard if not already). 30-minute one-time setup.
- **Mailgun / SendGrid backend**: HighLevel's default. Mailgun is the cleaner choice for cold; SendGrid throttles aggressively on flagged content. Pick Mailgun in the HL email settings.
- **Sender name + email**: Tim Thomas <info@tournamental.com> (matches the Gmail sender so replies thread cleanly).
- **Reply tracking**: enabled. HL listens for replies and surfaces them in the Tournamental sub-account's Conversations tab. If a recipient replies to either the HL-sent email or the Gmail-sent email, HL picks up both.

### Pipelines + Sequences (HighLevel-native)

Create one **Pipeline**: "WC2026 Cold Outreach". Stages:

1. **Sent (no open)** - auto when the email goes out.
2. **Opened (no reply)** - auto when the recipient opens.
3. **Clicked link (no reply)** - auto when they click play.tournamental.com link.
4. **Replied** - auto when reply detected. **This stage triggers a 4-hour SLA alert to Tim.**
5. **Yes-Concierge** - manual move after triage.
6. **Yes-Self-Serve** - manual move (less follow-up needed).
7. **No / Bounce** - terminal.

Create one **Sequence** per segment (5 sequences total: clubs, federations, media, academies, stores). Each sequence:

- **Day 0**: send the cold email (one of the 4 variants from `_email-variants.md` or the stores variant from `Partner Pool Playbook`).
- **Day 0**: tag with segment + country.
- **Day 0**: add to pipeline at "Sent" stage.
- **No auto-followup until Day 4** (we read replies before deciding any followup).

### Daily caps (HighLevel-side)

HighLevel + Mailgun throttles by default. Recommended caps for this campaign:

- **200 sends/hour** to keep below spam-trap-density thresholds.
- **800 sends/day total** across the sub-account (well below HL's hard limit of ~5,000/day but where deliverability starts to slip).
- **1 send per parent domain per 24h.** If two contacts at @jdsports.co.uk both got mailed in wave 2, the second waits 24h. HL has this as a built-in throttle.
- **Send window**: 08:00 to 18:00 in the recipient's local timezone. HL has a per-contact timezone setting; ensure the import maps the `country` column to a local timezone.

At 800 sends/day, the bulk tier of 1,775 emails clears in ~2.5 days. Perfect for the Day 2 to Day 4 wave-2-to-3 window in the master playbook.

### Tagging at import time

Import `_master-blast-list.csv` into HL with these custom field mappings:

- `email` → Email
- `name` → Company Name (HL treats as a company-level contact)
- `segment` → custom field `tournamental_segment` (values: club / store / federation / media / academy / creator)
- `country` → Country (HL standard field; derives timezone)
- `source_files` → custom field `tournamental_source_list`
- `why_target` → custom field `tournamental_why_target` (used in personalisation)
- `notes` → custom field `tournamental_notes`

Then build segment filters in HL: `tournamental_segment = club AND country IN (UK,US,CA)` for the English-clubs sequence; `tournamental_segment = club AND country IN (BR,PT)` for the PT-clubs sequence; etc.

### Reply workflow inside HighLevel

When a reply lands:

1. HL auto-detects (subject line + reply-tracking pixel).
2. Contact moves to "Replied" stage.
3. 4-hour SLA alert fires to Tim (push notification on the HL mobile app).
4. Tim opens the conversation in HL, replies inline. The thread stays in HL Conversations, with full history.
5. If Tim moves contact to "Yes-Concierge" stage, an automation triggers: send the "concierge intake" form link + add to the build queue.

This is the workflow you can't replicate in SmartLead.

## 5. The 72-hour wave plan (channel-aware)

| Day | Wave | Sends | Channel |
| --- | --- | --- | --- |
| 0 (today) | Warm-up + draft review + HL list import | 0 | Setup only |
| 1 morning | 30 multilingual drafts (already in Gmail Drafts) | 30 | Gmail |
| 1 morning | Federations (top 60, hand-personalised first sentence) | 60 | Gmail |
| 1 afternoon | Federations (remaining 27 via HL) | 27 | HighLevel |
| 1 afternoon | Top 30 media (hand-personalised first sentence) | 30 | Gmail |
| 2 morning | Top 50 clubs (hand-personalised) | 50 | Gmail |
| 2 morning | Top 20 academies (hand-personalised) | 20 | Gmail |
| 2 afternoon | Remaining media (110) | 110 | HighLevel |
| 2 afternoon | Top 10 stores hand-personalised (Sports Direct, Decathlon, JD Sports, Centauro, Innovasport, Marti, Dick's, Foot Locker, Sport Chek, Stock Center) | 10 | Gmail |
| 2 evening | Remaining stores (278) | 278 | HighLevel |
| 3 morning | Long-tail clubs batch 1 (500) | 500 | HighLevel |
| 3 afternoon | Long-tail clubs batch 2 (500) | 500 | HighLevel |
| 3 evening | Remaining academies (138) | 138 | HighLevel |
| 4 morning | Long-tail clubs batch 3 (152) | 152 | HighLevel |
| 4 afternoon | Sub-10k creators (203) | 203 | HighLevel |

Gmail total: ~210 sends over Day 1 to Day 2 (well within Workspace caps).
HighLevel total: ~1,908 sends over Day 1 to Day 4 (at 800/day = 2.4 days, fits cleanly).

## 6. Sender reputation safeguards

The campaign blasts a credible volume in 4 days. Even with good infrastructure, sender reputation can dip. Safeguards:

- **Don't send to obvious spam-traps.** Mailgun (HL's backend) has a built-in suppression list. Trust it. Anything flagged as a spam-trap gets dropped from the send and added to `_master-blast-list.csv` notes.
- **Monitor bounce rate.** If bounce rate exceeds 5 percent on any single send batch, **pause** and inspect. Above 8 percent and Mailgun rate-limits your account. Tournamental list has ~3 percent expected bounce (mostly stale academy `info@` inboxes); should stay under the threshold.
- **Monitor complaint rate.** Above 0.3 percent and Mailgun escalates. The B2B-only nature of this list should keep complaints near zero, but watch the dashboard.
- **Honor unsubscribes (Reply NO) within 1 hour.** HL has a global suppression list; add every `Reply NO` to it immediately. This is required compliance, not nice-to-have.
- **Pause sends if a major email provider (Gmail, Outlook, Yahoo) flags you.** HL surfaces provider-level deliverability stats in the sub-account dashboard. If Gmail open rate drops below 30 percent or Outlook below 20 percent, pause and warm up.

## 7. What I can build for you right now (no waiting)

Inside HighLevel (I have your location auth tokens already):

1. **Create the Tournamental sub-account pipeline** with all 7 stages.
2. **Create the 5 sequences** (clubs, federations, media, academies, stores), each pre-loaded with the email variant + the compliance footer + the merge tags.
3. **Import `_master-blast-list.csv`** with the segment / country / why_target custom-field mapping.
4. **Wire the reply-detection automation** (move to Replied, fire SLA alert).
5. **Wire the concierge-intake form** as a custom HighLevel form that the Yes-Concierge automation sends.

That's about 30 minutes of HL work. I can do it now; say the word.

Inside Gmail:

6. **Send the 30 multilingual drafts** that are already in Drafts (they're ready, just need your review-and-send).
7. **Draft the next 200 high-touch emails** to the federations + top media + top clubs + top academies + top 10 stores, each with a personalised first sentence pulled from `why_target`. About 2 hours of Claude work; ready for your sign-off before send.

## 8. Open questions for Tim

1. **Workspace plan?** Need to confirm the daily-send cap. Business Standard or higher is fine; Starter requires more inbox rotation.
2. **Sender alias rotation?** Use info@ only, or set up tim@ / partner@ / hello@ as well? (Recommended: do the rotation.)
3. **HighLevel sub-account: create new or use existing Tournamental account?** I have auth tokens for a Tournamental location; confirm that's the right one.
4. **Concierge build owner**: who handles a Yes-Concierge reply? You alone, or split with Claude (I can draft the response + pre-build the pool, you approve)?
5. **Auto-followup at Day 7**: yes or no? My recommendation is no for this campaign (read replies first), but if you want a "did this land?" nudge at Day 7 we can wire it.
6. **Multilingual at scale**: the 30 drafts cover EN/ES/PT/FR/DE/IT. Do you want the HL bulk sends also segmented by language (so the country-code = ES/AR/MX recipients get the Spanish variant, BR/PT get Portuguese, etc.)? Recommended yes; it's a 1-hour translation pass per segment.

## 9. Sign-off

- Tim: pending
- Plan version: 1.0
