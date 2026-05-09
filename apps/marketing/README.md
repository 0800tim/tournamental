# @vtorn/marketing

> The marketing site for VTourn, served at `vtourn.com` (prod), `preview.vtourn.com` (staging), `vtorn-www.aiva.nz` (dev).

## Stack

- Astro 4 (static-first, island-architecture).
- Tailwind 3 with a small custom palette (ink + accent + flame + emerald).
- No JS framework on the lightest pages; small islands only where interactive.

## Run

```bash
pnpm -F @vtorn/marketing dev    # http://localhost:3320
pnpm -F @vtorn/marketing build  # static dist/
pnpm -F @vtorn/marketing typecheck
```

Through the dev tunnel: `https://vtorn-www.aiva.nz`.

## Pages (v0.1)

| Path                | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `/`                 | Hero, three-pillar pitch, syndicates teaser, World Cup CTA.          |
| `/why`              | Why VTourn exists. Vision and reasoning.                              |
| `/how-it-works`     | Six-step user journey.                                                |
| `/syndicates`       | For hosts: office sweepstakes, friend pools, fan clubs.               |
| `/influencers`      | For creators and partner program.                                     |
| `/leaderboards`     | Global / country / tournament / syndicate scopes.                     |
| `/world-cup-2026`   | Playbook for the 2026 World Cup tournament.                           |
| `/open-source`      | Apache 2.0 + CC-BY 4.0 + Drips Network revenue share.                 |
| `/contribute`       | How to ship code, docs, designs, integrations. Drips opt-in.          |
| `/start`            | Pick a path: player / host / developer. Onboarding prompt library.    |
| `/legal`            | Privacy, cookies, real-money disclaimer, contact.                     |

## Design tokens

```css
--ink-900: #0a0e1a   /* page background */
--ink-100: #e7ecf7   /* foreground text */
--accent-500: #5a96d8 /* primary CTA / brand pop */
--flame-500: #ff8a3d  /* accent emphasis (rare) */
--emerald-500: #21a34a /* pitch / success */
```

## Performance budget

- LCP < 1s on a mid-range Android (Cloudflare-edge cached).
- Total page weight < 250KB on every route except `/` (which embeds the demo card image, ≤ 600KB total).
- No JS framework on `/legal` and `/contribute` (pure static).
- Cache policy per [`docs/22-deployment-and-tunnels.md`](../../docs/22-deployment-and-tunnels.md).
