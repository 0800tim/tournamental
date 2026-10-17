# Accessibility audit: hub, archive and shell surfaces from PR #333

> Static audit against WCAG 2.2 AA, 2026-10-17, from source on `main` at e1e0eac9. Scope: `apps/web/app/hub/RegisterInterestForm.tsx`, `app/hub/page.tsx` and its countdown, `app/archive/page.tsx`, `components/archive/ArchiveResultsBracket.tsx`, and the shell changes in `components/shell/AppMenuDrawer.tsx`, `BottomNav.tsx` and `nav-links.tsx`. Fixes are on branch `fix/a11y-hub-archive-shell` with component tests under `apps/web/__tests__/a11y/`. No browser was used; contrast ratios are computed from the stylesheet colours.

## Summary

| Area | Findings | Fixed on the branch | Left open |
| --- | --- | --- | --- |
| Register-interest form | 7 | 7 | 0 |
| Hub countdown | 1 | 1 | 0 |
| Archive home | 2 | 2 | 0 |
| Results bracket | 0 | 0 | 0 |
| Menu drawer | 4 | 4 | 0 |
| Bottom nav | 1 | 1 | 0 |
| Colour contrast | 0 | 0 | 0 |

Nothing found blocks a keyboard or screen-reader user outright; the drawer focus handling and the per-second live region were the two that would have been most noticeable.

## Register-interest form (`app/hub/RegisterInterestForm.tsx`)

1. **Errors were announced but not tied to a field** (WCAG 3.3.1, 1.3.1). The message had `role="alert"` but no input carried `aria-invalid` or pointed at it. Fixed: the API error code maps to a field (`fieldFor()`), that input gets `aria-invalid="true"` and `aria-describedby="ri-error"`; the alert has the id.
2. **Required fields relied on the `required` attribute under `noValidate`** (4.1.2). Fixed: `aria-required="true"` on email and consent so the state is exposed whatever the browser does with native validation.
3. **Country field had only a placeholder ("NZ")** to explain the two-letter format (3.3.2). Fixed: a visually hidden hint linked with `aria-describedby`.
4. **Honeypot** (4.1.2). A `label` with `aria-hidden` wrapping a focusable input is flagged by axe when the input can be focused. The input already had `tabIndex={-1}`, which keeps it out of the tab order; the wrapper is now a `div` with `aria-hidden` around the label so the structure is a plain hidden group. Test asserts it never appears as a labelled control.
5. **Submit state** (4.1.3). The button text changed to "Registering…" but nothing exposed the busy state. Fixed: `aria-busy="true"` while the request is in flight (the button is also disabled).
6. **Thank-you state dropped focus** (2.4.3). The form is replaced by the status panel, so the focused submit button disappears and focus falls to `body`. Fixed: the panel heading is focusable (`tabIndex={-1}`) and receives focus on mount; the panel keeps `role="status"`.
7. **New-tab links and icon-only intent** (3.2.5 advisory, 2.4.4). WhatsApp and Telegram open a new tab without saying so; "Copy" and "More" are short. Fixed: visually hidden "(opens in a new tab)" on both links, `aria-label` on the two buttons, and a polite live region that says "Invite link copied".

## Hub page and countdown (`app/hub/page.tsx`, `components/ui/CountdownBanner.tsx`)

8. **Countdown was an `aria-live="polite"` region updated every second** (4.1.3, and a usability problem: VoiceOver and NVDA announce every change). Fixed: the section is `role="timer"` with an `aria-label` sentence at minute granularity ("349 days, 2 hours and 7 minutes to Opening match"), the ticking grid is `aria-hidden`, and the elapsed state reads the `pastLabel`. The existing reduced-motion branch (one tick per minute) is unchanged.

Checked and fine: `main` landmark, one `h1`, `h2` per section, `ul` groups labelled ("Tournament facts", "How it played"), hero image has descriptive `alt`, link text is specific, no colour-only meaning.

## Archive home (`app/archive/page.tsx`)

9. **Thirty-two "Match" links with the same name** (2.4.4, 2.4.9). A link list or rotor shows "Match, Match, Match". Fixed: each link gets `aria-label` from a pure helper (`lib/archive/labels.ts`), for example "Match details: Round of 16, Morocco won 3-0". The visible text stays "Match".
10. **Flag emoji read aloud before the team name** ("flag: Spain Spain"). Fixed: the emoji span is `aria-hidden` in the knockout list. The podium keeps its emoji because the rank and name are also text.

Checked and fine: landmarks (`main`, `nav aria-label="Explore the archive"`), ordered lists for the podium and standings with labels, the engagement stats list is labelled, `h1` once.

## Results bracket (`components/archive/ArchiveResultsBracket.tsx`)

No findings. The wrapper supplies the page's `h1` and a labelled `nav`; `ReadOnlyBracket` is `aria-labelledby` its `h2`, stage headings are `h3`, flags are `aria-hidden`, scores carry `aria-label`s, and correct and incorrect pick marks have text alternatives.

## Menu drawer (`components/shell/AppMenuDrawer.tsx`)

11. **No focus management** (2.4.3, 2.1.2). Opening the drawer left focus on the burger behind the backdrop; Tab walked the page underneath; closing did not return focus. Fixed: focus moves to the close button on open, Tab and Shift+Tab wrap inside the panel, and focus returns to whatever opened the drawer on close.
12. **`role="dialog"` sat on the backdrop** whose click closes the dialog (4.1.2). Fixed: the role, `aria-modal` and name are on the `aside` panel; the backdrop is plain.
13. **External links did not say they open a new tab** (3.2.5 advisory). Fixed: visually hidden suffix; the decorative arrow stays `aria-hidden`.
14. Escape already closed the drawer; a test now pins it.

Section labels are plain `div`s rather than headings. Acceptable for a short menu; if the drawer grows, `role="group"` with `aria-labelledby` per section would help rotor users.

## Bottom nav (`components/shell/BottomNav.tsx`, `nav-links.tsx`)

15. **Menu button had `aria-haspopup="dialog"` but no `aria-expanded`** (4.1.2). Fixed: `menuOpen` prop from `AppShell`, reflected as `aria-expanded`.

Checked and fine: `nav aria-label="Primary"`, `aria-current="page"` on the active tab, every icon in `components/shell/icons.tsx` is `aria-hidden`, labels are visible text.

## Colour contrast (computed, WCAG 1.4.3)

All text pairs on the hub and archive pass AA; most pass AAA. Canvas `#15151a`, form panel `#1c1c22` at 90 percent over the canvas.

| Text | Ratio | AA |
| --- | --- | --- |
| Body `#e6e6ea` on canvas | 14.6:1 | pass |
| Lede `rgba(231,234,243,0.82)` on canvas | 10.4:1 | pass |
| Stat label `rgba(205,213,231,0.65)` on canvas | 5.8:1 | pass |
| Note text on the form panel | 9.5:1 | pass |
| Eyebrow `#fbbf24` at 11 px on the form panel | 10.3:1 | pass |
| Gold 400 `#dca94b` links on canvas | 8.5:1 | pass |
| Gold 300 italic sub-headline on canvas | 11.0:1 | pass |

Focus rings were not changed; the shell's existing `:focus-visible` styles apply to the new buttons and links. Worth a browser pass on bigmac (axe plus a keyboard walk of hub, archive and drawer) once the branch is built; nothing here needed one to be fixed.

## Tests added (`apps/web/__tests__/a11y/`)

- `RegisterInterestForm.test.tsx`: labels and required state, country hint, honeypot hidden, submit name, email error tied to the field, busy state, thank-you focus and link names.
- `AppMenuDrawer.a11y.test.tsx`: dialog on the panel, focus in and back, Tab wrap, Escape, new-tab names.
- `BottomNav.a11y.test.tsx`: landmark and current page, `aria-expanded`, hidden icons.
- `CountdownBanner.a11y.test.tsx`: timer role, no live region, hidden grid, elapsed label, spoken summary.
- `archive-labels.test.ts`: score text and link names.

The tests carry their own intl wrapper (`__tests__/a11y/intl.tsx`) so they pass on `main` today; once PR #344 merges they can import `render` from `__tests__/helpers/render` instead.
