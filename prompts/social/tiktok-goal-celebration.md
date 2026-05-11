# TikTok — goal celebration

> Surface: TikTok. Event: `event.goal` (auto-clip pipeline).
> Trigger window: t-2s to t+8s; the clip-publisher posts within 60s of the goal.

## Visual

- **Video**: 1080×1920 vertical clip from the auto-clip pipeline (`apps/clip-pipeline`),
  10–15s. Branded outro card (1.5s) appended.
- **Cover image**: `goal-clip` story-format card from `@tournamental/social-cards` rendered with
  `predictedByUser={{user.predicted_this}}`. The card filename is
  `card-goal-{{match.id}}-{{event.id}}.png` and lives at `{{card.story_url}}`.
- **Music**: tournament-specific licensed track from the curated TikTok Commercial
  Music Library bucket (`data/tracks/tiktok/<tournament_id>.json`).
- **On-clip overlay (rendered by clip-pipeline, not edited in)**: corner pill with
  `@{{user.handle}}` if `{{user.predicted_this}} == true`.

## Caption

```
{{event.scorer}} just put {{match.team_winning}} ahead {{match.score_team0}}-{{match.score_team1}} in the {{tournament.name}} 🚨

{{#if user.predicted_this}}
@{{user.handle}} called this {{event.minute}} minutes ago. Predict the next one →
{{else}}
Predict the next goal before it happens →
{{/if}}

{{cta.short_url}}
```

Caption length: keep under 150 chars to clear the in-feed truncation. The CTA
short URL must be the last token (TikTok auto-linkifies the last URL only).

## Hashtags

```
{{tournament.hashtag}} #{{event.scorer_lastname}} #{{match.team_winning}} #fyp #Tournamental #predictions
```

Per-locale add-ons live in `docs/27` § Hashtag strategy.

## Optimal post time

**Real-time** — TikTok's algorithm rewards posts within 15 minutes of an event for
related-search surfacing. The clip-publisher does *not* schedule goal posts; they
go out as fast as encode + upload allow.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=tiktok&utm_campaign=goal-celebration&utm_content={{campaign.id}}`.

## Compliance

- No sportsbook affiliate URLs in the caption (TikTok's gambling policy bans them).
- Match audio: original commentary track only; no music from non-cleared catalogues.
- Auto-disclose AI-generated content is *not* required here — the clip is a real
  rendering of a real event, even though the visualisation is synthetic. Per doc 27
  § AI disclosure, we mark the description with `Visualisation: Tournamental 3D replay`.
