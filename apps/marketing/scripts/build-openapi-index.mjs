#!/usr/bin/env node
/**
 * build-openapi-index.mjs, aggregator for the Tournamental API docs portal.
 *
 * For every entry in `apps/marketing/src/lib/api-services.ts`:
 *
 * 1. Try to fetch `${url}/docs/json`, then `${url}/openapi.json`. Live
 *    services are preferred because they reflect "what's actually
 *    running"; this matters during a rolling deploy where a snapshot
 *    might lag the live spec by a commit.
 * 2. If the live URL is offline (DNS, connection refused, 4xx/5xx,
 *    timeout), fall back to the committed snapshot at
 *    `docs/api/<snapshotName>.openapi.json`.
 * 3. If both fail, log a warning and skip, the marketing build never
 *    breaks because of a missing or offline service. This is a hard
 *    requirement: the portal must build offline.
 *
 * Output: a single bundle JSON at
 * `apps/marketing/public/api/openapi-bundle.json`, plus per-service slice
 * JSONs at `apps/marketing/public/api/<slug>.openapi.json` for the
 * deep-link pages.
 *
 * The bundle uses the standard OpenAPI 3.0 `tags` array to group paths
 * per service; every path is prefixed with the service slug (e.g.
 * `/_/game/v1/bracket/me`) so paths from different services don't
 * collide when Scalar merges them. The per-service slice keeps the
 * original paths intact for an authentic single-service view.
 *
 * Apache-2.0, see ../../../LICENSE.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const marketingRoot = resolve(here, "..");
const repoRoot = resolve(marketingRoot, "../..");
const snapshotsDir = resolve(repoRoot, "docs/api");
const outDir = resolve(marketingRoot, "public/api");

const FETCH_TIMEOUT_MS = Number(process.env.OPENAPI_FETCH_TIMEOUT_MS ?? 4_000);
const SKIP_LIVE_FETCH = process.env.OPENAPI_SKIP_LIVE === "1";

/**
 * Inline-load the service manifest. We can't `import` the .ts module
 * from a plain .mjs script, so we parse the exported array out of the
 * source. This is brittle by design, if the manifest grows past a
 * simple data table the aggregator should be rewritten in TS via tsx.
 */
async function loadServices() {
  const src = await readFile(
    resolve(marketingRoot, "src/lib/api-services.ts"),
    "utf8",
  );
  // Match the literal-array body of API_SERVICES so we can JSON-parse
  // it after stripping TS-only syntax. Trailing commas + comments are
  // both stripped to keep JSON.parse happy.
  const m = src.match(/export const API_SERVICES:[^=]*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("Could not locate API_SERVICES in api-services.ts");
  const raw = m[1]
    // strip /* */ block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // strip // line comments
    .replace(/^\s*\/\/.*$/gm, "")
    // quote bare object keys
    .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
    // single quotes -> double quotes
    .replace(/'([^']*)'/g, '"$1"')
    // trailing commas before ] or }
    .replace(/,(\s*[\]}])/g, "$1");
  return JSON.parse(raw);
}

/**
 * Tournamental dev-tunnel + prod resolution mirroring `resolveServiceUrl`
 * in api-services.ts. Kept in sync by review: if you change one, change
 * both. The aggregator runs at marketing-build time so it cannot import
 * the TS helper directly.
 */
function resolveUrl(s) {
  const envKey = `${s.slug.replace(/-/g, "_").toUpperCase()}_API_URL`;
  const override = process.env[envKey];
  if (override && override.length > 0) return override.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? s.url.prod : s.url.dev;
}

async function fetchWithTimeout(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function tryLive(s) {
  if (SKIP_LIVE_FETCH) return null;
  const base = resolveUrl(s);
  return (
    (await fetchWithTimeout(`${base}/docs/json`)) ??
    (await fetchWithTimeout(`${base}/openapi.json`))
  );
}

async function trySnapshot(s) {
  const p = resolve(snapshotsDir, `${s.snapshotName}.openapi.json`);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[openapi] snapshot for ${s.slug} is invalid JSON: ${err}`);
    return null;
  }
}

/**
 * Rewrite every path in a service's spec to live under a unique prefix
 * `/_/<slug>` and stamp every operation with the service slug as a tag.
 * Returns the modified spec (defensive copy) without touching the caller.
 *
 * The `/_/<slug>` prefix is for the merged bundle only. The per-service
 * slice keeps the original paths so an integrator can copy-paste a
 * curl command straight from the doc.
 */
function namespaceSpec(spec, slug) {
  const out = structuredClone(spec);
  const paths = out.paths ?? {};
  const renamed = {};
  for (const [p, methods] of Object.entries(paths)) {
    const prefixed = `/_/${slug}${p.startsWith("/") ? p : `/${p}`}`;
    const m = structuredClone(methods);
    for (const k of Object.keys(m)) {
      const op = m[k];
      if (op && typeof op === "object") {
        const existing = Array.isArray(op.tags) ? op.tags : [];
        op.tags = existing.includes(slug) ? existing : [slug, ...existing];
      }
    }
    renamed[prefixed] = m;
  }
  out.paths = renamed;
  return out;
}

function mergeBundle(specs) {
  const tags = [];
  const paths = {};
  const components = { schemas: {} };
  for (const { service, spec } of specs) {
    tags.push({
      name: service.slug,
      description: `${service.name}, ${service.description}`,
      "x-display-name": service.name,
      "x-source": service.source,
      "x-package": service.pkg,
      "x-auth": service.auth,
    });
    for (const [k, v] of Object.entries(spec.paths ?? {})) paths[k] = v;
    // Namespace component schemas so collisions across services don't
    // overwrite each other silently.
    for (const [name, schema] of Object.entries(
      spec.components?.schemas ?? {},
    )) {
      components.schemas[`${service.slug}_${name}`] = schema;
    }
  }
  return {
    openapi: "3.0.0",
    info: {
      title: "Tournamental Public API",
      description:
        "Aggregated public API surface for tournamental.com. Each tag below is a separate Fastify service in the [tournamental monorepo](https://github.com/0800tim/tournamental). Per-service deep links live at `/api/<service-slug>`. Built from live `/docs/json` endpoints when reachable, else from the committed snapshots in `docs/api/`.",
      version: "0.1.0",
      license: {
        name: "Apache-2.0",
        url: "https://www.apache.org/licenses/LICENSE-2.0",
      },
      contact: {
        name: "Tournamental Holdings",
        url: "https://tournamental.com",
      },
    },
    servers: [
      { url: "https://tournamental.com", description: "Tournamental (prod)" },
    ],
    tags,
    paths,
    components,
    "x-built-at": new Date().toISOString(),
  };
}

async function main() {
  const services = await loadServices();
  await mkdir(outDir, { recursive: true });

  const included = [];
  const skipped = [];

  for (const s of services) {
    /** @type {{source: "live" | "snapshot"; spec: any} | null} */
    let resolved = null;
    const live = await tryLive(s);
    if (live) resolved = { source: "live", spec: live };
    else {
      const snap = await trySnapshot(s);
      if (snap) resolved = { source: "snapshot", spec: snap };
    }
    if (!resolved) {
      console.warn(
        `[openapi] skipping ${s.slug}, live URL unreachable and no snapshot at docs/api/${s.snapshotName}.openapi.json`,
      );
      skipped.push({ slug: s.slug, reason: "no-spec" });
      continue;
    }
    included.push({ service: s, source: resolved.source, spec: resolved.spec });
    // Per-service slice keeps the original paths intact.
    await writeFile(
      resolve(outDir, `${s.slug}.openapi.json`),
      JSON.stringify(resolved.spec, null, 2) + "\n",
      "utf8",
    );
    console.log(
      `[openapi] included ${s.slug} (${resolved.source}, ${Object.keys(
        resolved.spec.paths ?? {},
      ).length} paths)`,
    );
  }

  const bundle = mergeBundle(
    included.map((x) => ({
      service: x.service,
      spec: namespaceSpec(x.spec, x.service.slug),
    })),
  );

  // Stamp source provenance per tag so the portal can show a small
  // "live | snapshot" badge per service.
  for (const tag of bundle.tags) {
    const inc = included.find((x) => x.service.slug === tag.name);
    tag["x-source-mode"] = inc?.source ?? "snapshot";
  }

  await writeFile(
    resolve(outDir, "openapi-bundle.json"),
    JSON.stringify(bundle, null, 2) + "\n",
    "utf8",
  );

  // Manifest of what made it into the bundle so the portal index page
  // can render without a second pass through the source files.
  await writeFile(
    resolve(outDir, "manifest.json"),
    JSON.stringify(
      {
        builtAt: bundle["x-built-at"],
        services: included.map((x) => ({
          slug: x.service.slug,
          name: x.service.name,
          description: x.service.description,
          source: x.service.source,
          pkg: x.service.pkg,
          auth: x.service.auth,
          mode: x.source,
          paths: Object.keys(x.spec.paths ?? {}).length,
        })),
        skipped,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    `[openapi] wrote bundle (${included.length} services, ${skipped.length} skipped)`,
  );
}

main().catch((err) => {
  console.error("[openapi] aggregator failed:", err);
  process.exit(1);
});
