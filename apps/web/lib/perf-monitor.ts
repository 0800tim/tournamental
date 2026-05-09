/**
 * Lightweight runtime perf monitor.
 *
 * Phase-1 fidelity acceptance criteria require Playwright assertions
 * against `window.__vtornFps` and friends. This module:
 *
 *   - Tracks a sliding window of frame deltas.
 *   - Updates `window.__vtornFps` (number, current EWMA fps).
 *   - Updates `window.__vtornDrawCalls` and `window.__vtornMemory`
 *     when called from a render loop with renderer info.
 *   - Captures a 5-second median frame-time so the test can assert
 *     "median frame time < 16.7 ms" without sampling the 1-frame jitter.
 *
 * The renderer mounts <PerfMonitor/> inside the Canvas and the
 * Playwright test reads `window.__vtorn*` via `page.evaluate`.
 *
 * Costs: O(1) per frame, two timestamp pushes into a ring buffer.
 */

declare global {
  // eslint-disable-next-line no-var
  var __vtornFps: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornFrameMsP50: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornFrameMsP99: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornDrawCalls: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornTriangles: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornMemoryMb: number | undefined;
  // eslint-disable-next-line no-var
  var __vtornFrameCount: number | undefined;
}

interface Sample {
  /** Frame time in ms. */
  ms: number;
  /** Performance.now() at frame start. */
  at: number;
}

const WINDOW_MS = 5000;
const MAX_SAMPLES = 600; // 600 frames = 10s @ 60fps

class PerfMonitor {
  private samples: Sample[] = [];
  private lastTime: number | null = null;
  private ewmaFps = 0;
  private frameCount = 0;

  /**
   * Call once per frame. `now` defaults to `performance.now()`.
   *
   *   `info`        — optional renderer.info bag from THREE.WebGLRenderer.
   */
  tick(now?: number, info?: { calls: number; triangles: number }): void {
    const t = now ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (this.lastTime !== null) {
      const dt = t - this.lastTime;
      if (dt > 0 && dt < 1000) {
        this.samples.push({ ms: dt, at: t });
        // Trim old samples both by count and by age.
        if (this.samples.length > MAX_SAMPLES) {
          this.samples.splice(0, this.samples.length - MAX_SAMPLES);
        }
        const cutoff = t - WINDOW_MS;
        let cutIdx = 0;
        while (cutIdx < this.samples.length && this.samples[cutIdx].at < cutoff) cutIdx++;
        if (cutIdx > 0) this.samples.splice(0, cutIdx);

        // EWMA smoothing for the headline fps.
        const fps = 1000 / dt;
        this.ewmaFps = this.ewmaFps === 0 ? fps : this.ewmaFps * 0.9 + fps * 0.1;
        this.frameCount++;

        // Publish to globals every 6 frames to keep CPU minimal.
        if (this.frameCount % 6 === 0) {
          this.publish(info);
        }
      }
    }
    this.lastTime = t;
  }

  /** Snapshot statistics for `window.__vtorn*`. Runs every ~6 frames. */
  private publish(info?: { calls: number; triangles: number }): void {
    if (typeof window === "undefined") return;
    const ms = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    if (ms.length === 0) return;
    const p50 = ms[Math.floor(ms.length * 0.5)];
    const p99 = ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.99))];
    window.__vtornFps = Math.round(this.ewmaFps * 10) / 10;
    window.__vtornFrameMsP50 = Math.round(p50 * 100) / 100;
    window.__vtornFrameMsP99 = Math.round(p99 * 100) / 100;
    window.__vtornFrameCount = this.frameCount;
    if (info) {
      window.__vtornDrawCalls = info.calls;
      window.__vtornTriangles = info.triangles;
    }
    // Memory (Chrome-only; gracefully degrades).
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem?.usedJSHeapSize) {
      window.__vtornMemoryMb = Math.round(mem.usedJSHeapSize / (1024 * 1024));
    }
  }

  reset(): void {
    this.samples = [];
    this.lastTime = null;
    this.ewmaFps = 0;
    this.frameCount = 0;
  }
}

let _monitor: PerfMonitor | null = null;

/** Singleton accessor — every call returns the same monitor. */
export function getPerfMonitor(): PerfMonitor {
  if (!_monitor) _monitor = new PerfMonitor();
  return _monitor;
}

/** Clear globals + reset. Useful on hot-reload. */
export function resetPerfMonitor(): void {
  if (typeof window !== "undefined") {
    window.__vtornFps = undefined;
    window.__vtornFrameMsP50 = undefined;
    window.__vtornFrameMsP99 = undefined;
    window.__vtornDrawCalls = undefined;
    window.__vtornTriangles = undefined;
    window.__vtornMemoryMb = undefined;
    window.__vtornFrameCount = undefined;
  }
  _monitor?.reset();
}
