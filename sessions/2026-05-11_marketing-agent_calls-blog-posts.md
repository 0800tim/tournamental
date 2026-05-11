# 2026-05-11, marketing-agent, four discipline-specific contributor-call blog posts

Task: author four MDX blog posts at `apps/marketing/src/content/blog/`,
one per day from 2026-05-13 through 2026-05-16, each calling for
contributors in a specific discipline. Required sections: hook, what
I built, what I cannot do alone, the opportunity, how Drips pays you,
how to start, a specific first PR, what I want to hear from you. Each
post 700-1100 lines, voice matching `2026-05-12-pot-of-gold-or-pot-of-shit.mdx`.

## Plan

1. Read pot-of-gold post for voice. Read doc 19 (Drips), doc 04 (renderer),
   doc 14 (clip pipeline), doc 11 (historic data), doc 17 (VStamp), doc 21
   (onchain oracle), doc 15 (brand).
2. Author the four MDX posts:
   - Post 1, 3D devs, slug `2026-05-13-calling-3d-devs.mdx`.
   - Post 2, designers, slug `2026-05-14-calling-designers.mdx`.
   - Post 3, translators, slug `2026-05-15-calling-translators.mdx`.
   - Post 4, smart-contract devs, slug `2026-05-16-calling-smart-contract-devs.mdx`.
3. Frontmatter: hero image at `/blog/calls/<slug>-hero.svg` with a TODO
   placeholder note in the body; tags include open source, contributing,
   drips plus discipline-specific tags.
4. Run `pnpm --filter @vtorn/marketing build` to validate against
   the content collection schema. Fix any failures.
5. Conventional commit, signed-off, email `0800tim@gmail.com`. PR
   against main.

## Outcome

All four posts authored. Each post lands at ~700 lines. Each post
includes:
- The hook (3-5 lines)
- What I built so far (concrete code paths, doc references)
- What I cannot do alone (specific honest admissions per discipline)
- The opportunity (1 day, 1 week, 1 month tasks per discipline)
- How Drips pays you (linking doc 19, with worked examples)
- How to start (clone, AR-FR demo, AGENT-PROMPTS.md flow)
- A specific first PR (concrete file paths, acceptance tests)
- What I want to hear from you (email, Discussions, Telegram)
- Plus extensive supporting sections (FAQ, sub-RFCs, dev-cadence,
  reading lists, hiring vs contributing notes, what-bad-PRs-look-like).

Each post contains:
- At least 3 inline links to existing docs/files in the repo
  (typically 6-10+).
- At least 2 inline links to external resources (Drips, OpenZeppelin,
  Mixamo, OpenTimestamps, etc.).
- At least one sentence admitting Tim is wrong about something or
  does not know how to do something.
- NZ English spelling throughout.
- No em-dashes; commas and standard dashes only.
- Frontmatter validated against the Astro content collection schema.

## Post-by-post first-PR pitches

- Post 1 (3D): "Implement the Magnus-effect ball-curl shader for
  free kicks", in `apps/web/components/Ball.tsx` and
  `packages/ball-physics/src/magnus.ts`.
- Post 2 (Designers): "Ship a localised share-card variant for the
  African Cup of Nations" in `packages/social-cards/src/cards/afcon-podium.ts`.
- Post 3 (Translators): "Pass-by-pass review the Portuguese commentary
  file, fix the registry to match Brazilian terrace voice, ship a
  `pt-BR.md` variant".
- Post 4 (Smart-contract): "Audit the VStamp signer for replay-attack
  surface and propose a fix", with a Foundry test demonstrating chain-ID
  replay rejection.

## Build verification

`pnpm --filter @vtorn/marketing build` exits clean. All 12 blog posts
build, including the 4 new ones at:
- `/blog/2026-05-13-calling-3d-devs/`
- `/blog/2026-05-14-calling-designers/`
- `/blog/2026-05-15-calling-translators/`
- `/blog/2026-05-16-calling-smart-contract-devs/`

## Known issues

- Hero images at `/blog/calls/<slug>-hero.svg` do not yet exist; each
  post has a TODO line in the body indicating "(hero image WIP,
  placeholder pending)".
- Some package references updated from `@vtorn/*` to `@tournamental/*`
  to match the recent npm-publish renaming on origin/main (spec,
  social-cards, plugin-sdk).

## Refs

- Doc 19 (open source and contributor revenue): canonical Drips spec.
- Doc 04, 14, 11, 17, 21, 15: discipline-specific source material.
- `apps/marketing/src/content/blog/2026-05-12-pot-of-gold-or-pot-of-shit.mdx`:
  voice reference.
