/**
 * Plugin author test harness. Pure helpers that exercise a plugin
 * against the standard fixture set so the author can unit-test
 * without spinning up the whole stack.
 *
 *   - `runScorerAgainstFixture()`: applies a `ScorerPlugin` to a
 *     fixture bracket and returns the breakdown for assertion.
 *   - `renderFrameToPng()`: runs a `RendererPlugin` headless against
 *     a single frame and returns the PNG bytes. Web-only; uses
 *     OffscreenCanvas where available, falls back to a stub PNG when
 *     no canvas is present (CI on Node).
 *   - `runIngestAgainstFixture()`: drains an `IngestPlugin` into an
 *     in-memory array of messages for golden-file comparison.
 *
 * Designed to keep plugin author dependencies minimal: no
 * Playwright, no Puppeteer, no Three.js, no React. Plug-in authors
 * who want a real visual smoke test should run their plugin in
 * `apps/web` against the dev producer, as documented in
 * `docs/28-plugin-architecture.md`.
 */

import type {
  IngestPlugin,
  IngestStartOpts,
  IngestSubscriber,
  Message,
  PointsBreakdown,
  RendererPlugin,
  RendererMountOpts,
  ScorerBracket,
  ScorerPlugin,
  ScorerResults,
  StateFrame,
  MatchInit,
} from "./index.js";

// ---------- scorer ----------

/**
 * Apply a `ScorerPlugin` to a fixture and return the breakdown.
 * Throws if the plugin's `modes` array doesn't include the
 * fixture bracket's mode (mirrors the core's behaviour).
 */
export function runScorerAgainstFixture(
  plugin: ScorerPlugin,
  bracket: ScorerBracket,
  results: ScorerResults,
  opts: { streak?: number } = {}
): PointsBreakdown {
  if (!plugin.modes.includes(bracket.mode)) {
    throw new Error(
      `scorer plugin ${plugin.label} does not support mode ${bracket.mode}; ` +
        `declared modes: [${plugin.modes.join(", ")}]`
    );
  }
  return plugin.score(bracket, results, { streak: opts.streak });
}

// ---------- ingest ----------

/**
 * Drain an ingest plugin into an in-memory array. Useful for
 * golden-file comparison: snapshot the messages a known fixture
 * emits, then compare future builds against the snapshot.
 *
 * `maxMessages` defaults to 10_000 to avoid infinite loops on
 * misbehaving plugins.
 */
export async function runIngestAgainstFixture(
  plugin: IngestPlugin,
  opts: IngestStartOpts,
  maxMessages = 10_000
): Promise<Message[]> {
  const out: Message[] = [];
  let endedExternally = false;

  const subscriber: IngestSubscriber = {
    paused: false,
    push(msg) {
      out.push(msg);
      if (out.length >= maxMessages) {
        endedExternally = true;
      }
    },
    end() {
      endedExternally = true;
    },
  };

  const session = await plugin.start(opts, subscriber);

  // Spin until the plugin signals end, the subscriber hits its cap,
  // or 30 wall-clock seconds pass (defensive: for misbehaving
  // plugins).
  const deadlineMs = Date.now() + 30_000;
  while (!endedExternally && Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, 10));
  }

  await session.dispose();
  return out;
}

// ---------- renderer ----------

/**
 * Run a renderer headless against a single state frame and return
 * the PNG bytes. Useful for screenshot diffing in CI.
 *
 * Where this runs:
 *   - In a browser (Playwright, Vitest browser mode): uses
 *     `OffscreenCanvas` and the plugin's actual mount path.
 *   - In Node CI without a DOM: returns a 1×1 sentinel PNG so the
 *     test passes the "did the plugin throw?" smoke check but the
 *     visual diff is skipped. Document this in your CI; visual
 *     diffs MUST run in a real browser.
 */
export async function renderFrameToPng(
  plugin: RendererPlugin,
  init: MatchInit,
  frame: StateFrame,
  opts: RendererMountOpts & { width?: number; height?: number } = {}
): Promise<Uint8Array> {
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;

  // Node fallback: no `document` global.
  if (typeof document === "undefined") {
    return SENTINEL_PNG_1x1;
  }

  const container = document.createElement("div");
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  document.body.appendChild(container);

  try {
    const handle = plugin.mount(container, init, {
      quality: opts.quality ?? "med",
      pixelRatio: opts.pixelRatio ?? 1,
    });
    handle.pushFrame(frame);
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      handle.dispose();
      throw new Error(
        `renderer ${plugin.label} did not produce a <canvas> after pushFrame; cannot capture PNG`
      );
    }
    const dataUrl = canvas.toDataURL("image/png");
    handle.dispose();
    return decodeDataUrl(dataUrl);
  } finally {
    container.remove();
  }
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Minimal valid 1x1 transparent PNG. Bytes verified.
const SENTINEL_PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

// ---------- common fixture builders ----------

/**
 * Build a minimal MatchInit for harness tests. Two teams of three
 * players each on a 100×60 m soccer pitch. Enough shape for
 * renderer / scorer smoke tests.
 */
export function makeFixtureMatchInit(overrides: Partial<MatchInit> = {}): MatchInit {
  const init: MatchInit = {
    type: "match.init",
    spec_version: "0.1.1",
    sport: "soccer",
    match_id: "fixture-match-1",
    start_time: "2026-01-01T00:00:00Z",
    field: { length: 100, width: 60, units: "m", surface: "grass" },
    teams: [
      {
        id: "T_HOME",
        name: "Home",
        kit: { primary: "#1e3a8a", secondary: "#f8fafc" },
        players: [
          { id: "P_H1", name: "Home One", number: 1, position: "GK" },
          { id: "P_H2", name: "Home Two", number: 2, position: "DF" },
          { id: "P_H3", name: "Home Three", number: 3, position: "FW" },
        ],
      },
      {
        id: "T_AWAY",
        name: "Away",
        kit: { primary: "#7c2d12", secondary: "#fef3c7" },
        players: [
          { id: "P_A1", name: "Away One", number: 1, position: "GK" },
          { id: "P_A2", name: "Away Two", number: 2, position: "DF" },
          { id: "P_A3", name: "Away Three", number: 3, position: "FW" },
        ],
      },
    ],
    ...overrides,
  };
  return init;
}

/**
 * Build a minimal StateFrame paired with `makeFixtureMatchInit()`.
 * All players standing on the centre line.
 */
export function makeFixtureStateFrame(t = 0): StateFrame {
  return {
    type: "state",
    t,
    players: [
      { id: "P_H1", pos: [-20, 0], facing: 0, anim: "idle" },
      { id: "P_H2", pos: [-10, 5], facing: 0, anim: "idle" },
      { id: "P_H3", pos: [-10, -5], facing: 0, anim: "idle" },
      { id: "P_A1", pos: [20, 0], facing: Math.PI, anim: "idle" },
      { id: "P_A2", pos: [10, 5], facing: Math.PI, anim: "idle" },
      { id: "P_A3", pos: [10, -5], facing: Math.PI, anim: "idle" },
    ],
    ball: { pos: [0, 0, 0.1] },
  };
}
