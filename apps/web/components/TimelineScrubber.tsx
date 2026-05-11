"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ManifestController } from "@vtorn/spec-client";
import type { EventMessage } from "@vtorn/spec";

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

interface TimelineScrubberProps {
  controller: ManifestController;
}

/**
 * 2D overlay timeline. Driven by the manifest's wall-clock controller.
 * Renders:
 *   - play/pause toggle
 *   - speed selector (0.5x, 1x, 2x, 5x, 10x)
 *   - range slider with goal markers
 *   - hover tooltip showing time + projected score at that t
 *
 * The overlay sits in `pointer-events: auto` (the global HUD overlay is
 * `pointer-events: none`) so the slider receives input.
 */
export function TimelineScrubber({ controller }: TimelineScrubberProps) {
  const buffer = controller.buffer();
  const [time, setTime] = useState(controller.getTime());
  const [playing, setPlaying] = useState(controller.isPlaying());
  const [rate, setRate] = useState(controller.getRate());
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);

  // Subscribe to controller updates. We re-read every fields and update
  // local state cheaply, the controller fires on each driver tick.
  useEffect(() => {
    return controller.subscribe(() => {
      setTime(controller.getTime());
      setPlaying(controller.isPlaying());
      setRate(controller.getRate());
    });
  }, [controller]);

  const goalEvents = useMemo(
    () =>
      buffer.events.filter(
        (e): e is Extract<EventMessage, { type: "event.goal" }> => e.type === "event.goal",
      ),
    [buffer.events],
  );

  const totalDuration = buffer.durationMs;
  const onSeekRange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      controller.seek(Number(e.target.value));
    },
    [controller],
  );
  const togglePlay = useCallback(() => {
    controller.setPlaying(!controller.isPlaying());
  }, [controller]);

  const onTrackHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const t = ratio * totalDuration;
      setHover({ t, x });
    },
    [totalDuration],
  );

  const onTrackLeave = useCallback(() => setHover(null), []);

  const onChooseRate = useCallback(
    (r: number) => () => {
      controller.setRate(r);
    },
    [controller],
  );

  const projectedScore = useMemo(
    () => projectScoreAt(buffer.events, hover ? hover.t : time),
    [buffer.events, hover, time],
  );

  return (
    <div className="timeline-scrubber" data-testid="timeline-scrubber">
      <div className="ts-controls">
        <button
          type="button"
          className="ts-play"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          data-testid="ts-play"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <span className="ts-time" data-testid="ts-time">
          {formatTime(time)} / {formatTime(totalDuration)}
        </span>

        <div className="ts-rate" role="group" aria-label="Playback speed">
          {SPEED_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={r === rate ? "ts-rate-btn active" : "ts-rate-btn"}
              onClick={onChooseRate(r)}
              data-testid={`ts-rate-${r}`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      <div
        className="ts-track"
        ref={trackRef}
        onMouseMove={onTrackHover}
        onMouseLeave={onTrackLeave}
      >
        <input
          type="range"
          min={0}
          max={totalDuration}
          step={100}
          value={time}
          onChange={onSeekRange}
          aria-label="Match timeline"
          data-testid="ts-range"
          className="ts-range"
        />
        <div className="ts-progress" style={{ width: `${(time / totalDuration) * 100}%` }} />
        {goalEvents.map((g, i) => (
          <span
            key={`${g.t}-${i}`}
            className="ts-goal-marker"
            style={markerStyle(g.t, totalDuration)}
            title={`${formatTime(g.t)}, goal`}
            data-testid="ts-goal-marker"
          />
        ))}
        {hover ? (
          <div
            className="ts-tooltip"
            style={{ left: `${hover.x}px` }}
            data-testid="ts-tooltip"
          >
            <div>{formatTime(hover.t)}</div>
            <div className="ts-tooltip-score">
              {projectedScore.home} – {projectedScore.away}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function markerStyle(t: number, total: number): CSSProperties {
  const ratio = Math.max(0, Math.min(1, t / total));
  return { left: `${ratio * 100}%` };
}

/**
 * Projected score at time `t` by replaying score-change events up to `t`.
 * Falls back to the last `event.score_change` ≤ t. Used for the hover
 * tooltip and the live readout.
 */
export function projectScoreAt(
  events: EventMessage[],
  t: number,
): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === "event.score_change") {
      home = e.home;
      away = e.away;
    }
  }
  return { home, away };
}

/** Format `t_ms` as `HH:MM:SS` (or `MM:SS` if < 1h). */
export function formatTime(t: number): string {
  const total = Math.max(0, Math.floor(t / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${m}:${pad(s)}`;
}

const pad = (n: number): string => n.toString().padStart(2, "0");
