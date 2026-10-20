# Cloudflare outage

> Operator runbook, written 2026-10-20 from `~/.cloudflared/config-tournamental.yml`, the user units and the code. Covers the `tournamental` tunnel being down, the zone being down, and Cloudflare itself being down. No DNS or dashboard change is made by this document; Tim makes those.

## 1. What goes through Cloudflare

Everything public. One named tunnel, `tournamental`, run by the user unit `tournamental-tunnel` from `~/.cloudflared/config-tournamental.yml`, carries every hostname to a loopback port:

| Hostname | Origin on the box | Unit |
| --- | --- | --- |
| tournamental.com, www | 127.0.0.1:9260 (nginx container `tournamental-web`, serves `apps/marketing/dist`) | docker, not a user unit |
| play.tournamental.com, app, fwc2026, wc2026, 2026wc | 127.0.0.1:3300 | `tournamental-web` |
| game.tournamental.com | 127.0.0.1:3360 | `tournamental-game` |
| auth.tournamental.com | 127.0.0.1:3330 | `tournamental-auth-sms` |
| admin.tournamental.com | 127.0.0.1:3340 | `tournamental-admin` (also behind Cloudflare Access) |
| odds.tournamental.com | 127.0.0.1:3341 | `tournamental-odds-ingest` |

Inbound webhooks that arrive through the same tunnel: HighLevel premium-status (`apps/web/app/api/v1/webhooks/highlevel/premium-status`), the Supabase SMS hook (`apps/web/app/api/auth/sms-hook`), the Aiva WhatsApp webhook (`apps/tournament-bot/src/whatsapp/handler.ts`, when configured). The Telegram bot runs in polling mode (`tournamental-tournament-bot`), so it does not need the tunnel to receive updates; it needs outbound internet to api.telegram.org.

Outbound calls that do not go through the tunnel and keep working while the tunnel is down: HighLevel upserts from auth-sms and the web app, SendGrid, the odds providers, ElevenLabs, the Aiva gateway on `localhost:9252`.

## 2. What fails, by kind of outage

| Outage | Symptom | What still works |
| --- | --- | --- |
| **Tunnel down** (unit stopped, credentials revoked, cloudflared crashed) | every hostname answers Cloudflare error 1033 or 530 "origin unreachable"; the watchdog's three probes fail after three minutes | the services themselves, on loopback; the Telegram bot; outbound CRM and mail |
| **Zone down** (DNS or zone config broken, domain issue) | names do not resolve or resolve wrongly; same for email on the domain | nothing public; the box is healthy |
| **Cloudflare edge incident** (their outage) | Cloudflare error pages or timeouts on every hostname, and on every other Cloudflare-fronted site | the box; nothing we can do at the edge |
| **Cloudflare Access down** | admin.tournamental.com cannot be reached even by Tim | everything else |
| **Tunnel up, one origin down** | one hostname answers 502 "bad gateway" from the tunnel; the others work | the rest; restart the one unit |

How to tell which: from the box, `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3300/api/healthz` (and 3360, 3330, 3340, 3341, 9260) says whether the origins are up; `systemctl --user status tournamental-tunnel --no-pager` and `journalctl --user -u tournamental-tunnel -n 50` say whether the tunnel is connected (it logs "Registered tunnel connection" on each of its four edge links); `https://www.cloudflarestatus.com` says whether it is them. If the origins answer and the tunnel log shows reconnect loops or an authentication error, it is the tunnel; if the origins answer and the tunnel is connected, it is the zone or the edge.

## 3. What to do

Work by unit name; nothing else is killed on this shared box.

1. **Tunnel down, box fine:** `systemctl --user restart tournamental-tunnel`, then watch `journalctl --user -u tournamental-tunnel -f` for the four registrations. If it logs an authentication or "tunnel not found" error, the credentials file `~/.cloudflared/<tunnel-id>.json` or the tunnel itself has been removed: Tim recreates it in the dashboard (Zero Trust, Networks, Tunnels), saves the new credentials file, updates `credentials-file` and `tunnel` in the config, restarts the unit. The ingress list in the config is the source of truth for hostnames; a recreated tunnel needs each hostname's DNS CNAME pointed at the new tunnel id (`cloudflared tunnel route dns tournamental <hostname>`), which Tim runs.
2. **One origin down:** `systemctl --user restart <unit>`; check its journal for the crash.
3. **Edge incident:** nothing to fix. Keep the units running; traffic resumes when Cloudflare does. Do not change DNS to point at the box: it has no public ingress and no certificate for these names.
4. **Zone problem:** Tim, in the dashboard: DNS records (one CNAME per hostname to `<tunnel-id>.cfargotunnel.com`), SSL mode, and the Access policy for admin. Nothing on the box helps.
5. **Access down:** Tim can reach the admin console from the box over loopback if he must: `ssh` in and `curl http://127.0.0.1:3340/` works without Access, but the browser session needs the admin cookie, so the practical answer is to wait.

There is no secondary tunnel today (docs/33 lists one as a mitigation); creating one is a Tim decision and needs a second credentials file and a second unit.

## 4. What to tell users

The status page `status.tournamental.com` does not exist (docs/33), so the channels are the marketing site (down with the rest when it is a tunnel or edge outage), the HighLevel email list, the Telegram bot (works during a tunnel outage) and Tim's own social accounts. Keep it short and true:

- During: "Tournamental is unreachable because of a network outage between you and our servers. Your picks and pools are safe; nothing on our side has been lost. We will post here when it is back."
- If picks were affected (a kickoff passed while the site was down): "Picks saved before the outage stand. For matches that kicked off during the outage, [what we decided: the last saved pick counts, or the match is void for scoring]. The decision is Tim's and goes in the same message."
- After: "Back since [time]. Cause: [one line]. Nothing was lost; if your picks look wrong, write to info@tournamental.com."

Never promise a time to recovery during an edge incident.

## 5. During a tournament

A kickoff during an outage is the real cost: picks cannot be saved and the autosave cannot reach the game service. The bracket builder keeps the draft in the browser's localStorage, so a player who had the page open loses nothing once the site returns; a player who could not load the page cannot pick. Decide in advance (and write into the pool rules) what happens to picks for matches that kick off during an outage: today's code locks a pick at kickoff with no grace period. The pre-kickoff snapshot cron (`infra/scripts/game-db-pre-kickoff-backup.sh`) keeps working on the box through an outage.

## 6. After

Record the window (first failing probe to first passing one, from the watchdog log) and the cause in `docs/internal/incidents/<id>/`. If the cause was ours (a dead unit, a bad config edit), the fix goes through the normal branch and build path. If it was Cloudflare's, link their status post.
