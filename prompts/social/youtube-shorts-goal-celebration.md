# YouTube Shorts — goal celebration

> Surface: YouTube Shorts. Event: `event.goal`.
> Posted via the YouTube Data API v3 `videos.insert`.

## Visual

- **Video**: 1080×1920 vertical from the auto-clip pipeline. The Shorts surface
  auto-detects vertical < 60s; we add `#Shorts` in the description for safety.
- **End-screen**: 5-second end-screen with the brand outro card and a subscribe
  prompt overlay (rendered into the clip, not the YouTube end-screen UI which
  Shorts don't support).

## Title (≤ 100 chars)

```
{{event.scorer}} goal • {{match.team0_code}} {{match.score_team0}}-{{match.score_team1}} {{match.team1_code}} • {{tournament.name}}
```

## Description

```
{{event.scorer}} puts {{match.team_winning}} ahead {{match.score_team0}}-{{match.score_team1}} in the {{tournament.name}}, minute {{event.minute}}.

Visualisation: VTourn 3D replay. Predict every match: {{cta.url}}

#Shorts {{tournament.hashtag}} #{{event.scorer_lastname}} #{{match.team_winning}} #goal
```

## Tags

```
{{tournament.hashtag}}, {{event.scorer}}, {{match.team0_code}}, {{match.team1_code}}, vtourn, predictions, soccer, football
```

## Optimal post time

Within 10 minutes of clip availability. The YouTube algorithm rewards velocity
in the first 60 minutes; Shorts in particular benefit from same-event-window
posting.

## CTA

`{{cta.url}}` — `https://vtourn.com/r/{{user.id}}?utm_source=youtube&utm_campaign=goal-celebration&utm_content={{campaign.id}}`.
The full URL goes in the description; Shorts don't carry tap-through cards.

## Compliance

- YouTube's content policy requires the AI / synthetic-content disclosure. We use
  the `videos.insert` `videoSelfDeclaredMadeForKids: false` plus the in-description
  `Visualisation: VTourn 3D replay` line. AI-disclosure is *not* required for
  visualisations of real events; we ship it anyway for transparency.
