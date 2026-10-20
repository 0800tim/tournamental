# Data retention and consent: decisions for Tim

> Decision paper, 2026-10-20, writing only. Every open retention and consent item from the register-interest review (PR #336), the docs/33 refresh (PR #341) and the DSAR runbook (PR #349), in one place, each with options and a recommendation. Nothing here changes the policy page or the code; each decision names the PR or runbook step that would.

Where it matters, the paper says what the NZ Privacy Act 2020 and the GDPR each require. The short version: Tournamental is a New Zealand company and the Privacy Act is the law we answer to for everyone; the GDPR applies on top for people in the EU and UK (the UK GDPR is the same shape), and it is the stricter of the two on consent and on fixed retention. Designing to the GDPR position satisfies both, and the policy already promises GDPR-style rights to everyone.

## The seven decisions in one table

| # | Item | Recommendation | Effort |
| --- | --- | --- | --- |
| 1 | Register-interest rows with no retention (RI-10) | keep until 60 days after the tournament ends, then delete unconverted rows; delete on request any time | small, a scheduled script |
| 2 | Double opt-in and referral counting (RI-12) | confirm by email before any marketing message; count a referral only once the referred person confirms | medium, HighLevel workflow plus one column |
| 3 | The 12-month fraud hash the policy promises | add an `erased_identifiers` table in auth.db, checked at sign-up and sign-in | small |
| 4 | OTP audit log rotation | logrotate, 30 days, compressed, then delete | small, root |
| 5 | journald and snapshot retention | `MaxRetentionSec=30day` for journald; snapshots 30 days, erasure runbook deletes within them | small, root |
| 6 | Cookie banner "Only essential" keeps analytics on | make "Only essential" deny `analytics_storage` too, and default to denied before a choice for EU and UK visitors | small, one component and one bootstrap |
| 7 | The policy page's wording where it has drifted | one edit pass after decisions 1 to 6 land | small, Tim's words |

Decisions 3, 4, 5 and 6 need no product thinking and can be scheduled now. Decisions 1 and 2 shape the RWC 2027 launch and the prize draw and want a yes or no before the hub form is promoted. Decision 7 follows the rest.

## 1. Register-interest retention (RI-10)

**What exists.** `register_interest` in game.db holds email, optional first name, country and phone, a salted IP hash, the user agent, an invite code, the referrer's code and the HighLevel contact id. Nothing deletes a row except the operator helper from PR #336. The policy page covers accounts, not pre-launch sign-ups.

**What the law says.** Privacy Act IPP 9: keep personal information no longer than needed for the purpose it was collected for. GDPR Article 5(1)(e): the same, with the expectation that the period is stated. Neither sets a number; both expect one.

**Options.**

- (a) Keep every row indefinitely as a marketing list. Simple, but it is the position the law frowns on and the policy would have to say "indefinitely", which reads badly on a sign-up form.
- (b) Delete rows that never converted (no account on play by the end of the tournament) 60 days after the tournament's `endsUtc`, keep converted ones with the account. Rows the person asked to delete go at once through the runbook. The HighLevel contact follows the same rule by a tag and a workflow.
- (c) Delete all rows at go-live, after the referral entries have been counted. Cleanest, but it throws away the only record of who referred whom if a prize is disputed later.

**Recommendation: (b)**, with the referral tally snapshotted into the prize-draw record (gitignored `docs/internal/`) when the draw is made, so (b) does not lose the dispute trail. The form's note then reads: "We keep your details until 60 days after the tournament ends, or until you ask us to delete them." Implementation: a nightly job (systemd timer, `sqlite3`) that deletes `register_interest` rows older than the cut-off whose email has no account, and logs the count; the same window for the HighLevel tag through a workflow Tim sets.

## 2. Double opt-in and confirmed-only referral counting (RI-12)

**What exists.** Anyone can type any address with the consent box ticked. The row is created, the HighLevel contact is upserted, and the referrer's count goes up. No message confirms the address.

**What the law says.** Privacy Act IPP 3 and 4 want the person to know what is collected and why, and the Unsolicited Electronic Messages Act 2007 requires consent before marketing email; a tick on a form by an unknown third party is not consent from the address's owner. GDPR Article 7 puts the burden of demonstrating consent on us, and the usual way to demonstrate it for an email address is a confirmation click. For the prize draw, an unconfirmed entry is also a fraud surface: a referrer can enter addresses they do not own.

**Options.**

- (a) Keep single opt-in. Fastest growth loop, weakest consent record, and the draw can be gamed.
- (b) Double opt-in through HighLevel: the first message is a confirmation only, the `rwc2027_interest` marketing sequence starts on the click, and `register_interest` gains a `confirmed_at` column written by the HighLevel webhook (or by a confirmation link served from play). Referral counts and prize entries use confirmed rows only; the thank-you page shows "friends joined and confirmed".
- (c) Confirm by the OTP sign-in instead of email: a referral counts when the referred person creates an account. Strongest signal, but it moves the confirmation to a later moment and the hub has no account creation today.

**Recommendation: (b)** now, with (c) as the rule for the draw itself if the launch date lets accounts exist before the draw. Implementation: a HighLevel confirmation workflow Tim builds; a `confirmed_at` column and a small webhook route (secret header, like the existing premium-status webhook); `referralCount()` filters on `confirmed_at IS NOT NULL`; the review doc's RI-12 row closes.

## 3. The 12-month fraud hash the policy promises

**What exists.** The policy says that after deletion "we retain a salted hash of the identifier for 12 months for fraud prevention". No table holds such a hash; the DSAR runbook records it in the private log by hand.

**What the law says.** Keeping a hash after erasure is allowed under both regimes when it serves a stated, limited purpose (GDPR Article 17(3) exceptions; Privacy Act IPP 9 "for the purposes") and is itself deleted on schedule. The promise is fine; the gap is that nothing implements it.

**Options.**

- (a) Drop the promise from the policy and keep nothing. Honest, but a banned person can re-register at once.
- (b) `erased_identifiers(hash TEXT PRIMARY KEY, kind TEXT, erased_at INTEGER)` in auth.db, written by the erasure runbook (and by the future self-service delete), checked by `/v1/auth/request` and the register-interest route, purged after 12 months by the same nightly job as decision 1.

**Recommendation: (b)**, using the salt and shape `apps/web/lib/register-interest/store.ts` already uses for `ip_hash` so one convention covers both. The runbook's step 3.1 then writes a row instead of a note.

## 4. OTP audit log rotation

**What exists.** `apps/auth-sms/data/audit/otp.log.jsonl` has grown since August with no rotation; the policy says server logs are kept 30 days and hashed device signals 90 days. The file holds a truncated phone hash and the IP per event.

**Options.** (a) logrotate daily, keep 30 compressed days; (b) have auth-sms roll the file itself by date and delete old ones; (c) stop writing the IP.

**Recommendation: (a)** now (a root logrotate entry, Tim), with the IP kept because the lockout and abuse investigations need it inside the window. The audit writer opens the file per append, so rotation needs no restart.

## 5. journald and snapshot retention

**What exists.** journald on the box holds about 500 MB with no `MaxRetentionSec`; the `tournamental-*` units log user ids and hashed phones through pino. `backups/game-db/` is empty today but the pre-kickoff cron fills it during a tournament, and a restored snapshot would resurrect erased people.

**Recommendation.** `MaxRetentionSec=30day` in `/etc/systemd/journald.conf` (root, Tim), matching the policy. Snapshots: keep 30 days, which the cron script already parameterises, and the erasure runbook's step that deletes the pre-erasure snapshot after 30 days extends to any `.bak` newer than the erasure. Under the GDPR a backup may hold erased data for a stated, short window if it is not restored into service without re-applying the erasure; the runbook should say that sentence.

## 6. The cookie banner and analytics consent

**What exists.** `apps/web/components/analytics/ConsentBanner.tsx` offers "Accept" and "Only essential". "Only essential" keeps `analytics_storage: "granted"` and denies only the `ad_*` flags, and the GTM bootstrap in `GtmRoot.tsx` (and `Analytics.astro` on the marketing site) sets the default to `analytics_storage: "granted"` before any choice. The cookie policy page says GA4 is "loaded only if you accept analytics". So the page promises a choice the banner does not give.

**What the law says.** Privacy Act: no cookie-consent rule as such; analytics with a privacy notice is lawful. GDPR with the ePrivacy Directive: analytics cookies need consent before they are set, "reject" must be as easy as "accept", and a pre-ticked or default-granted state is not consent. The UK follows the same rule.

**Options.**

- (a) Keep the banner as it is and change the cookies page to say analytics is on unless ads are refused. Lawful in NZ, not for EU and UK visitors.
- (b) Make "Only essential" mean what it says: deny `analytics_storage` too, and change the bootstrap default to denied until a choice is stored. Everyone sees the same banner; EU and UK compliance by default; some analytics loss from people who pick essential.
- (c) (b) for EU and UK visitors only, by `cf-ipcountry`, and NZ-style default-on elsewhere. Best of both, but two behaviours to test and explain.

**Recommendation: (b)**, because the cookies page already promises it and the hub's traffic before launch is small enough that the analytics loss is noise. If the loss matters once play is live, move to (c) with the region list in one place. Implementation: three lines in `ConsentBanner.tsx`, the default block in `GtmRoot.tsx` and `Analytics.astro`, and a test that "Only essential" leaves every flag denied.

## 7. Policy wording

Once 1 to 6 are decided, one pass over `apps/marketing/src/pages/legal/privacy.astro` and `cookies.astro`: add the register-interest retention sentence, state the 12-month hash as implemented, keep the 30-day log line true, and align the analytics sentence with the banner. Tim's words; this paper only lists where.

## What the NZ Privacy Act and the GDPR say differently, in one place

| Topic | Privacy Act 2020 (everyone) | GDPR and UK GDPR (EU and UK visitors) |
| --- | --- | --- |
| Lawful basis for marketing email | Unsolicited Electronic Messages Act: consent, which can be inferred from a business relationship | consent, explicit and demonstrable, or legitimate interest with an opt-out; a form tick by a third party is neither |
| Retention | IPP 9: no longer than needed; no fixed numbers | Article 5(1)(e): same, and the period should be stated |
| Erasure | IPP 7 correction; deletion on request is practice, not a hard right | Article 17: a right, 30 days, with the fraud-hash exception under 17(3) |
| Access | IPP 6: a right, 20 working days | Article 15: a right, 30 days |
| Cookies and analytics | no specific rule; notice is enough | consent before non-essential cookies; reject as easy as accept |
| Breach notification | notifiable if serious harm is likely; Privacy Commissioner and affected people, "as soon as practicable" | 72 hours to the supervisory authority; affected people when high risk |
| Children | no fixed age; "reasonable" standard | consent age 13 to 16 by member state (13 in the UK) |

The policy already promises the GDPR positions (30-day erasure, access on request, 12-month hash) to everyone, so the decisions above are about making the code match the promise, not about choosing a regime.

## Needs Tim

Decisions 1 and 2 (yes or no each, before the hub form is promoted). Root changes for 4 and 5. The HighLevel workflow for 2. The policy pass in 7. Everything else is code that can proceed on branches once 1 and 2 are answered.
