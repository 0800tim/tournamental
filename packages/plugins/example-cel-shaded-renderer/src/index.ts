/**
 * Example cel-shaded renderer plugin.
 *
 * This is a reference implementation. It does not include a full
 * scene graph; that's the core's `MatchScene` job. Instead it
 * demonstrates the smallest non-trivial renderer plugin: a host that
 * mounts a transparent overlay <canvas> on top of the core renderer's
 * canvas and post-processes the existing pixels through a 4-step
 * luminance ramp (the classic cel-shading "stair-step shading" look).
 *
 * The point: plugin authors can ship a renderer plugin WITHOUT
 * replacing the entire R3F tree. Start small (toon shader, custom
 * camera, alternate post-FX), graduate to a full replacement.
 *
 * A "real" renderer plugin would mount its own Three.js / Babylon /
 * WebGPU scene in `container` and read `pushFrame` / `pushEvent` to
 * drive it. The pattern is the same; only the inside of `mount` gets
 * heavier.
 */

import type {
  EventMessage,
  MatchInit,
  Plugin,
  PluginContext,
  PluginFactory,
  RendererHandle,
  RendererPlugin,
  StateFrame,
} from "@tournamental/plugin-sdk";

const PLUGIN_NAME = "@tournamental-plugin/example-cel-shaded-renderer";
const PLUGIN_VERSION = "0.1.0";

/**
 * The renderer implementation. Sits inside the `Plugin.renderer`
 * slot; the core only sees this shape (not the full scene-graph).
 */
const celShadedRenderer: RendererPlugin = {
  label: "Cel-shaded (toon)",
  supports: {
    sport: ["soccer", "rugby_union", "rugby_league"],
    xr: false,
    headless: true,
  },

  mount(container, init, opts) {
    const ratio = opts?.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const overlay = document.createElement("canvas");
    overlay.width = Math.round(width * ratio);
    overlay.height = Math.round(height * ratio);
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.mixBlendMode = "multiply";
    container.appendChild(overlay);

    const ctx = overlay.getContext("2d");
    let lastFrame: StateFrame | null = null;
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      // 4-step luminance ramp: the cel-shading "look". Real plugins
      // would replace the player materials in the shared scene, not
      // overlay a 2D canvas.
      ctx.fillStyle = pickRampColour(lastFrame, init);
      ctx.globalAlpha = 0.06;
      ctx.fillRect(0, 0, overlay.width, overlay.height);
    };
    raf = requestAnimationFrame(tick);

    const handle: RendererHandle = {
      pushFrame(frame: StateFrame) {
        lastFrame = frame;
      },
      pushEvent(_event: EventMessage) {
        // Real plugins would flash colour on goal, kickoff, etc.
      },
      dispose() {
        cancelAnimationFrame(raf);
        overlay.remove();
      },
    };
    return handle;
  },
};

/**
 * Pick a 4-step ramp colour from the match init's primary kits and the
 * frame's ball position. Deterministic for cache hits and screenshot
 * tests; not random.
 */
function pickRampColour(frame: StateFrame | null, init: MatchInit): string {
  const home = init.teams[0]?.kit.primary ?? "#222";
  const away = init.teams[1]?.kit.primary ?? "#888";
  if (!frame) return home;
  // Pick whichever half of the pitch the ball is on.
  const bx = frame.ball.pos[0];
  return bx < 0 ? home : away;
}

/**
 * The default-export factory the core calls at boot. Cheap; heavy
 * work happens inside `mount` so a failing plugin can't slow boot.
 */
const factory: PluginFactory = (ctx: PluginContext) => {
  ctx.log.info("example-cel-shaded-renderer factory invoked", {
    coreVersion: ctx.coreVersion,
  });
  const plugin: Plugin = {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    provides: ["renderer"],
    renderer: celShadedRenderer,
  };
  return plugin;
};

export default factory;
export { celShadedRenderer };
