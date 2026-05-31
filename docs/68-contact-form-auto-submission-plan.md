# Contact-Form Auto-Submission Plan

**Status:** Draft. No submissions executed.
**Author:** Tim + Claude (orchestrator), 2026-05-31.
**Owner:** Tim Thomas.
**Purpose:** Use Claude's Playwright browser-control tool to fill and submit the contact form on each prospect's website where no published email address exists. Targets are the rows in `tools/outreach-lists/*-sporting-stores.csv` flagged "via contact form on …" or "(unverified)".

This is a **plan**, not a workflow that runs automatically. Tim approves every submission before send.

## 1. Why this exists

Across the 13 country store lists, around 30 to 40 percent of rows have no published outbound email and route through a website contact form instead. Filling 150 to 200 forms by hand burns half a day per round. The browser-control tool already in Claude's environment (the Playwright MCP server) can fill, screenshot, and submit on Tim's behalf as long as the workflow respects the failure modes below.

## 2. Tools available, what they do, what they don't

The Playwright MCP server exposes these primitives in the active session:

- `browser_navigate` - open a URL.
- `browser_snapshot` - DOM accessibility tree (cheap, fast, structured).
- `browser_take_screenshot` - PNG of the current viewport.
- `browser_fill_form` - set a batch of named form fields in one call.
- `browser_type`, `browser_click`, `browser_select_option` - individual interactions.
- `browser_wait_for` - wait on selectors or strings of text.
- `browser_handle_dialog`, `browser_press_key`, `browser_resize`.
- `browser_network_requests` - inspect the underlying XHR (useful for confirming the submit succeeded).
- `browser_evaluate` - execute JS in the page (used sparingly, only for last-mile shimming).
- `browser_run_code_unsafe` - escape hatch; never used in this workflow.

What it does NOT solve:

- **Visual CAPTCHA** (reCAPTCHA v2 image grid, hCaptcha image grid). No automated solver. These are filtered out at planning time, see Section 4.
- **Cloudflare Turnstile / reCAPTCHA v3 invisible scoring**. The headless fingerprint will usually fail. Mitigated by running in headed mode with a real user-agent and slow human-like typing pace, but cannot be guaranteed.
- **Email verification** ("we sent you a code, click the link") before the form even shows. Out of scope; flag the lead for manual handling.
- **Multi-step wizards** with conditional branches the bot cannot foresee. Each unique multi-step is treated as a one-off, not a batch target.

## 3. Per-store recipe

For each row in the outreach CSV where the email column reads "via contact form on …" or `(unverified)`:

1. **Pre-flight scrape (read-only)**
   - `browser_navigate(url)` to the published contact page.
   - `browser_snapshot` to capture the form structure: field labels, field types, required flags, hidden honeypots, any visible CAPTCHA, terms checkboxes.
   - `browser_take_screenshot` for archive evidence.
   - Pattern-match the snapshot against a small catalogue of known platforms (Shopify default, WordPress + Contact Form 7, HubSpot embed, Marketo embed, custom). Each platform has a known field mapping for `name / email / company / phone / subject / message`.
   - Record into `tools/outreach-lists/_form_index.json`:
     ```json
     {
       "store_slug": "soccer-box",
       "country": "uk",
       "form_url": "https://www.soccerbox.com/contact-us/",
       "platform": "shopify-default",
       "captcha": "none",
       "fields": { "name": "#input-name", "email": "#input-email", ... },
       "honeypots": ["input[name=urls]"],
       "consent_checkboxes": ["#agree-terms"],
       "preflight_screenshot": "data/form-preflight/soccer-box.png",
       "preflight_ts": "2026-05-31T10:35:00Z"
     }
     ```
   - This step is **idempotent and contains no PII**. Safe to run in batch.

2. **Pitch-fill generation (no submission)**
   - For each indexed form, compose the per-store pitch from the templates in the Drive Partner Pool Playbook (the COLD OUTREACH template) and the per-row `why_target` text from the CSV. Output `data/form-drafts/<country>/<store-slug>.json`:
     ```json
     {
       "fields": {
         "name": "Tim Thomas",
         "email": "info@tournamental.com",
         "company": "Tournamental (Growth Spurt Ltd)",
         "phone": "+64 21 535 832",
         "subject": "A 5-minute branded WC2026 prediction pool for Soccer Box",
         "message": "<rendered pitch, 600 to 1200 chars>"
       },
       "consent_checked": true,
       "needs_review": false,
       "review_notes": ""
     }
     ```
   - `needs_review: true` on any draft where the pitch could not be cleanly templated (e.g. odd character limits, mandatory dropdowns whose options Claude does not understand, ambiguous "category of enquiry" lists). These bubble to Tim's queue.

3. **Tim's approval gate** (this is the only human step)
   - A single Drive sheet, `_form-submissions-queue`, with one row per draft, columns: `country, store, form_url, status (pending|approved|rejected|skip), message_preview, approved_by, approved_at, submitted_at, result, screenshot_url`.
   - Tim flips `status` to `approved` or `rejected` for each row before any submit runs. Default is `pending`. No row submits while `pending`.
   - Bulk-approve is acceptable but only via the same sheet; there is no "submit everything" button in Claude.

4. **Submit run**
   - For each row where `status = approved`:
     - `browser_navigate(form_url)`.
     - `browser_fill_form` with the drafted fields. Type at a randomised 60 to 120 ms per character on the message field so the keystroke pattern is not robotic.
     - Tick consent checkboxes.
     - `browser_take_screenshot` of the filled form (pre-submit).
     - Click submit.
     - `browser_wait_for` the success indicator (text snippet from preflight, or a network 200 to the submission endpoint).
     - `browser_take_screenshot` of the result page (post-submit).
     - Update the queue row: `status = sent`, `submitted_at`, `result`, links to both screenshots.
   - On any failure (CAPTCHA challenge appears, network 4xx/5xx, success text not found within 10 s): `status = failed`, `result` carries the diagnostic, no retry.

5. **Daily cap and pacing**
   - **Maximum 40 form submissions per calendar day across all stores.** Cold-form submission at higher volume looks like spam to the platforms hosting these forms (HubSpot, Marketo, Cloudflare front) and risks IP / fingerprint blocks that knock out future submissions for everyone.
   - **Pace 90 to 240 s between submissions**, randomised. No fixed cadence.
   - **Per-domain cap of 1 submission per 48 hours**. Two contact forms on the same parent group (e.g. JD Sports UK and JD Sports DE) count as different domains.
   - Run windows: 07:00 to 19:00 in the prospect's local time zone. Don't pile midnight submissions into a Spanish independent's tiny inbox.

## 4. Filtering the list before any submission

Before pre-flight, drop these from the auto-submission queue and route them to a manual-by-Tim queue:

- Forms behind a **visible image CAPTCHA** (reCAPTCHA v2 image grid, hCaptcha image grid).
- Forms behind a **login wall** ("create an account to message us").
- Forms that require **uploading a document** as part of the contact (a few European retailers do this for B2B enquiries).
- Forms that **route to a chatbot** rather than a form (Intercom, Drift, Zendesk Messenger). These are better handled by Tim in person; they expect a human reply within seconds.
- Forms with a **specific enquiry-type dropdown** where none of the visible options match "Marketing partnership / Wholesale enquiry / Press". If we cannot pick a legitimate category, we do not submit.
- Any form on a site that publishes its own anti-bot / anti-scraping notice in the contact-page footer.

Filter is run programmatically against the preflight snapshot. A row's path to "auto-submittable" is recorded in `_form_index.json` as `eligible: true` or `eligible: false` with `eligibility_reason`.

## 5. Legal and ethical posture

This is **partnership outreach to businesses**, not consumer marketing. Different rules apply per jurisdiction.

- **UK PECR / GDPR**: business-to-business marketing via a published contact channel for the recipient's stated purpose (which is what a "contact us" form is for) is permitted under the corporate-communications carve-out. Soft-opt-out applies. Every send must identify Tournamental as the sender, name Tim Thomas, name Growth Spurt Ltd as the legal entity, give a physical address, and link to the privacy notice.
- **CAN-SPAM (USA)**: applies primarily to email and SMS. Web form submission is not email; CAN-SPAM is not the binding rule. Reasonable B2B contact is acceptable.
- **CASL (Canada)**: B2B contact for a "potential business deal" is exempted from express consent if the recipient's business address is published. Tournamental still self-identifies.
- **LGPD (Brazil)** and **LFPDPPP (Mexico)**: similar B2B carve-outs, same self-identification rule.
- **Australia / NZ Privacy Act**: B2B contact via published contact channel is permitted; identification rules same as above.

**The non-negotiables every message must satisfy:**

1. Identify sender by full name, company (Tournamental, a Growth Spurt Ltd brand), and Auckland NZ.
2. State the purpose plainly: invite to set up a free branded prediction pool for WC2026.
3. Link to `https://play.tournamental.com/syndicates/new` so they can act without replying.
4. Provide `info@tournamental.com` as a single point of contact.
5. Acknowledge how Tournamental came across them. Use the `why_target` field: "We saw you are the largest soccer specialist in Aotearoa / Argentina / Spain and …".
6. Offer a clear opt-out: "If you would rather we did not reach out again, reply with NO and we'll remove you from the list."

## 6. Failure modes and what to do

| Failure | Cause | Response |
| --- | --- | --- |
| Submit button disabled | Required field missed, hidden field unset | Re-snapshot, log, fail row, do not retry. |
| Cloudflare interstitial | Bot fingerprint flagged | Skip site, mark for manual. Do not switch to a residential proxy or any evasion technique. |
| reCAPTCHA v3 silently rejects | Risk score too low | Mark for manual. |
| Form posts to a generic info inbox but a published `marketing@` exists | Preflight missed the better inbox | Update CSV row, send by email instead. |
| Success page never appears, network 200 was returned | Some sites swallow the response and reload | Treat as sent only if network confirms 200 + the success endpoint matches the form action. Otherwise: needs Tim's eye. |
| Same prospect submitted by two countries' lists (parent group) | JD Sports, Decathlon, etc. own multiple country domains | Dedupe pre-submit by registrable domain. One submission per parent per 14 days. |
| Same prospect re-emerges from a later research pass | New email surfaced after the form was submitted | The queue carries a `submitted_at`; a later pass skips any row with `submitted_at` set in the last 30 days. |

## 7. Rollout in stages

1. **Stage 0 (week 1)** - Build the preflight + draft pipeline. No submissions. Output: `_form_index.json` for every contact-form row across the 13 country lists, plus draft JSONs sitting in `data/form-drafts/`.

2. **Stage 1 (pilot, 10 forms)** - Tim hand-picks 10 low-risk targets (NZ independents he already knows). Approve them in the queue sheet. Run the submitter. Review every screenshot + result. Iterate the pitch template based on bounces / replies / silence.

3. **Stage 2 (50 forms)** - Once the pilot results look good (>30 % reply rate or open rate), expand to 50 across two countries (NZ + UK).

4. **Stage 3 (200 forms)** - Roll out to all 13 countries within the daily-cap pacing.

5. **Stage 4 (steady-state)** - New rows added to the outreach CSVs are picked up automatically by the preflight pipeline. Tim still hand-approves every batch.

## 8. What lives where

- **Code (if and when we build it)** lives under `tools/outreach-forms/` in this repo. Python, same idiom as the existing `upload_to_sheets.py` and `_build_under_10k.py`.
- **Per-form indices** at `tools/outreach-lists/_form_index.json` (one big JSON, ~200 KB).
- **Drafts** at `data/form-drafts/<country>/<slug>.json`. Gitignored. Regenerated on demand.
- **Screenshots** at `data/form-screenshots/<country>/<slug>-<preflight|prefill|postsubmit>.png`. Gitignored. Useful as evidence if a recipient claims they were spammed.
- **Submissions queue** as a Drive sheet `_form-submissions-queue` in the same folder as the outreach lists (`1bQg04rzrYXtx3QMocASP1dVnmSqtK1rH`).
- **This plan** lives at `docs/68-contact-form-auto-submission-plan.md` (this file) and as a Drive doc `Tournamental Contact-Form Auto-Submission Plan` in the same folder.

## 9. What we do NOT build

- No email scrape from `mailto:` links found mid-page. The lists already cover that.
- No solving of visual CAPTCHAs.
- No residential-proxy rotation, no headless-browser stealth fingerprinting, no UA spoofing beyond a normal headed Chrome.
- No bulk-submit endpoint that bypasses the per-row approval gate.
- No retries on failure. A failed row is a manual job.

## 10. What Tim does

- Approves or rejects each draft row in the queue sheet. Bulk-approve is fine.
- Reviews pilot results before any stage expansion.
- Decides which countries / banners run on a given week.
- Owns the legal stand-up if a recipient pushes back.

## 11. Open questions for Tim

1. Approve the cap at **40 submissions / day, 1 per parent domain / 48 h**, or relax it?
2. Use **info@tournamental.com** as the reply-to on every submit, or rotate (sales@, partner@, tim@)?
3. Phone number on the form: **+64 21 535 832** (Tim's), or a tracked HighLevel forwarding number per country?
4. Do we want a **HighLevel hook** so every submitted form auto-creates a contact + opportunity in the CRM? (Recommended; this is the same flow as the inbound funnel.)
5. Sign-off on Stage 1 pilot list (10 NZ independents), or pick differently?

---

**Sign-off:**

- Tim: _pending_
- Plan version: 1.0
