---
id: 0040
title: Smooth motion + natural animation polish
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P1
labels: [demo-quality, frontend, three-js]
links:
  doc: docs/04-renderer.md
  related: tasks/in-progress/0017_or_renderer-fidelity-PR.md
---

## What

Eliminate the "teleporting cube" feeling on the AR-FR demo. Players should:
- Run between positions, not snap.
- Show idle motion (head sway, weight shift) when stationary.
- Look around naturally (head turns toward the ball or last-event focus).
- Have a real running cycle (limbs cycling, knees lifting) rather than a translating capsule.
- Cast subtle ground shadows that move with them.

Camera: smooth pan to follow ball during builds; rapid cut to a hero angle on goals; broadcast wide angle as the default.

## Why

Tim's review on 2026-05-09: "very chunky and jerky… we need to animate the before and after point and have them run along there." The current chunky look is mostly from cube stubs + sparse statsbomb-replay freeze-frames + linear interpolation. Replacing cubes with the avatar GLB and tuning the animation FSM solves most of it.

## Acceptance

- [ ] Run animation cycles play during translations > 1.5 m/s.
- [ ] Idle motion plays during stillness (no T-pose freeze).
- [ ] Head/body lookAt() target lerps to the ball position (or the last-event focus) within 250ms.
- [ ] Goal-event camera cut: broadcast → hero angle for 4s → broadcast.
- [ ] No visible teleports during normal play (ball or players moving > 5m in < 200ms = a teleport).
- [ ] Cubic-spline motion path between sparse statsbomb-replay anchors when the renderer detects sparse-anchor mode (interpolation distance > 2m without a state frame in 500ms).

## Notes

- Builder agent for renderer fidelity (`feat/timeline-scrubber-and-fidelity`) is already wiring the body GLB + face billboards + better lighting. This task captures the *next* polish layer once that PR lands.
- The avatar package ships idle/run/kick animations as v0.1; the other 12 stubs (walk/sprint/pass/header/shoot/tackle/fall/celebrate/throw/catch/dribble/jump) are deferred per `IDEAS.md`. Add real Mixamo retargets here.
