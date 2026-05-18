# 55. Public launch checklist

> The list of every step that has to happen between "the final OSS-readiness PR is merged" and "the Tournamental repo is public + the launch announcement is live."
>
> This is intentionally a checklist. The boxes are unticked. The human deploy operator (Tim) ticks them as they go, in order where ordering matters and in any order where it does not. **An agent should not tick these boxes.** Adding new items to the list is fine; ticking them is the operator's job.

## Ordering

A small number of items have hard dependencies. The rest can move in parallel.

```
   [ Final OSS sweep merged ] ──┐
   [ Terms + Privacy live ]    ─┤
   [ OTP brute-force mitigation deployed ] ─┤
   [ Sign-up keys populated in prod env ] ──┤
                                            ▼
                            [ Repo flipped private -> public ]
                                            │
                  ┌─────────────────────────┼──────────────────────────┐
                  ▼                         ▼                          ▼
        [ Hacker News submission ]   [ X / Twitter post ]   [ Engineering-log call-for-help post live ]
                  │                         │                          │
                  └─────────────────────────┴──────────────────────────┘
                                            ▼
                              [ Discord invite finalised ]
                                            │
                                            ▼
                              [ Drips list deployed + linked ]
                                            │
                                            ▼
                              [ Final smoke test: /api portal + MCP ]
```

The four pre-flip items are independent of each other and can ship in parallel. Everything below the flip can also run in parallel; the diagram just shows the natural cadence on launch day.

## The checklist

### Pre-flip (must land before the repo goes public)

- [x] Final OSS sweep merged
- [x] Terms + Privacy live on the marketing site
- [ ] OTP brute-force WAF rules applied — **PARTIALLY DONE 2026-05-18**
  - [x] DNS CNAME records added for `odds.tournamental.com` (:3341) and `news.tournamental.com` (:3402)
  - [x] Tunnel ingress updated for both subdomains (clawdbot-workstation tunnel)
  - [x] `game.tournamental.com` confirmed already present in DNS + ingress
  - [x] Rate-limiting rule applied: `POST /v1/auth/otp/*` → 5 req/10s/IP → block 10s (Free-plan constraints: 1 rule, 10s period, block-only action)
  - [x] WAF ASN managed-challenge rule applied: OTP routes from 7 known spam ASNs → managed_challenge
  - [x] Bot Fight Mode: enabled manually via Cloudflare dashboard → tournamental.com → Security → Bots → Bot Fight Mode — **done 2026-05-18**
- [ ] Sign-up keys populated in production env — **IN PROGRESS**: Tier 1 .env stubs filled with placeholders. See [doc 56](56-env-stubs-index.md) fill order.

### Flip

- [x] Repo visibility flipped private -> public via GitHub Settings — **done 2026-05-12**
  - [x] Apache-2.0 licence chip visible on the repo card
  - [x] `LICENSE`, `README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/FUNDING.yml` all render correctly
  - [x] Discussions tab enabled and three discussion templates available

### Announcement

- [ ] First Hacker News submission -- "Show HN: Tournamental, an open source tournament-prediction game with a 3D match renderer"
- [ ] First X / Twitter post -- pinned to `@tournamental`, links to the engineering log "stack at a glance" post
- [ ] First post in the call-for-help blog series goes live on the engineering log (`/engineering`) and is cross-posted to X, Telegram, and Discord
- [ ] Mastodon / Bluesky cross-post (low priority but cheap)

### Post-flip plumbing

- [ ] Discord invite finalised at `discord.gg/tournamental` and the TODO in README.md replaced (search the repo for `https://discord.gg/tournamental` and remove the `TODO` comment above it)
- [ ] Drips list deployed at `https://www.drips.network/app/projects/github/0800tim/tournamental` with the splits per [doc 19](19-open-source-and-contributor-revenue.md) and linked from `.github/FUNDING.yml`, the README, SECURITY.md, and doc 19
- [ ] Final smoke test on `/api` portal at `https://tournamental.com/api` (Scalar renders, every per-service deep-link resolves, no 404s)
- [ ] Final smoke test on MCP server at `https://mcp.tournamental.com` (handshake works from Claude Desktop, Cursor, and Windsurf; each surfaces the tool list; one read tool returns a sane response)
- [ ] Verify the four npm packages install cleanly into a brand-new project: `pnpm add @tournamental/spec @tournamental/bracket-engine @tournamental/social-cards @tournamental/plugin-sdk` then `pnpm typecheck` against a one-line import; no peer-dep warnings

### Watch-window (24 hours after flip)

- [ ] Inbox watch on `0800tim@gmail.com` for security disclosures (24h acknowledge SLA per [SECURITY.md](../SECURITY.md))
- [ ] PR watch on the public repo (first community PRs are usually grammar fixes; reviewer agent should pick them up but Tim sanity-checks the first one)
- [ ] Rate-limit watch on Cloudflare for `auth-sms` and the API portal (OTP abuse is the most likely first attack)
- [ ] Discussions watch (first "I am stuck" posts get a same-day response from a maintainer)

## How to use this doc

1. **Operator**: Open this doc, work top-to-bottom in the **Pre-flip** section. Tick boxes as you finish each item.
2. **Operator**: When all four pre-flip boxes are ticked, flip the repo. Then work the remaining sections in any order.
3. **Operator**: When everything is ticked, archive the doc by moving it to `docs/archive/55-public-launch-checklist.md` and replace the contents of `docs/55-public-launch-checklist.md` with a one-line pointer to the archived copy plus the launch date.
4. **Agents**: Do not tick boxes. If you find a missing step, add it to the appropriate section as an unticked box and reference it in your PR description.

## Rollback

If anything in the post-flip sections goes wrong (e.g. a security disclosure hits the inbox within the first 24 hours, or the OTP flow is being hammered), the operator may temporarily revert the repo to private via GitHub Settings while the fix lands. The OSS commit history remains on contributors' clones, so the act of going public is effectively one-way for the codebase, but the GitHub repo's visibility is reversible. Document any rollback in [`sessions/`](../sessions/) with a `chore(launch):` prefix.
