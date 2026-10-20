# Data breach response

> Operator runbook, written 2026-10-20 from the code and the units on the box. Tim decides and sends every notice; this document gets him to that decision with the facts in hand. Companion: `docs/runbooks/dsar-access-and-erasure.md` (PR #349) has the full map of where each person's data lives and how to delete it.

## 1. What counts as a breach here

Any of: a copy of `auth.db`, `game.db` or the OTP audit log leaving the box; a secret in `apps/*/.env.production` or `~/.cloudflared/` exposed; an admin session or the HighLevel sub-account used by someone who is not Tim; a bug that shows one person's phone, email, picks or pool membership to another; a backup `.bak` file reachable from the web; a lost or stolen device with a signed-in admin session.

Not a breach on its own: a denial of service, a scraped public leaderboard (public by design), a CSP report, a failed OTP brute-force attempt that the lockout stopped (the audit log shows those).

## 2. What is at risk, by store

| Store | Personal data | Who it is about |
| --- | --- | --- |
| `apps/auth-sms/data/auth.db` | phone, email, names, display name, country, city, favourite team, Telegram id, HighLevel contact id, session IPs and user agents | every account |
| `apps/game/data/game.db` | `register_interest` (email, name, phone, country, salted IP hash); pool owners' email and phone; membership handles and display names; invite recipients' emails and phones (third parties); Bot Arena owner emails; picks under share GUIDs | every account, every sign-up, people invited by members |
| `apps/auth-sms/data/audit/otp.log.jsonl` | truncated phone hash and IP per OTP event | every sign-in |
| `apps/admin/.admin-audit.jsonl` | admin actions with target ids, snapshots of changed records | members touched by admin actions |
| the bot's SQLite file (`apps/tournament-bot/src/storage.ts`) | Telegram chat ids, country, language | bot users |
| HighLevel (off box) | contacts with phone, email, names, tags, custom fields | every account and sign-up |
| `apps/*/.env.production`, `~/.cloudflared/*.json` | API keys (HighLevel, SendGrid, odds, Telegram, Anthropic), JWT and internal secrets, tunnel credentials | not personal data, but each one opens a store above |

The DSAR runbook section 1 has the table per table. Two things to remember when sizing a breach: `register_interest` and `invite_recipients` hold people who have no account and never signed in, and the HighLevel contact is a second copy of every record.

## 3. First hour: contain

Work by unit name. Never `pkill`, `killall` or `fuser` on this box (other clients' services share it; see the shared-box rules in the hivemind).

1. **Freeze deploys.** Create `.deploy/incident.flag` in the main checkout with the incident id, the time and one line (`docs/cicd/03-incident-flag-runbook.md`). Tell every agent session to stop building and merging.
2. **Stop the bleeding, smallest step first.**
   - A leaked secret: rotate it where it was issued (HighLevel, SendGrid, Cloudflare, Telegram BotFather, Anthropic), update the env file, restart only the unit that reads it: `systemctl --user restart tournamental-web` (HighLevel, SendGrid, internal secret, odds), `tournamental-auth-sms` (JWT secret, SendGrid, Aiva, HighLevel), `tournamental-admin` (admin JWT secret), `tournamental-tournament-bot` (bot token), `tournamental-odds-ingest` (odds key). Rotating the auth-sms JWT secret signs everyone out, which is the point.
   - A stolen admin session: rotate `ADMIN_JWT_SECRET` in `apps/admin/.env.production` and restart `tournamental-admin`; every admin cookie dies. Then check `.admin-audit.jsonl` for what the session did.
   - A stolen player session: `DELETE FROM session WHERE user_id = '<id>'` in auth.db (the runbook's 3.2 pattern), or rotate the JWT secret for everyone.
   - A live data-exposure bug: take the surface down rather than the service. The archive and hub hosts can be cut at the tunnel by commenting the ingress line in `~/.cloudflared/config-tournamental.yml` and `systemctl --user restart tournamental-tunnel`; a single route can be blocked in `apps/web/middleware.ts` (a 404 return for the path) with a build and `systemctl --user restart tournamental-web`. Prefer the tunnel cut: no build.
   - Tunnel credentials exposed: delete the tunnel in the Cloudflare dashboard and recreate it (Tim); until then nothing reaches the box from outside, which is the safe state.
   - A device with a signed-in admin session lost: same as a stolen admin session.
3. **Preserve evidence before anything is cleaned.** Copy, do not move: `journalctl --user -u tournamental-<unit> --since "<time>" > /srv/projects/internal/tournamental/docs/internal/incidents/<id>/journal-<unit>.log` for each unit involved; copies of `.admin-audit.jsonl`, `otp.log.jsonl`, and `sqlite3 <db> ".backup '<dir>/<db>'"` snapshots of both databases. `docs/internal/` is gitignored. Note the time of every step in `docs/internal/incidents/<id>/timeline.md`.
4. **Write down what you know in five lines:** what happened, when it started, when it was noticed, which stores and how many rows, whether it is contained. That is the note Tim decides from.

## 4. Scope: who and what

Read-only queries on the snapshots taken in step 3, not the live files. For "how many people":

```bash
S=docs/internal/incidents/<id>
sqlite3 -readonly $S/auth.db "SELECT COUNT(*) FROM user;"
sqlite3 -readonly $S/game.db "SELECT COUNT(*) FROM register_interest; SELECT COUNT(DISTINCT user_id) FROM syndicate_owners_membership; SELECT COUNT(*) FROM invite_recipients;"
sqlite3 -readonly $S/game.db "SELECT COUNT(*) FROM register_interest WHERE country = 'NZ';"
```

For "what happened": the session table carries IP and user agent per login; the admin audit log carries every admin write; the OTP audit log carries every send and verify with a phone hash; the web and game units log request lines to journald. Cloudflare's dashboard has the edge logs for the hostnames (Tim's login).

Record: the categories of data (phone, email, names, picks, pool membership), the number of people, whether any are in the EU or UK (`country` in auth.db, `country` in `register_interest`, `cf-ipcountry` in the request logs), whether children could be affected (no age is collected; the policy assumes adults), and whether the data was encrypted (it is not; SQLite at rest is plain, see docs/33).

## 5. Notify: the law, and who decides

**Tim decides whether to notify, whom, and sends every notice himself from info@tournamental.com.** Nobody else sends anything. This section gives the thresholds and the clocks so the decision is made with them in view.

### New Zealand, Privacy Act 2020 (applies to everyone, Tournamental is a New Zealand company)

- A breach is **notifiable** when it is reasonable to believe it has caused, or is likely to cause, **serious harm** to an affected person (section 112). Serious harm is judged on the sensitivity of the data, what could be done with it, who has it, and whether it was protected. Phone and email together with a name and a pool membership would usually clear that bar once an outsider holds them; a leaderboard handle alone would not.
- Notify the **Privacy Commissioner** as soon as practicable after becoming aware, through the NotifyUs form on privacy.org.nz. Notify the **affected people** as soon as practicable too, directly, unless that is not reasonably practicable, in which case a public notice. Tell them what happened, what was taken, what we did, what they can do, and how to reach us (info@tournamental.com).
- Not notifying a notifiable breach is an offence (fine up to NZ$10,000). Keep the reasoning in the incident folder when the decision is not to notify.

### EU and UK, GDPR and UK GDPR (applies to people in the EU and UK)

- **72 hours** from becoming aware to notify the supervisory authority (Article 33), unless the breach is unlikely to result in a risk to people. There is no EU establishment, so the lead authority is the one for the member state of the affected people; for the UK it is the ICO. Late notification must be explained.
- Notify the **affected people** without undue delay when the risk is **high** (Article 34). Same content as the NZ notice.
- Keep a record of every breach, notified or not (Article 33(5)); the incident folder is that record.

### HighLevel and SendGrid

If the breach ran through the CRM or the mailer (their account, their API key), their terms expect to be told; Tim does that in the same sitting as the authority notice.

### The clocks, in one line

NZ: "as soon as practicable" once serious harm is likely. EU and UK: 72 hours to the authority, "without undue delay" to people when the risk is high. Start both clocks at the moment the breach was recognised (the time in step 3's timeline), not the moment it began.

## 6. Recover

- Reinstate from the pre-incident snapshot only if the live data was changed; a read-only breach keeps the live databases as they are.
- Close the hole: the fix ships through the normal branch, review, build and `systemctl --user restart <unit>` path; the incident flag comes off last.
- Re-issue what was rotated to the systems that need it (HighLevel workflows, the Telegram bot's webhook secret, Cloudflare tunnel credentials).
- Within a week, a short post-incident note in `docs/internal/incidents/<id>/`: cause, timeline, what we told whom, what changes. Anything that changes the design goes into `docs/` on a branch.

## 7. Contacts and places

- Tim: the only sender of notices; info@tournamental.com.
- Privacy Commissioner: privacy.org.nz, NotifyUs.
- ICO (UK): ico.org.uk, report a breach.
- Cloudflare dashboard: zone `tournamental.com`, tunnel `tournamental`.
- Evidence and timeline: `docs/internal/incidents/<id>/` (gitignored).
- Data map and deletion steps: `docs/runbooks/dsar-access-and-erasure.md`.
