# X thread — tournament recap

> Surface: X. Event: tournament end.
> User-share + brand-channel. The brand-channel thread is the "tournament wrap"
> that anchors the post-event social cycle.

## Visual

- **Media tweet 1**: 1200×630 `tournament-recap` OG card from `@vtorn/social-cards`.
- **Media tweet 2**: top-3 `goal-clip` OG cards as a 4-image grid.
- **Media tweet 3**: `leaderboard-rank` OG card showing the user's final rank.

## Thread

**Tweet 1 (anchor)**:
```
{{tournament.name}} — wrapped.

@{{user.handle}}: {{stats.points_earned}} points • {{stats.accuracy_pct}}% accuracy • #{{stats.rank}} of {{stats.total_entrants}}.

Thread 👇
```

**Tweet 2 (top moments)**:
```
3 moments I won't forget:

🎯 {{highlight_1}}
🎯 {{highlight_2}}
🎯 {{highlight_3}}
```

**Tweet 3 (mechanic plug)**:
```
The thing that surprised me: predicting {{stats.predictions_locked}} matches forces you to *watch* the tournament closely. You catch every storyline.

If you missed this one, the next is already open: {{cta.short_url}}
```

**Tweet 4 (CTA)**:
```
Bracket pre-fill, 3D match replay, leaderboard, badges — free on {{cta.short_url}}.

Built in the open: github.com/0800tim/vtorn.
```

## Hashtags

Tweet 1 only:
```
{{tournament.hashtag}} #recap
```

## Optimal post time

24 hours after the tournament's last match — far enough out that the dust has
settled, close enough that interest hasn't decayed.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=x&utm_campaign=tournament-recap&utm_content={{campaign.id}}`.

## Compliance

- The thread is editorial, not promotional. No affiliate links.
- The github.com plug is part of the brand identity (open-source-first per
  `docs/19`); X doesn't deboost off-platform links inside threads.
