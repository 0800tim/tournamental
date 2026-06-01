# Tournamental HighLevel Setup State (2026-06-01)

## Location

- Name: **Tournamental**
- Location ID: `kTxB57bkSkCz2NMi2e5O`
- HQ: Auckland, NZ
- Email: tim@aiva.nz
- Token: `pit-<redacted>`

## DONE via API

### Custom fields (5 created, model: contact)

| Name | Key | Field ID | Data Type |
| --- | --- | --- | --- |
| Tournamental Segment | `contact.tournamental_segment` | `H5rG4zbR23eRs3Wxda8l` | TEXT |
| Tournamental Country Code | `contact.tournamental_country_code` | `ZWNlvyFKIP5Je3MwY0yl` | TEXT |
| Tournamental Why Target | `contact.tournamental_why_target` | `Hs216Tha34tscnH82i8p` | LARGE_TEXT |
| Tournamental Source List | `contact.tournamental_source_list` | `eI9ws44r7LhTYRFvp0sl` | TEXT |
| Tournamental Lead Notes | `contact.tournamental_lead_notes` | `N9MZq5IpsmdjQXZhCA7r` | LARGE_TEXT |

### Custom values (3 created, for merge tags in templates)

| Name | Key | Value |
| --- | --- | --- |
| Tournamental Pool URL | `{{ custom_values.tournamental_pool_url }}` | https://play.tournamental.com/syndicates/new |
| Tournamental Signup URL | `{{ custom_values.tournamental_signup_url }}` | https://play.tournamental.com/syndicates/new |
| Tournamental Concierge Email | `{{ custom_values.tournamental_concierge_email }}` | info@tournamental.com |
| Tournamental Tim Phone | `{{ custom_values.tournamental_tim_phone }}` | +64 21 535 832 |

### Contacts imported: **2,025 of 2,025 (zero errors)**

Each contact has:
- `email` (primary key)
- `companyName` (the org name)
- `country` (2-letter code as Country)
- Tags: `wc2026-outreach`, `<segment>-list`, `country-<lc>`
- All 5 custom fields populated

Counts by segment-list tag (verified):

| Segment | Count |
| --- | --- |
| `club-list` | 1,352 |
| `store-list` | 288 |
| `academy-list` | 158 |
| `media-list` | 140 |
| `federation-list` | 87 |

### Email template SHELLS (5 created, names set, body PUT did not persist via API)

| Name | Template ID |
| --- | --- |
| `WC26 - Clubs - EN` | `6a1d34400d3622573e7101c2` |
| `WC26 - Federations - EN` | `6a1d344125033dcc131fbed1` |
| `WC26 - Media - EN` | `6a1d3442eae4d227f1fa1dca` |
| `WC26 - Academies - EN` | `6a1d3444ce86eaa957072d23` |
| `WC26 - Stores - EN` | `6a1d34450d362227a47101ee` |

**Action for Tim** (5 min total): open each template in HL Email Builder, paste the body from `tools/outreach-lists/_email-variants.md` (or the Drive doc "Tournamental Cold-Outreach Email Variants - Football Audiences"). Subject lines and merge tags are already in the variants doc.

## NOT done via API (token scope or endpoint limits)

| Item | Why blocked | Workaround |
| --- | --- | --- |
| Pipeline create | Token missing `opportunities.write` scope (401 on POST /opportunities/pipelines) | Do in UI: docs/75 Step 2 (3 minutes). 7-stage pipeline name + stage names spelled out there. |
| Workflows create | Workflow create API not available for PIT in v2 (HL Workflow Builder is UI-only via PIT) | Do in UI: docs/75 Step 5. Trigger on `<segment>-list-ready` tag, action send template, branches for opened / replied. |
| Concierge intake form create | `POST /forms` returned 404; v2 endpoint may have moved | Do in UI: docs/75 Step 6 (3 minutes). 7 fields spelled out there. |
| Email template body | `POST /emails/builder/data` accepted the body but the verify GET shows it empty (GHL bug or wrong endpoint shape) | Open each of the 5 template shells in Email Builder, paste body from `_email-variants.md`. 5 minutes. |

## To unblock the API-not-UI path

Tim adds these scopes to `pit-7b9154e8-...` in HL Settings → Private Integrations:

- `opportunities.write` (unblocks pipeline create + opportunity create per contact)
- `workflows.write` (if HL has it exposed for PITs; otherwise UI is the only path)

Then say "scopes added" and Claude can: create the pipeline + open 1 opportunity per contact at stage 1 (Sent).

## Files

- `data/hl-setup/setup-state.md` (this file)
- `data/hl-setup/templates.json` (template IDs)
- `data/hl-setup/import-log.txt` (contact import log: 2,025 ok, 0 err)
- `data/hl-setup/pipeline-response.json` (failed response, kept for forensics)
- `tools/outreach-lists/_master-blast-list.csv` (the 2,025 source rows)
- `tools/outreach-lists/_email-variants.md` (body content for the 5 templates)
- `docs/75-highlevel-ui-setup-checklist.md` (UI-only setup path; covers blocked items)

## How to stage the first send

Once Tim has the pipeline + templates body + workflow in place (about 20 min UI):

1. HL → Contacts → Smart List → Filter `tournamental_segment = federation`.
2. Bulk action: Add Tag `federation-list-ready`.
3. The workflow fires, sends the federation email template via Mailgun, opens an opportunity at stage 1 (Sent).
4. Reply detection moves them to stage 4 (Replied SLA 4h), notification fires.
5. Repeat for media (top 30), clubs (top 200), academies (top 20), stores (top 10), per the channel-aware day plan in docs/74.

The hard work (custom fields + 2025 contacts + merge-tag custom values + template shells) is **done**. The remaining ~25 minutes of UI clicks unlocks the full send pipeline.
