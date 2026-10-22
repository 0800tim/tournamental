# Knockout flag-as-background + bigger flags + layout polish

- Date: 2026-05-11
- Branch: `feat/knockout-flag-backgrounds`
- Doc: [docs/46-knockout-flag-backgrounds.md](../docs/46-knockout-flag-backgrounds.md)
- Status: in-progress

## Diagnosis

Tim's screenshot of `2026wc.vtourn.com/world-cup-2026` showed the knockout-stage bracket cells using a **solid kit-colour fill** to indicate the user's pick (Spain → red, Brazil → yellow, Argentina → light blue, Norway → grey-blue) with a tiny ~24x16 flag chip and the team name in white.

The current cell (`KnockoutMatch.tsx` + `bracket.css §km-team`) uses CSS variables `--km-home-accent` / `--km-away-accent` set from `team.kit.primary`, applied as `background: var(--km-home-accent)` on `.is-winner`.

Tim asked for three things:

1. Make the entire cell background the team's flag (not the kit colour).
2. Make the inline flags bigger in general.
3. Improve the page layout for the knockouts tab.

## Plan (5–10 lines)

1. Add a `bgFlagCode` rendering path to `KnockoutMatch.tsx`: when `is-winner`, the cell sets `background-image: url(/flags/<code>.svg)` plus a dark gradient overlay for legibility.
2. Bump the `TeamFlag` default sizes — `sm` from 24x16 to 32x22, add an `xs`, keep `md/lg/xl` proportional. KnockoutMatch switches from `size="sm"` to `size="md"` in idle state.
3. Layout polish: smaller match-number chip, no "vs" word (replace with thin connector line), softer 16px corner radius, drop shadow on selected cells, "View match" becomes an icon button.
4. Add hover-preview state (50% flag-bg) with `prefers-reduced-motion` respect.
5. Verify a11y: aria-pressed, aria-label, contrast against white/yellow flag regions via the gradient overlay.
6. Tests in `apps/web/__tests__/knockout-flag-backgrounds.test.tsx`.
7. Doc 46.

## Decisions

- **Flag-as-bg** uses inline `style.backgroundImage` (CSS-var would prevent cache busting per-team and make the unselected-vs-selected distinction harder to scope). The dark overlay is a pseudo-element (`::after`) on the team button so it sits above the bg image but below the content.
- **Size scale** for `TeamFlag`: `xs (16x12) / sm (32x22) / md (48x32) / lg (72x48) / xl (120x80)`. KnockoutMatch idle uses `md` (was `sm`); MatchPredictionRow keeps `circle/lg` for the existing big-circle pattern.
- **Contrast strategy**: a 0.15→0.65 vertical gradient with a 6% white text-shadow on the team name + a subtle scrim covers the worst case (Brazil yellow). Verified visually against Brazil, France, Germany, Norway.
- **"View match"** kept as a text affordance — Tim's feedback was about the cells, not the link. Made it smaller/quieter so it doesn't compete with the flag visual.

## Open questions

- None for this scope. Layout improvements stayed inside the four cell-level fixes Tim called out.

## Next steps

- Open PR; run web tests + typecheck; manual screenshot at 375px and 1280px.
