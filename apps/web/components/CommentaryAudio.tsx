"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { AudioMixer } from "@/lib/audio/audio-mixer";

export interface CommentaryAudioProps {
  /** Pulse the crowd-energy reactor on goal events. */
  onGoal?: () => void;
}

/**
 * Phase-3 commentary audio mount.
 *
 * Wires three things:
 *   1. A `Web Audio` `AudioContext` + `GainNode` for the commentary track.
 *   2. An `AudioMixer` (pure logic) that decides the gain curve based
 *      on the Director's `cutAtMs()` / `slowMoRate` writes to
 *      `camera.userData`.
 *   3. A stub commentary buffer (silent), when the ElevenLabs API key
 *      lands, swap the buffer source for the WSS stream from
 *      `lib/audio/elevenlabs-stream.ts`.
 *
 * The mixer ducks commentary by -8 dB during goal-replay slow-mo
 * cuts. The current gain is exposed via `data-commentary-gain` on the
 * `.perf-monitor` HUD element (already mounted by `<PerfMonitor />`)
 * so e2e tests can assert the ducking happens.
 */
export function CommentaryAudio({ onGoal: _onGoal }: CommentaryAudioProps = {}) {
  const { camera } = useThree();
  const mixerRef = useRef<AudioMixer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const lastCamRef = useRef<string>("broadcast");

  useEffect(() => {
    mixerRef.current = new AudioMixer();
    return () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "closed") {
        try {
          ctx.close();
        } catch {
          /* ignore */
        }
      }
      ctxRef.current = null;
      gainRef.current = null;
    };
  }, []);

  // Lazy-init the AudioContext on first user gesture (browsers
  // require it). For tests + headless we just skip mounting the WA
  // graph and operate the mixer "dry".
  useEffect(() => {
    if (typeof window === "undefined") return;
    function tryInit() {
      if (ctxRef.current) return;
      const Ctor =
        (window.AudioContext as typeof AudioContext | undefined) ??
        ((window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
      if (!Ctor) return;
      try {
        const ctx = new Ctor();
        ctxRef.current = ctx;
        const gain = ctx.createGain();
        gain.gain.value = 1;
        gain.connect(ctx.destination);
        gainRef.current = gain;
        // No source attached yet, this would be the WSS stream
        // decoder or the pre-rendered MP3 element. The wiring for
        // ducking is fully exercisable without one.
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("pointerdown", tryInit, { once: true });
    window.addEventListener("keydown", tryInit, { once: true });
    return () => {
      window.removeEventListener("pointerdown", tryInit);
      window.removeEventListener("keydown", tryInit);
    };
  }, []);

  useFrame(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const userData = (camera as { userData?: { directorCam?: string } })
      .userData ?? {};
    const cam = userData.directorCam ?? "broadcast";
    if (cam !== lastCamRef.current) {
      // Director cut to a new cam, react.
      if (cam === "goal-replay") mixer.duckForGoal();
      else if (lastCamRef.current === "goal-replay") mixer.returnToNominal();
      lastCamRef.current = cam;
    }
    const g = mixer.commentaryGain();
    const node = gainRef.current;
    if (node) {
      // Smooth audio-rate ramp via setTargetAtTime on the gain.
      const ctx = ctxRef.current;
      if (ctx) node.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    }
    // Surface the gain on the perf HUD so the e2e suite can read it.
    if (typeof document !== "undefined") {
      const el = document.querySelector(".perf-monitor") as HTMLElement | null;
      if (el) {
        el.setAttribute("data-commentary-gain", g.toFixed(3));
        el.setAttribute("data-mixer-state", mixer.getState());
      }
    }
  });

  return null;
}
