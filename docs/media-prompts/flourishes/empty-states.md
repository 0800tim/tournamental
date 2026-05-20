# Flourish — empty states

**Where**: pre-kickoff (anywhere the data is still mock or "waiting on
real picks"). Currently the empty-state copy on the leaderboard reads
"Leaderboard activates at kickoff, first match Mexico vs the world,
11 Jun 2026." Without an image, that's bare. A small abstract motif
above the copy makes the wait feel intentional.

## Prompt — bracket empty state

```
A close-up editorial photograph: a single blank A4 page with a faint embossed bracket grid outline (no pen marks yet), sitting on dark wood under warm gold lamp light. The page is mostly empty; a single ballpoint pen rests in the upper-right corner. Slight film grain, shallow depth of field. Charcoal wood, warm gold light, off-white paper. Editorial documentary aesthetic, restraint. --ar 4:5 --style raw --stylize 150 --v 6.1
```

## Prompt — leaderboard empty state

```
A close-up editorial photograph: a single black scoreboard panel, completely blank — no numbers, no labels, no team names. A single faint warm gold floodlight catches the top edge of the panel. The rest of the frame is empty charcoal sky and out-of-focus stadium ironwork. Slight film grain, atmospheric haze. The Athletic story-opener aesthetic. --ar 4:5 --style raw --stylize 150 --v 6.1
```

## Prompt — countdown / coming soon

```
A close-up editorial photograph: a single analog clock face viewed from a steep angle, the hands removed entirely — only the marker dots remain, each picked out in faint gold. The clock is mounted on a dark concrete wall, slight wear, single warm gold lamp from upper right. Atmospheric, anticipatory, restrained. Slight film grain, shallow depth of field. --ar 4:5 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/web/public/media/empty-{bracket,leaderboard,countdown}.jpg`.
- Use the bracket empty as the background of any "build your bracket"
  call-to-action card pre-engagement.
- Use the leaderboard empty above the existing "Leaderboard activates
  at kickoff" copy on /leaderboard.
- Use the countdown for the CountdownBanner component on the play
  homepage.
- All three should render with a 30-40% charcoal underlay so the
  editorial copy on top stays readable.

## DO NOT generate

- "Coming soon" UI mockups with countdown timers.
- Stadium silhouettes that look like a specific city.
- Anyone holding a phone.
- Bright colour anywhere except the gold accent.
