# 64, HighLevel setup for Playbook H (pool admin → consulting check-in)

> **What this is.** Step-by-step to wire the 7-day-after-pool-created
> consulting check-in (Playbook H in doc 62) inside the Tournamental
> HL sub-account. The data plumbing is already done in code as of
> 2026-05-28; you just need to build the workflow in HL's GUI from
> the spec below. ~10 minutes total.

## What's already done (don't redo)

| Piece | Status | Where |
|---|---|---|
| HL custom field `Pool Created At` (DATE) | ✅ Created via API 2026-05-28 | HL location `kTxB57bkSkCz2NMi2e5O` (Tournamental) |
| Field key | `contact.pool_created_at` | HL custom-field id `nvC8hOI5llUq4XB5PVM1` |
| Code: pool-create → upserts contact with field set | ✅ Shipped | `apps/web/lib/syndicate/ghl.ts` `buildGhlContactPayload()` |
| Code: contact also tagged `has_pool` + `syndicate_owner` | ✅ Already in place | same file |

**Effect:** every new pool created via `/api/v1/syndicates` (or
the dashboard) now upserts a HL contact with `pool_created_at` set
to the pool's creation timestamp, plus the tags `syndicate_owner`,
`has_pool`, and `tournament:fifa-wc-2026`.

## The workflow you build in HL (5 minutes)

### 1. Create the workflow

- HL UI → **Automation** → **Workflows** → **+ Create Workflow**
- Choose: **Start from scratch**
- Name: `Pool Admin · 7-day consulting check-in`
- Folder: create one called "Tournamental WC2026" if you want
  to group related workflows

### 2. Trigger

- Click **Add new Workflow Trigger**
- Trigger type: **Contact Changed** (NOT "Contact Created" — we
  want this to fire when the date field gets set, which happens
  on contact upsert)
- Filters:
  - **Tag has** `has_pool`
  - **Custom Field "Pool Created At"** is **not empty**
- Trigger name: `Pool admin contact updated`

### 3. Action 1 — Wait

- **Add Action** → **Wait**
- Wait condition: **Wait for a specific time**
- Set: **7 days after** the trigger fires
- Why: gives the pool admin a week to actually see the platform
  in action, see members joining, see the leaderboard. By day 7
  they have something to talk about.

### 4. Action 2 — Filter (gate against duplicate / re-triggered runs)

- **Add Action** → **If/Else**
- Condition: **Tag does NOT have** `playbook_h_sent`
- If TRUE → continue to email step
- If FALSE → **End workflow** (this prevents the same admin
  getting the email twice if they create a second pool)

### 5. Action 3 — Send Internal Notification (to Tim)

- **Add Action** → **Internal Notification** → **Email**
- To: `info@tournamental.com`
- Subject: `[Playbook H] Pool admin ready: {{contact.first_name}} ({{contact.email}})`
- Body:
  ```
  {{contact.first_name}} {{contact.last_name}} created a pool 7 days
  ago and is now in the Playbook H window.
  
  Pool slug: {{contact.syndicate_slug}}
  Email: {{contact.email}}
  Phone: {{contact.phone}}
  
  Send their check-in email in the next 24 hours. Template:
  /home/clawdbot/clawdia/projects/vtorn/docs/64-highlevel-playbook-h-setup.md
  
  Don't auto-send. The personal touch is what makes it land.
  ```
- Why internal: Tim drafts each check-in himself with a personal
  observation about their pool ("you've got 32 members already,
  great first week"). An auto-sent template would tank the
  reply rate.

### 6. Action 4 — Add Tag (so we don't re-send)

- **Add Action** → **Add Contact Tag**
- Tag: `playbook_h_sent`

### 7. (Optional) Action 5 — Push to Slack / WhatsApp

If you want the notification on your phone too:
- **Add Action** → **Send WhatsApp / Slack message**
- To: your own number / channel
- Body: `New Playbook H lead: {{contact.first_name}} ({{contact.syndicate_slug}})`

### 8. Publish

- Toggle the workflow to **Active** (top right).
- Settings: **Re-enrolment** OFF (you don't want a contact who
  creates a second pool to get a second check-in).

## The check-in email template (you send manually after the internal alert)

Paste this into your normal email tool, fill in the bracketed bits
from a 30-second look at the admin's pool. **Do not put this
template into HL as an auto-send.** The whole point is that it
reads as a personal note from you.

> Subject: how's [Pool Name] going?
>
> Hi [first name],
>
> Quick check-in. I can see [Pool Name] has [N] members and
> [average picks-per-member] picks made — that's a great
> first-week result. [One specific observation about their pool,
> e.g. "you've got a tight 4-way lead at the top already" or
> "looks like your office is split half-and-half on Argentina vs
> Brazil for the final".]
>
> Two reasons I'm writing:
>
> 1. Anything not working / anything you want changed? I can
>    push fixes in a few hours.
>
> 2. Something I see almost every pool admin think about by week
>    two: "we should be doing this kind of audience engagement
>    all year, not just for the WC." If that's on your radar, my
>    day job is exactly that — building CRM + automation
>    workflows so brands engage their audience continuously
>    instead of in one-off campaigns. Happy to do a 30-min call
>    if useful, no obligation, just a chat about what you'd want
>    to build.
>
> Either way — glad it's working. Good luck at kickoff.
>
> Tim Thomas
> Growth Spurt Agency

## Verifying the wiring (do once, takes 2 minutes)

After Tim builds the workflow and toggles it Active:

```bash
# 1. Create a throwaway test pool via API (use any test owner email)
curl -s -X POST https://play.tournamental.com/api/v1/syndicates \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"playbook-h-test",
    "name":"Playbook H Wiring Test",
    "tournament_id":"fifa-wc-2026",
    "owner_email":"info@growthspurt.agency",
    "owner_phone":"+6421535832",
    "size_band":"2-10",
    "topic":"test",
    "marketing_consent":true,
    "is_public":false
  }'

# 2. In HL UI, search the contact info@growthspurt.agency
#    Confirm:
#    - Tag has_pool is set
#    - Custom field "Pool Created At" is populated with today's date
#    - Workflow "Pool Admin · 7-day consulting check-in" shows the
#      contact as enrolled with a "wait 7 days" countdown
```

If both items in step 2 are true → wiring is solid; the workflow
will fire the internal-notification email to `info@tournamental.com`
7 days later, and you'll hand-send the personal check-in within
24 hours of seeing the alert.

To clean up the test, delete the syndicate from the DB:

```sql
DELETE FROM syndicates WHERE slug='playbook-h-test';
DELETE FROM syndicate_owners_membership WHERE syndicate_id IN (
  SELECT id FROM syndicates WHERE slug='playbook-h-test'
);
```

And delete the contact `info@growthspurt.agency` from HL via the UI
(or leave it — it's your real address, no harm).

## Why we didn't auto-send the email

HL CAN send the email automatically. We deliberately don't because:

1. **The single best line in the template is the personal
   observation** ("you've got a 4-way lead at the top already").
   That requires a human eyeballing the pool for 30 seconds. An
   auto-send would either skip the observation (kills the warmth)
   or use a generic placeholder ("your pool is doing great") that
   reads as auto-generated.
2. **Reply rate triples** when the recipient suspects the email
   was hand-written. Auto-sends from HL have a visual
   fingerprint (footer disclaimer, tracking pixels, "view in
   browser" link, sender via a `mail.hl.com` relay) that even
   non-technical recipients clock.
3. **The internal alert costs Tim 30 seconds per admin**; the
   manual draft costs 2 minutes. At 50 pool admins over the WC
   window that's ~1.5 hours total for the highest-leverage
   consulting funnel he has. Worth it.

## Future iterations (post-launch, not for the 14-day window)

- A second workflow at day 21 (post-tournament) for admins who
  ran an active pool but didn't reply to the day-7 check-in.
  Trigger: `has_pool` tag + `pool_created_at` > 21 days ago +
  `playbook_h_sent` tag + `playbook_h_replied` NOT set.
- A "no pool activity in 5 days" reminder workflow that emails
  the admin to share their pool link if member count hasn't
  grown.
- Segmentation by pool size: admins with 50+ members get a
  different consulting hook than admins with 5 members.

These all build on top of the same `has_pool` + `pool_created_at`
data, so the schema work done in this doc carries forward.

---

Last updated 2026-05-28. Owner: Tim. Custom field id:
`nvC8hOI5llUq4XB5PVM1`. Workflow lives in HL location
`kTxB57bkSkCz2NMi2e5O`.
