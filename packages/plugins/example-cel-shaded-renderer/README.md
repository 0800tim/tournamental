# @tournamental-plugin/example-cel-shaded-renderer

> **Reference renderer plugin.** Demonstrates the `renderer` extension point in [`docs/28-plugin-architecture.md`](../../../docs/28-plugin-architecture.md). Copy this package as the starting point for your own renderer plugin.

## What it does

Mounts a transparent overlay `<canvas>` on top of the core renderer's canvas, then post-processes the existing pixels through a four-step luminance ramp: the classic cel-shading "stair-step" look. The ramp colour is picked from each team's primary kit based on which half of the pitch the ball is in.

It's deliberately minimal: it does NOT replace the entire scene graph. The point is to show how a plugin author can ship a renderer-side effect WITHOUT rewriting `apps/web/components/MatchScene.tsx`. Once you're comfortable with the boundary, graduate to a full scene-graph replacement.

## The pattern (every renderer plugin follows this)

1. **`plugin.json`** declares `provides: ["renderer"]` and an SDK range.
2. **`src/index.ts`** exports a default `PluginFactory` that returns a `Plugin` object with a `renderer` slot.
3. The `renderer.mount(container, init, opts)` method writes into the DOM container the core gives you and returns a handle with three methods: `pushFrame`, `pushEvent`, `dispose`.
4. The core feeds frames at 10–30 Hz. Your handle decides what to do with them.

## File walkthrough

| File             | Purpose                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `package.json`   | npm-published name `@tournamental-plugin/example-cel-shaded-renderer`, Apache-2.0       |
| `plugin.json`    | Capability declaration the loader reads (see `@tournamental/plugin-sdk/manifest`)        |
| `src/index.ts`   | The `PluginFactory` default export + the `celShadedRenderer` `RendererPlugin` literal   |
| `tsconfig.json`  | Extends the monorepo's base; pulls in DOM lib                                            |

## Try it in dev

```bash
# 1. Install the workspace
pnpm install

# 2. Start the mock producer
cd apps/mock-producer && pnpm start

# 3. Start the web app with the plugin enabled (the local-dir loader picks it up)
cd apps/web && pnpm dev

# 4. Open the dev URL with the renderer flag
open "http://localhost:3300/match/synthetic?renderer=example-cel-shaded-renderer"
```

(The core's plugin loader auto-discovers anything under `@tournamental-plugin/*` in `node_modules` plus anything in a local `plugins/` directory. See [`docs/28-plugin-architecture.md`](../../../docs/28-plugin-architecture.md#discovery-and-loading).)

## Copy this package as a template

```bash
cp -r packages/plugins/example-cel-shaded-renderer packages/plugins/my-renderer
# rename in package.json, plugin.json, src/index.ts
# replace the overlay logic in mount() with your own scene-graph
```

## License

Apache-2.0, same as the core. Eligible for the upstream Drips treasury per [`docs/19-open-source-and-contributor-revenue.md`](../../../docs/19-open-source-and-contributor-revenue.md) once accepted.
