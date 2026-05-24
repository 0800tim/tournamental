# 64 — Affiliate / referral → HighLevel (PLAN — product not built)

> **Status: groundwork only.** The HighLevel custom fields are provisioned
> (`scripts/highlevel-setup.ts`); the affiliate **product itself does not
> exist yet** and needs a design decision (section 2). This doc specifies
> how affiliates attach to HighLevel once that product is built, mirroring
> the player/pool model in [61-highlevel-integration.md](61-highlevel-integration.md).

## 1. The gap

There is **no affiliate sign-up or affiliate-account concept in the
codebase today.** `apps/affiliate-router` only serves *outbound* partner
links (Polymarket, Bet365, Sky, …) from a static `data/partners.json`:

- Partners are config entries with an `affiliate_param_value` (our code in
  *their* system), not user accounts.
- Routes are read-only (`GET /v1/affiliate/partners`, `GET /v1/affiliate/click`).
- There is no table linking a user to an affiliate, no referral link
  generation, no signup, and no HighLevel/CRM code.

So "affiliate sign-up that creates affiliate objects + a HighLevel URL on
the contact" is a **net-new product**, not a wiring task.

## 2. Decision needed: what is an "affiliate"?

Two distinct products use the word; pick one (or both, phased):

- **A. User referral program** — every Tournamental user can get a referral
  link to invite players / pool owners; they earn rewards (Drips revenue
  share per [40-drips-network-integration.md](40-drips-network-integration.md),
  or in-product perks). This is the viral-growth reading and pairs with the
  pool-owner nurture in [63](63-highlevel-nurture-and-pipelines.md).
- **B. External affiliate/marketer program** — third parties promote
  Tournamental for commission (classic affiliate marketing), managed in
  HighLevel's affiliate manager + paid via the agency.

Most of the platform spine (gamification + affiliate) is sketched in
[30-gamification-and-affiliate-spine.md](30-gamification-and-affiliate-spine.md);
align the build with that before coding.

## 3. HighLevel model (once the product exists)

Same shape as players/pools: the affiliate is a **contact**, enriched with
fields + tags; richer structure later via Custom Objects.

### Custom fields (already provisioned)

| Field key (sent)         | GHL fieldKey                    | Meaning                                  |
| ------------------------ | ------------------------------- | ---------------------------------------- |
| `vtourn_affiliate_code`  | `contact.vtourn_affiliate_code` | The affiliate's own referral code.       |
| `vtourn_affiliate_url`   | `contact.vtourn_affiliate_url`  | Their shareable referral URL.            |
| `vtourn_referred_by`     | `contact.vtourn_referred_by`    | Set on a **referred** contact: the code/id of who referred them. |

### Tags

| Tag            | Applied to                                  |
| -------------- | ------------------------------------------- |
| `affiliate`    | A user/marketer enrolled as an affiliate.   |
| `referred`     | A contact who signed up via a referral link.|

### Attachment

- The affiliate **is** a contact (by email/phone) — their referral link
  lives on their own contact via `vtourn_affiliate_url`, exactly how the
  pool admin URL sits on a pool owner.
- A referred user's contact carries `vtourn_referred_by` = the referrer's
  code, so HighLevel (and the admin dashboard, doc 62) can build the
  referral graph and attribute conversions.

## 4. Where it wires (when built)

1. **Affiliate enrolment** (new endpoint — affiliate-router or a crm-bridge
   `affiliate_signup` event): generate the code + link, upsert the contact
   with tag `affiliate` and `vtourn_affiliate_code` / `vtourn_affiliate_url`.
2. **Referral attribution**: when a new user signs up carrying a referral
   code (querystring → first-sign-in), set `vtourn_referred_by` on their
   contact and tag `referred`. The cleanest hook is the existing identity
   sync in `apps/auth-sms/src/highlevel.ts` (pass the captured ref code
   through to `buildContactBody`).
3. **Link generation**: deterministic, e.g. `https://play.tournamental.com/r/<code>`,
   resolved by a new route that sets a ref cookie then funnels into signup.

## 5. Workflows (GHL UI — see doc 63 for why UI-only)

- **Affiliate welcome** (`affiliate` tag added): how to share, link + assets.
- **Referral milestone**: nudges as referred-count grows (mirror pool growth).
- **Payout/commission notices**: if program B (commission), via the agency
  affiliate manager; if program A, via Drips (doc 40).

## 6. Build prerequisites (not done)

- Product decision (section 2): A, B, or phased.
- Schema: an `affiliates` / `referrals` table (or reuse the user row + a
  referral-edge table) — there is none today.
- Link generation + `/r/<code>` resolver + ref-cookie capture at signup.
- Commission/reward model (Drips vs in-product vs cash).

Until those land, the HighLevel side is ready (fields provisioned) but
**no affiliate data flows yet** — there is nothing to sync.
