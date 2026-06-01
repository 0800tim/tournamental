# Internal docs policy

Tournamental is open-source. Two kinds of writing happen in this repo:

1. **Engineering**  -  design specs, architecture, data flows, API contracts, runbooks. This stuff ships in public docs/ folders and is part of the open-source story.

2. **Marketing + outreach + commercial**  -  cold-outreach playbooks, prospect lists, sales scripts, CRM campaign configs, partner-pitch decks. **This stuff does not live in git.**

## The rule

If a doc, list, or script contains any of:

- A specific organisation we are pitching, alongside their contact details.
- Email addresses we did not get explicit permission to publish.
- HighLevel campaign-specific setup state (location IDs, custom-field IDs created for a campaign, template IDs, contact-import logs).
- Cold-outreach pitch copy targeted at named segments.
- Anything that would identify a confidential commercial conversation.

...it lives in `docs/internal/` on disk and **nowhere else in this repo**. The canonical archive copy lives in the Growth Spurt Google Drive folder.

## Where the rule is enforced

- `.gitignore` ignores `docs/internal/`, `tools/outreach-lists/`, `data/hl-setup/`, `data/form-drafts/`, `data/form-screenshots/`.
- New contributors: read `docs/internal/README.md` (only visible if you have local access) for the folder shape.
- Code reviewers: reject any PR that adds prospect emails, marketing playbooks, or campaign-state files outside `docs/internal/`.

## Why this matters

The open-source repo is a recruiting story and a contributor magnet. It also gets indexed, cached, and forked. A prospect's email address in a public commit is permanent. A commercial pitch sitting in markdown next to engineering specs blurs the line between "product" and "go-to-market" in a way that hurts both.

## What stays in public docs

Engineering docs about how the product works, including its CRM integration code (`docs/61-highlevel-integration.md`), are public. The difference: engineering docs describe **how the platform behaves**, marketing docs describe **whom we're pitching and what we're saying to them**.

If you're not sure: ask. If still not sure: write it to `docs/internal/` and we can move it out later.
