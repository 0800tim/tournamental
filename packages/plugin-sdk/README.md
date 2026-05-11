# @tournamental/plugin-sdk

> Types, manifest schema, and test harness for authoring Tournamental plugins.

This package is the contract surface between the Tournamental core and third-party plugin authors. Eight extension points live here: `renderer`, `scorer`, `ingestSource`, `identityProvider`, `commentaryProvider`, `shareCardRenderer`, `oddsSource`, and `affiliateRouter`. Full architecture in [`docs/28-plugin-architecture.md`](../../docs/28-plugin-architecture.md).

## 10-minute quickstart

### 1. Install

```bash
pnpm add @tournamental/plugin-sdk
```

The SDK has one runtime dependency (`zod` for manifest validation) plus a peer dependency on `@tournamental/spec` for the message types. Both are workspace deps in the monorepo and regular npm deps in external plugins.

### 2. Scaffold a plugin

A plugin is a regular npm package with three files: `package.json`, `plugin.json`, and `src/index.ts`. The minimum viable manifest:

```json
{
  "name": "@tournamental-plugin/my-renderer",
  "version": "0.1.0",
  "description": "A friendly description of what this plugin does.",
  "sdkRange": "^0.1.0",
  "provides": ["renderer"],
  "license": "Apache-2.0"
}
```

The minimum viable factory:

```ts
import type { Plugin, PluginFactory } from "@tournamental/plugin-sdk";

const factory: PluginFactory = (ctx) => {
  ctx.log.info("my-renderer booting", { coreVersion: ctx.coreVersion });
  const plugin: Plugin = {
    name: "@tournamental-plugin/my-renderer",
    version: "0.1.0",
    provides: ["renderer"],
    renderer: {
      label: "My Renderer",
      mount(container, init, opts) {
        // ... build your scene graph here ...
        return {
          pushFrame() {},
          pushEvent() {},
          dispose() {},
        };
      },
    },
  };
  return plugin;
};

export default factory;
```

### 3. Validate the manifest

```ts
import { validateManifest } from "@tournamental/plugin-sdk/manifest";

validateManifest(JSON.parse(fs.readFileSync("plugin.json", "utf8")));
```

The schema is strict: unknown fields throw, version must be SemVer, license must be one of Apache-2.0 / MIT / BSD-2-Clause / BSD-3-Clause.

### 4. Test against the standard fixture set

```ts
import {
  runScorerAgainstFixture,
  makeFixtureMatchInit,
  makeFixtureStateFrame,
} from "@tournamental/plugin-sdk/test-harness";

// Scorer plugin
const breakdown = runScorerAgainstFixture(myPlugin, fixtureBracket, fixtureResults);
expect(breakdown.total).toBe(123);

// Renderer plugin (browser context: Vitest browser mode or Playwright)
const pngBytes = await renderFrameToPng(myPlugin.renderer!, makeFixtureMatchInit(), makeFixtureStateFrame());
```

### 5. Drop the plugin into the dev app

For local-dir plugins, drop the package into `plugins/` at the repo root. The core's loader picks it up at boot. For npm-installed plugins, publish to npm under the `@tournamental-plugin/` scope; the loader auto-discovers anything matching that pattern in the running app's `node_modules`.

### 6. Try it against the dev producer

```bash
# Terminal 1
cd apps/mock-producer && pnpm start

# Terminal 2
cd apps/web && pnpm dev
# Open http://localhost:3300/match/synthetic?renderer=my-renderer
```

The `?renderer=` URL flag lets you A/B between the default renderer and yours without restarting. See [`docs/28-plugin-architecture.md`](../../docs/28-plugin-architecture.md#discovery-and-loading) for the full discovery flow.

## What's in the box

| File                        | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `src/index.ts`              | Eight `*Plugin` interfaces + `Plugin` / `PluginFactory` / `PluginContext` |
| `src/manifest.ts`           | Zod schema for `plugin.json`, plus `validateManifest()`                   |
| `src/test-harness.ts`       | `runScorerAgainstFixture()`, `renderFrameToPng()`, fixture builders        |
| `test/manifest.test.ts`     | Manifest schema unit tests (license rejection, strict mode)               |
| `test/test-harness.test.ts` | Harness unit tests (scorer dispatch, renderer fallback)                   |

## License

Apache-2.0. Same as the Tournamental core. See [`LICENSE`](../../LICENSE) and [`docs/19-open-source-and-contributor-revenue.md`](../../docs/19-open-source-and-contributor-revenue.md).

## Contributing

Plugin SDK changes affect every plugin author downstream. SemVer is enforced. Major bumps mean breaking core API; the contributor flow for an SDK major bump is in [`docs/28-plugin-architecture.md`](../../docs/28-plugin-architecture.md#versioning).
