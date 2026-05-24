# 63 — HighLevel nurture: pipelines, opportunities & workflows

> **Status: PLAN + partial setup.** The data foundation (tags, custom
> fields, contacts) is **live** — see
> [61-highlevel-integration.md](61-highlevel-integration.md). Pipelines and
> workflows must be **built in the GHL UI** (the public API can't create
> them; a `pit-` token returns `401 not authorized for this scope` on
> pipeline create, and workflow creation has no public endpoint). This doc
> is the build-ready spec, plus the code hooks we add on our side.

Nurturing **pool owners** ("syndicate owners") is a key growth lever: an
owner who grows their pool brings us their whole friend group. This doc
defines how we turn the CRM into that engine.

## 1. What the API can and can't do

| Thing                         | Automatable via API? | Status                         |
| ----------------------------- | -------------------- | ------------------------------ |
| Contacts (create/update)      | ✅ yes               | Live (doc 61).                 |
| Tags                          | ✅ yes               | Live: `player`, `syndicate_owner`, `has_pool`, `tournament:<id>`. |
| Custom fields (create + set)  | ✅ yes               | Live (`scripts/highlevel-setup.ts`). |
| Opportunities (create/update) | ✅ yes (needs pipeline+stage ids) | **Hook spec'd below**, blocked on pipeline existing. |
| Pipelines + stages            | ❌ UI only           | **Build in UI** (section 3).   |
| Workflows / automations       | ❌ UI only           | **Build in UI** (section 5).   |
| Email/SMS templates           | ❌ UI only           | **Build in UI** (section 5).   |

So: build the pipelines + workflows once in the UI, then our code drops
opportunities into them automatically.

## 2. The segments we already emit

Workflows enrol contacts off these (all live today):

- **Tag `player`** — every registered user.
- **Tag `syndicate_owner`** + **`has_pool`** — created a pool.
- **Tag `tournament:<id>`** — scoped to a tournament (e.g. `tournament:fifa-wc-2026`).
- **Custom field `vtourn_pool_ids`** — which pool(s) they own.
- **Custom field `vtourn_admin_url`** — operator deep link (doc 62).

A new pool owner therefore lands in GHL already tagged `player`,
`syndicate_owner`, `has_pool` with their pool id and source
`syndicate_signup` — enough to trigger everything below.

## 3. Pipelines (build in UI)

### Pipeline A — "Pool Owner Nurture"

One opportunity per pool owner. Goal: get the pool to a healthy member
count and keep it active through the tournament.

| # | Stage                | Enters when…                                   | Goal of stage                          |
| - | -------------------- | ---------------------------------------------- | -------------------------------------- |
| 1 | New Pool Owner       | Pool created (`has_pool` tag added).           | Confirm + welcome.                     |
| 2 | Onboarded            | Owner opened the share link / invited ≥1.      | First invites sent.                    |
| 3 | Growing (2–9)        | Pool has 2–9 members.                          | Push past the "lonely pool" threshold. |
| 4 | Thriving (10+)       | Pool has 10+ members.                          | Celebrate; ask for a second pool / referral. |
| 5 | At Risk              | No new members in 7 days / owner inactive.     | Re-engage with a growth tip.           |
| 6 | Champion             | Pool active through a full tournament.          | Convert to advocate / case study.      |

### Pipeline B — "Player Activation" (secondary)

One opportunity per player. Stages: `Registered → First Pick Made →
Active Predictor → Pool Member → Lapsed`. Lower priority than A.

## 4. Opportunities — the code hook

Once Pipeline A exists, capture its `pipelineId` and the **New Pool Owner**
`stageId` (from `GET /opportunities/pipelines?locationId=…`) into env:

```
GHL_POOL_PIPELINE_ID=...
GHL_POOL_STAGE_NEW_ID=...
```

Then, in `apps/web/app/api/v1/syndicates/route.ts` (right after the contact
upsert), create an opportunity for the owner:

```
POST /opportunities/
{
  "locationId": GHL_LOCATION_ID,
  "pipelineId": GHL_POOL_PIPELINE_ID,
  "pipelineStageId": GHL_POOL_STAGE_NEW_ID,
  "name": "<pool name> (<slug>)",
  "contactId": "<owner contact id from the upsert>",
  "status": "open",
  "monetaryValue": 0
}
```

Best-effort + queued on failure, exactly like the contact push. Stage
progression (stages 2–6) is driven by **workflow actions** in GHL reacting
to tags/fields we update (e.g. a future `vtourn_pool_member_count` field),
so our code only needs to create the opportunity and keep the contact's
custom fields current.

> **Prereq:** the owner must be an authenticated user so the opportunity
> attaches to the right contact and our DB links pool→user. See the
> `owner_user_id` fix in [62-admin-dashboard.md](62-admin-dashboard.md) §5.

## 5. Workflows (build in UI)

Each workflow = a trigger + a timed sequence of email/SMS. Content below is
the brief; copy lives in the GHL template editor. Keep to the brand voice in
[15-tournamental-brand-and-positioning.md](15-tournamental-brand-and-positioning.md)
and the no-em-dash rule.

### W1 — Pool Owner Welcome  (trigger: tag `has_pool` added)
1. **t+0 SMS:** "Your pool <name> is live! Share this link to fill it: <share_url>."
2. **t+5min Email:** What a pool is, how scoring works, the share link, a "invite 5 friends" nudge.
3. **t+1day Email (if <2 members):** "Pools are more fun with mates — here's the link again + a WhatsApp-ready message to paste."

### W2 — Grow Your Pool  (trigger: in stage "Growing (2–9)")
A 3-touch tip series, ~2 days apart:
1. Best channels to share (WhatsApp group, Insta story — with a pre-written caption).
2. Social proof: "Pools with 10+ members are 3x more active" + the share card.
3. Run a mini-incentive: "Loser buys coffee" framing; how to set pool stakes.

### W3 — Thriving / Referral  (trigger: enters "Thriving (10+)")
- Congratulate, surface the leaderboard, ask them to create a **second
  pool** or refer another organiser (referral link/affiliate, doc 18/30).

### W4 — At-Risk Re-engagement  (trigger: enters "At Risk")
- "Your pool's gone quiet — here's a one-tap nudge to your members" + a
  single highest-leverage growth tip. Exit on new member joining.

### W5 — Pre-Tournament Ramp  (trigger: `tournament:<id>` + N days before kickoff)
- Countdown sequence: "Lock your pool before kickoff", deadline reminders,
  final-call SMS day-of.

### W6 — Player Activation  (trigger: tag `player`, no pick yet)
- Welcome → "make your first pick" → pick reminders before each match →
  results recap. Feeds Pipeline B.

## 6. Smart lists / segments to create in UI

- **Pool owners with empty pools** — `has_pool` AND `vtourn_pool_ids` set
  AND member count 0–1 (highest-value nurture target).
- **Owners by tournament** — `tournament:<id>`.
- **Players, no pool** — `player` AND NOT `has_pool` (upsell to create one).

## 7. Build checklist

1. [ ] UI: create Pipeline A "Pool Owner Nurture" with the 6 stages (§3).
2. [ ] UI: create Pipeline B "Player Activation" (optional, later).
3. [ ] Copy `pipelineId` + `New Pool Owner` `stageId` into env (§4).
4. [ ] Code: auto-create opportunity on pool creation (§4) — best-effort + queue.
5. [ ] UI: build workflows W1–W6 (§5) with email/SMS templates.
6. [ ] UI: build smart lists (§6).
7. [ ] Add `vtourn_pool_member_count` custom field (run `highlevel-setup.ts`
       after adding it to the desired-fields list) so stage automation can
       react to pool growth.

## 8. Why pipelines aren't auto-created

`POST /opportunities/pipelines` with the sub-account `pit-` token returns
`401 "The token is not authorized for this scope."` Pipeline and workflow
creation are not exposed to private-integration tokens; they're UI-managed
objects. Everything downstream of them (opportunities, contacts, tags,
fields) **is** automatable, which is why this doc splits "build once in UI"
from "our code keeps it fed."
