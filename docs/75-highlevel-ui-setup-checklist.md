# HighLevel UI Setup Checklist (Tournamental WC2026 Cold Outreach)

**Why this doc exists:** the Private Integration Token in our environment (`pit-4367e9fa-...`) is scoped to almost nothing - every write endpoint returns 401 "not authorized for this scope". Custom fields, pipelines, contacts, workflows, all blocked. Claude can't build the HL side via API with that token. Path forward is either (a) create a broader-scope PIT, or (b) do the setup in the HL UI in about 20 minutes.

This is the (b) path. Step-by-step. Tim runs through it once, the campaign is wired.

**Location:** Growth Spurt (id `CpsjTP9fg5ZBeh9JgPFo`), not Aiva. Tournamental is a Growth Spurt brand.

## Path A: just add scopes to the existing PIT (5 minutes)

If Tim wants Claude to do the setup, this is the quickest unblock:

1. HighLevel → **Settings → Private Integrations**.
2. Find the token `pit-4367e9fa-f790-47fe-897c-bf3a06b1a576` (or whichever is in `HIGHLEVEL_API_KEY`).
3. Edit, add these scopes:
   - `contacts.write` + `contacts.readonly`
   - `opportunities.write` + `opportunities.readonly` (covers pipelines)
   - `locations.readonly` + `locations/customFields.write` + `locations/customFields.readonly`
   - `locations/tags.write`
   - `workflows.readonly`
   - `forms.readonly` + `forms.write`
   - `conversations.readonly` (for reply detection later)
4. Save. Token stays the same; new scopes apply immediately.
5. Reply "scopes added" and Claude does the rest in 30 minutes via API.

## Path B: do it in the HL UI (15 to 20 minutes)

### Step 1: Custom fields (5 minutes)

HighLevel → **Settings → Custom Fields → Contact** → Add Field, for each of:

| Field name | Field type | Field key (auto) |
| --- | --- | --- |
| Tournamental Segment | Text Box | `tournamental_segment` |
| Tournamental Country Code | Text Box | `tournamental_country_code` |
| Tournamental Why Target | Large Text Area | `tournamental_why_target` |
| Tournamental Source List | Text Box | `tournamental_source_list` |
| Tournamental Lead Notes | Large Text Area | `tournamental_lead_notes` |

### Step 2: Pipeline (3 minutes)

HighLevel → **Opportunities → Pipelines → Create New Pipeline**. Name: `WC2026 Cold Outreach`. Add 7 stages in order:

1. `1 - Sent`
2. `2 - Opened (no reply)`
3. `3 - Clicked link`
4. `4 - Replied (SLA 4h)`
5. `5 - Yes Concierge`
6. `6 - Yes Self-Serve`
7. `7 - No / Bounce`

Save. Note the pipeline ID from the URL (looks like `/pipelines/<pipeline-id>`); paste it into `data/hl-setup/pipeline-id.txt` if Claude needs it later.

### Step 3: Import contacts (3 minutes)

HighLevel → **Contacts → Import → Upload CSV** → select `tools/outreach-lists/_master-blast-list.csv` (2,025 rows).

Field mapping:

| CSV column | HL field |
| --- | --- |
| `email` | Email |
| `name` | First Name (you can map to Company Name instead if preferred; "name" in our CSV is the organisation, not a person) |
| `segment` | Custom: Tournamental Segment |
| `country` | Custom: Tournamental Country Code |
| `source_files` | Custom: Tournamental Source List |
| `why_target` | Custom: Tournamental Why Target |
| `notes` | Custom: Tournamental Lead Notes |

Tag every imported contact with: `wc2026-outreach`, `<segment>-list` (e.g. `club-list`).

HL deduplicates on email automatically (the location is set to "contactUniqueIdentifiers": ["email","phone"]).

### Step 4: Email templates (3 minutes)

HighLevel → **Marketing → Email Templates → Create New**. Create 5 templates, one per segment, using the bodies from `tools/outreach-lists/_email-variants.md` (which is also in Drive as "Tournamental Cold-Outreach Email Variants - Football Audiences").

Template names:
- `WC26 - Clubs - EN`
- `WC26 - Federations - EN`
- `WC26 - Media - EN`
- `WC26 - Academies - EN`
- `WC26 - Stores - EN` (from the existing Partner Pool Playbook COLD OUTREACH section)

Merge tags in the body should map to:
- `{{contact.first_name}}` (or `{{contact.company_name}}`)
- `{{custom_values.tournamental_why_target}}`

### Step 5: Workflows (5 minutes per segment, 5 segments = 25 minutes; can be cut to 1 segment first to test)

HighLevel → **Automation → Workflows → Create Workflow**.

Name: `WC26 Cold Send - <Segment>` (5 of these total).

Workflow steps:
1. **Trigger**: Contact tagged `<segment>-list-ready` (manual tag for staged sends).
2. **Action**: Add Opportunity to Pipeline `WC2026 Cold Outreach`, Stage `1 - Sent`, Opportunity Name `{{contact.company_name}} - <Segment>`.
3. **Action**: Send Email, using template `WC26 - <Segment> - EN`.
4. **Wait**: 1 hour.
5. **If/Else**: Has contact opened email?
   - **Yes**: Move opportunity to `2 - Opened (no reply)`.
   - **No**: stay at `1 - Sent`.
6. **If/Else**: Has contact replied?
   - **Yes**: Move opportunity to `4 - Replied (SLA 4h)`. Send internal notification to Tim. Stop workflow.
   - **No**: continue.

Save + Publish.

### Step 6: Concierge intake form (3 minutes)

HighLevel → **Sites → Forms → Create Form**. Name: `Tournamental Concierge Intake`.

Fields:
- Company name (text)
- Logo (file upload, PNG)
- Brand primary colour (text, hex)
- Brand accent colour (text, hex)
- Prize details (large text)
- Banner image (file upload, JPG, optional)
- Preferred pool URL slug (text)
- Best contact phone (text)

Form action on submit: Add tag `concierge-intake-submitted`, send notification to Tim.

Embed URL / share URL: copy from the form publish modal, paste it as the reply template for Yes-Concierge contacts (Tim drops this in his Gmail canned-response for "yes please build it for us" replies).

### Step 7: Internal notifications + SLA (2 minutes)

HighLevel → **Settings → My Profile** → confirm Tim's notification settings include push notifications for "new conversation message".

Wire one Automation:
- **Trigger**: Opportunity stage changed to `4 - Replied (SLA 4h)`.
- **Action**: Send Tim a push notification "{{contact.company_name}} replied. 4h SLA."

That's it. Total: ~20 minutes of Tim clicks, 5 segments wired, 2,025 contacts imported, all custom fields in place, pipeline live, intake form ready.

## Quick links once setup is done

After Tim finishes the UI setup, drop these URLs into this doc for future reference:

- Pipeline URL: `<paste>`
- Template URLs: `<paste 5>`
- Workflow URLs: `<paste 5>`
- Concierge intake form URL: `<paste>`

## After setup: how to stage the sends

Once the workflows are live and the import is done:

- All 2,025 contacts sit tagged `wc2026-outreach` + `<segment>-list` but NOT `<segment>-list-ready` yet (workflows only trigger on the `-ready` tag).
- To stage a batch send, filter contacts by segment + country + audience-priority, then bulk-apply the `<segment>-list-ready` tag.
- Each tagged contact enters the workflow, gets the cold email at the next sendable window.
- Per the master playbook: send federations + top-30 media on Day 1, top-200 clubs + 288 stores + 158 academies on Day 2, long-tail clubs + creators on Day 3.

Bulk-tag in HL:
- Contacts → Smart List → Filter `tournamental_segment = federation` → Bulk action → Add Tag `federation-list-ready` → confirm.

The workflows pick up from there, with the daily 800-send cap enforced at HL/Mailgun level automatically.

## Sign-off

- Tim: pending
- Plan version: 1.0
