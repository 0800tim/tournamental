/**
 * `plugin.json` schema. Every plugin ships a `plugin.json` alongside
 * its `package.json`; the core's plugin loader reads `plugin.json`
 * first, validates it against `pluginManifestSchema`, then dynamically
 * imports the package and calls its default export.
 *
 * Full schema docs: `docs/28-plugin-architecture.md`, section
 * "Plugin manifest".
 *
 * License field rejects everything except the four allow-listed
 * licences. This is enforced by the loader; the reviewer agent also
 * checks it on every PR that lands a plugin into the monorepo.
 */

import { z } from "zod";

/**
 * The four allow-listed licences. Apache-2.0 is the default for
 * plugins in `packages/plugins/*` (matching core); MIT and the two
 * BSDs are accepted for external plugins. AGPL, GPL-3.0, SSPL, and
 * proprietary plugins are rejected so the ecosystem stays cleanly
 * combinable with the Apache 2.0 core.
 *
 * If you need a different license, fork. The fork's plugins aren't
 * eligible for the upstream Drips treasury (docs/19).
 */
export const ALLOWED_LICENSES = [
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
] as const;

export type ManifestLicense = (typeof ALLOWED_LICENSES)[number];

const capabilityEnum = z.enum([
  "renderer",
  "scorer",
  "ingestSource",
  "identityProvider",
  "commentaryProvider",
  "shareCardRenderer",
  "oddsSource",
  "affiliateRouter",
]);

/**
 * Network permissions are an explicit allow-list of URL prefixes.
 * The sandboxed `fetch` in `PluginContext` rejects any URL that
 * doesn't match. This means "no surprise outbound traffic"; the
 * reviewer agent reads the allow-list before approving a plugin PR.
 */
const networkPermissionSchema = z
  .object({
    /**
     * Allow-list of URL prefixes the plugin's sandboxed fetch can
     * resolve. Examples: `https://api.elevenlabs.io/`,
     * `https://gateway.discord.com/`. No `*` wildcards;
     * substring match is enough.
     */
    allowedOrigins: z.array(z.string().url()).max(20),
  })
  .strict();

export const pluginManifestSchema = z
  .object({
    /**
     * NPM package name. For monorepo plugins, this is also the
     * workspace name. External plugins MUST be under the
     * `@tournamental-plugin/` scope to be auto-discovered.
     */
    name: z.string().min(3).max(120),

    /** SemVer. */
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/i, {
        message: "version must be SemVer",
      }),

    /** One-line human-readable description for the plugin picker UI. */
    description: z.string().min(10).max(280),

    /**
     * Semver-pinned peer dependency on the SDK. The loader refuses
     * to load plugins whose SDK range doesn't satisfy the running
     * core. Typical value: `"^0.1.0"`.
     */
    sdkRange: z
      .string()
      .regex(/^[\^~]?\d+\.\d+\.\d+(?:\s*\|\|\s*[\^~]?\d+\.\d+\.\d+)*$/),

    /** Capabilities this plugin provides. At least one. */
    provides: z.array(capabilityEnum).min(1),

    /**
     * Licence string. MUST be one of `ALLOWED_LICENSES`. The loader
     * rejects everything else with a clear error.
     */
    license: z
      .enum(ALLOWED_LICENSES)
      .describe(
        `One of: ${ALLOWED_LICENSES.join(", ")}. AGPL / proprietary plugins are rejected; fork the core if you need a different license.`
      ),

    /**
     * Reference to the Drips list that receives this plugin's share
     * of the upstream treasury. Required for plugins in
     * `packages/plugins/*` and `@tournamental-plugin/*`. External
     * plugins MAY set this to opt in.
     *
     * Format: `drips:<chain>:<account-id>` per docs/19 and docs/40.
     * Example: `drips:base:0x1234...`.
     */
    dripsListRef: z
      .string()
      .regex(/^drips:[a-z]+:[a-zA-Z0-9_:.-]+$/, {
        message: "expected drips:<chain>:<account-id>",
      })
      .optional(),

    /**
     * Author block. The `wallet` is the recipient address on the
     * Drips Network if `dripsListRef` is set on the parent treasury.
     */
    author: z
      .object({
        name: z.string().min(1).max(120),
        email: z.string().email().optional(),
        url: z.string().url().optional(),
        wallet: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/)
          .optional(),
      })
      .strict()
      .optional(),

    /** Public source repo for the plugin. */
    repository: z.string().url().optional(),

    /**
     * Optional permissions block. Plugins requesting `network`
     * provide an explicit allow-list of origins. Plugins NOT in
     * `packages/plugins/*` MUST declare this block; the loader
     * rejects external plugins with missing permissions.
     */
    permissions: z
      .object({
        network: networkPermissionSchema.optional(),
        /**
         * Marks a plugin as requesting unrestricted DOM access for
         * the renderer extension point. WebGL / WebGPU renderers
         * need this; the loader logs a warning every time a plugin
         * with `dom: "unrestricted"` mounts.
         */
        dom: z.enum(["scoped", "unrestricted"]).optional(),
      })
      .strict()
      .optional(),

    /**
     * Default-export entry point. Relative to the package root.
     * Defaults to `dist/index.js` if omitted (npm-installed) or
     * `index.ts` (local-dir plugin).
     */
    main: z.string().optional(),

    /**
     * Plugins that explicitly target a single core SemVer range
     * MAY pin here; otherwise `sdkRange` is the only gate.
     */
    coreRange: z.string().optional(),

    /**
     * Free-form tags for the plugin marketplace UI.
     */
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Validate a `plugin.json` blob. Returns the parsed manifest on
 * success; throws a `ManifestError` with a readable message on
 * failure. The error message names every failing field.
 */
export function validateManifest(raw: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  throw new ManifestError(
    `plugin.json failed validation: ${issues}. See docs/28-plugin-architecture.md for the schema.`
  );
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}
