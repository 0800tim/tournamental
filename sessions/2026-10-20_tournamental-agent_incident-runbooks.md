# 2026-10-20, incident runbooks: data breach, Cloudflare outage

**Task**: burn round 7, the two runbooks the docs/33 refresh (PR #341) listed as missing.
**Branch**: `docs/incident-runbooks` (worktree, docs only). Written from the tunnel config, the user units, the webhook routes and the code; nothing run, no DNS or dashboard change.

## `docs/runbooks/data-breach-response.md`

What counts as a breach; the data at risk per store (linking the DSAR runbook in PR #349 for the per-table map); containment by unit name (rotate and restart the one unit that reads a secret, cut a host at the tunnel rather than rebuild, preserve evidence first); scoping queries on snapshots; the NZ Privacy Act 2020 notifiable-breach threshold (serious harm, Privacy Commissioner via NotifyUs, as soon as practicable) and the GDPR 72-hour clock to the authority plus the high-risk notice to people; the rule that Tim decides and sends every notice; recovery and the post-incident note.

## `docs/runbooks/cloudflare-outage.md`

Every hostname rides the one `tournamental` tunnel to a loopback port, so a tunnel or edge outage takes down all public surfaces while the box stays healthy; which webhooks need the tunnel and which outbound calls do not; how to tell tunnel, origin, zone and edge apart from the box; what to do for each (restart the unit, recreate the tunnel with Tim, wait out an edge incident, never point DNS at the box); what to tell users, with the Telegram bot as the channel that survives; the kickoff-during-outage question for pool rules.

## Needs Tim

Decide the kickoff-during-outage rule before RWC 2027; whether to run a second tunnel; the status page question from docs/33.
