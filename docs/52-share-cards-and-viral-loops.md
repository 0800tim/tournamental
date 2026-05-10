# 52 — Share cards and viral loops

> Status: **v0.1 — landed**. Animated MP4 variant queued for follow-up.

## 1. Why this exists

VTourn's go-to-market hypothesis is **sharing is the viral spine**. Every
locked bracket is a content unit; every friend who plays through a
shared link is a new candidate user, a new leaderboard cell, and a new
referral allocation under the Drips Network revenue split (see
[docs/19-revenue-share.md](19-revenue-share.md)).

Tim's brief, verbatim:

> Sharing is the way we're going to go viral. We need to make rich share
> cards that are easy for friends to share on Instagram, Facebook,
> TikTok, WhatsApp, message, whatever their own company intranet is,
> just copy and paste, or yeah, the nice share card that comes up with
> Facebook and other OG image / OG meta-based platforms like X etc.

So every bracket gets:

1. A 1200×630 server-rendered PNG suitable for OG / X Card / Telegram
   preview / Slack unfurl / iMessage / Discord embed.
2. A public share-target page (`/share/[bracketId]`) with full OG +
   Twitter Card meta tags so the above platforms unfurl correctly.
3. A one-tap share modal that drives users into Web Share API + 9
   explicit social deep-links + copy-link + PNG download.

## 2. Architecture

```
                    ┌──────────────────────────┐
                    │ /world-cup-2026 (bracket) │
                    │   "Share my bracket" btn  │
                    └────────────┬──────────────┘
                                 │ openShareModal(payload)
                                 v
                    ┌──────────────────────────┐
                    │ <ShareModalProvider>      │
                    │   <ShareModal>            │
                    │     <ShareCard src=…> ◄───┼──── /api/og/[bracketId]
                    │     <ShareButtons …>      │     (satori + resvg)
                    │       wa / tg / x / fb /  │
                    │       li / rd / mail /    │
                    │       copy / dl / native  │
                    └────────────┬──────────────┘
                                 │ each tap →
                                 v
                    POST /v1/analytics/share
                    { bracketId, target, ts }

friends paste link → /share/[bracketId]?handle=…&winner=…&route=…
                          ↓
                  generateMetadata() emits:
                  og:title, og:description, og:image=/api/og/[bracketId],
                  twitter:card=summary_large_image
                          ↓
                  HTML hero + CTA "Make your prediction"
                          ↓
                  user clicks → /world-cup-2026 → new bracket → loop
```

### Files

- `packages/social-cards/src/cards/bracket-pick.ts` — new `bracket-pick`
  card kind. Compact, winner-spotlight + R16/QF/SF/FINAL route strip.
  Lives alongside the `bracket-prediction` long-list card.
- `apps/web/app/api/og/[bracketId]/route.ts` — Next route. Uses
  `@vtorn/social-cards.buildCard("bracket-pick", …)` then satori →
  SVG → resvg → PNG. 1 hr public + 24 hr SWR cache.
- `apps/web/app/share/[bracketId]/page.tsx` — server-rendered Next
  page. `generateMetadata` produces canonical OG + Twitter Card tags.
- `apps/web/app/api/analytics/share/route.ts` — POST stub for
  viral-loop tracking. 204 on success; logs to stdout until the real
  analytics pipeline lands.
- `apps/web/components/share/ShareModal.tsx` — the dialog itself.
- `apps/web/components/share/ShareButtons.tsx` — the grid of one-tap
  social targets. Each button fires `POST /v1/analytics/share` on
  click via `fetch(..., { keepalive: true })`.
- `apps/web/components/share/ShareModalProvider.tsx` — context +
  `useShareModal()` hook so any descendant page can open the modal
  without prop-drilling. Bracket page wraps its content in the
  provider; sibling agent's `Save & Share` button calls
  `useShareModal().open({ bracketId, handle, ... })`.
- `apps/web/components/share/share-targets.ts` — the canonical
  deep-link templates. **One file to add a new target.**
- `apps/web/lib/share/payload.ts` — encode/decode for the bracket
  payload (handle, winner, route) in URL query strings until the
  persisted bracket API lands.

## 3. Per-network share-URL templates

The 9 targets and their templates are kept in
`apps/web/components/share/share-targets.ts`. Reproduced here for
docs-as-spec reasons:

| Target     | URL template                                                                                          | Caption limit            |
| ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------ |
| WhatsApp   | `https://wa.me/?text=<text+url>`                                                                       | None hard, ≤ 1000 safe   |
| Telegram   | `https://t.me/share/url?url=<url>&text=<text>`                                                         | None hard, ≤ 1000 safe   |
| X          | `https://twitter.com/intent/tweet?text=<text-without-url>&url=<url>`                                   | 280 (URL counts as 23)   |
| Facebook   | `https://www.facebook.com/sharer/sharer.php?u=<url>`                                                   | n/a (FB ignores text)    |
| LinkedIn   | `https://www.linkedin.com/sharing/share-offsite/?url=<url>`                                            | n/a (LI ignores text)    |
| Reddit     | `https://reddit.com/submit?url=<url>&title=<title>`                                                    | title ≤ 300              |
| Email      | `mailto:?subject=<subject>&body=<text+url>`                                                            | subject ≤ 78 safe        |
| Copy link  | `navigator.clipboard.writeText(url)` + toast                                                           | n/a                      |
| Download   | `fetch(<png-url>).then(blob → a.click)`                                                                | n/a                      |
| Native (Web Share API) | `navigator.share({ title, text, url })` — feature-detected                                | n/a                      |

`X` strips the URL from the `text` param before sending because
twitter.com's own composer otherwise duplicates the URL once via
`text` and once via the dedicated `url` param.

## 4. The 1200×630 OG composition

Rendered server-side by `@vtorn/social-cards` (`satori` + `resvg`).
The composition is the `bracket-pick` card kind (see
`packages/social-cards/src/cards/bracket-pick.ts`):

```
┌──────────────────────────────────────────────────────────────┐
│  [VTOURN]  ───────────────────────────  FIFA World Cup 2026  │  ← brand strip
├──────────────────────────────────────────────────────────────┤
│  [MY PICK]  FIFA World Cup 2026 — predicted by @messi-fan    │
│                                                                │
│   🇦🇷  ARGENTINA                                              │  ← winner spotlight
│        TO LIFT THE TROPHY                                     │
│   "Picked Argentina to lift the trophy"                       │
│                                                                │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐                       │
│  │ R16  │ │ QF   │ │ SF   │ │ FINAL    │                       │  ← route strip
│  │ ARG  │ │ BRA  │ │ FRA  │ │ ARG 🇦🇷  │                       │
│  └──────┘ └──────┘ └──────┘ └──────────┘                       │
│  +3 long-shot picks — more points if they hit                  │
├──────────────────────────────────────────────────────────────┤
│  @messi-fan · vtourn.com/r/<bracketId>                ✓ VTourn │  ← footer
└──────────────────────────────────────────────────────────────┘
```

The Final cell is flame-orange (the brand accent for predictions);
others are dark ink. The route strip is filled left-to-right so a
scroll-stopper sees the winner first, then "how did they get there"
second.

## 5. Caching policy

| Surface                       | Cache-Control                                                            |
| ----------------------------- | ------------------------------------------------------------------------ |
| `GET /api/og/[bracketId]`     | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`      |
| `GET /share/[bracketId]`      | Edge cache via `force-dynamic` + Next ISR; 5 min s-maxage in front       |
| `POST /v1/analytics/share`    | `private, no-store` — write path                                         |
| `apps/web/public/og/bracket/` | Static once written; long-cache by the CDN                               |

Per CLAUDE.md every new surface declares its policy here; please update
this table when you touch one of these routes.

## 6. Viral-loop measurement

Every share interaction posts to `/v1/analytics/share`. The wire format
is stable:

```json
{ "bracketId": "string", "target": "whatsapp" | "telegram" | … | "copy" | "download" | "native", "ts": 1715472000000 }
```

The current handler logs to stdout. When the analytics agent ships the
real pipeline (likely ClickHouse with a fan-out from Redis), it should
write to a `share_events` table with the same columns + the IP /
country if available from the request. The follow-up agent does not
need to change any caller; the wire format is stable.

KPIs to chart:

- **Share rate** — `share_events / bracket_locks` per day.
- **Top targets** — distribution by `target`.
- **Click-through-from-share** — join `share_events` to `/share/[id]`
  page loads (via referrer or a deferred cookie).
- **Conversion** — friends who land on `/share/[id]` and then lock
  their own bracket within 24h.

## 7. How to add a new sharing target

1. Append a new entry to `SHARE_TARGETS` in
   `apps/web/components/share/share-targets.ts` with a unique `id`,
   `label`, `iconKey`, `newTab`, and `buildUrl(ctx)`.
2. Add the `id` to `ALLOWED_TARGETS` in
   `apps/web/app/api/analytics/share/route.ts` so the tracking
   endpoint accepts it.
3. Add an icon glyph in `ShareButtons.iconFor`.
4. Update the table in §3 of this doc and run `pnpm --filter @vtorn/web
   test`.

Test files to update (~2 lines each):

- `__tests__/share-modal.test.tsx` — add a deep-link assertion.

## 8. Future: animated 6-second MP4 shares (stretch)

Tim's verbatim brief on the stretch:

> We can create little animated MP4s using just text and flags and
> canned images so that it doesn't cost API credits to generate short,
> six-second animated videos of how they pick their winners based on
> screenshots or something like that of their picks, with the winner
> being a bit more prominent at the end.

Approach for the next-iteration agent:

1. **Pre-render frames with satori + resvg** at 6 keyframes (R16 →
   QF → SF → FINAL → winner-zoom → CTA). Each frame is a `bracket-pick`
   card variant where the "current stage" is highlighted.
2. **Interpolate to 60 frames** using a simple per-pixel crossfade
   (resvg supports this; or use Sharp's composite-over). 6 seconds @
   10fps is the cheapest viable variant; 24fps is the polished one.
3. **Encode with ffmpeg** server-side: `ffmpeg -framerate 24 -i
   frame_%03d.png -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags
   +faststart out.mp4`. No API credits, ~1.5 s on a Hetzner CCX22.
4. **Cache** at `apps/web/public/og/bracket/<bracketId>.mp4` with the
   same long-cache policy as the PNG.
5. **Expose** as `/api/og/[bracketId]/mp4` so the share modal can offer
   a "Download video" button alongside "Download PNG".
6. **Audio**: skip for v1. A pre-rendered 6-sec mp3 with a brand sting
   can be mixed in later via a second ffmpeg pass.

Estimated effort: 1 day for the renderer, 0.5 day for the modal hookup,
0.5 day for the cache + CDN headers. The reviewer agent should verify
the mp4 stays ≤ 1 MB on the brand-default settings before merging.

## 9. Test plan

- `pnpm --filter @vtorn/web test` — 33 new tests across
  `share-card-og.test.ts` (13) and `share-modal.test.tsx` (20). All
  green at branch-create time.
- `pnpm --filter @vtorn/social-cards test` — 15 new `bracket-pick`
  tests; all green.
- Manual: visit `/world-cup-2026/share/test-bracket-123` → OG image
  renders at `/api/og/test-bracket-123`. View source → confirm
  `og:image`, `og:title`, `og:description`, `twitter:card` present.
- `curl -A "facebookexternalhit/1.0" https://2026wc.vtourn.com/share/test-bracket-123` 
  on prod → returns HTML with the meta tags FB needs to unfurl.
