// Astro Content Collections registry.
//
// Three collections live here:
//   - `blog`, the public-facing build log on tournamental.com/blog
//   - `press`, official press releases on tournamental.com/press
//   - `engineering`, the deep-technical engineering log on
//     tournamental.com/engineering, aimed at AI agents and human
//     engineers who want to read the architecture decisions before
//     forking a service or shipping a plugin.
//
// All three are MDX. Blog hero images live under
// `apps/marketing/public/blog/`, press hero images under
// `apps/marketing/public/press/`, engineering hero images under
// `apps/marketing/public/blog/engineering/` (a sub-folder so the
// existing public-asset CDN rules apply without extra config).
// Schemas are strict on purpose, missing fields fail the build (Tim
// hates "shipped without a date" bugs).
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updated: z.coerce.date().optional(),
      // Authors are an enum so we don't accidentally publish under a
      // typo'd byline. Add new authors here as the team grows.
      author: z.enum(["Tournamental Team", "Orchestrator", "Tim"]).default("Tournamental Team"),
      tags: z.array(z.string()).default([]),
      // `image()` runs through Astro's asset pipeline (hashed, optimised);
      // we also accept a plain string for posts whose hero lives in
      // /public/blog/ and is referenced as a static URL.
      heroImage: z.union([image(), z.string()]).optional(),
      heroImageAlt: z.string().optional(),
      // Required if heroImage is present, attribution + licence string.
      // Format: `Photo by <name> on <source> (<licence>)`.
      heroImageCredit: z.string().optional(),
      draft: z.boolean().default(false),
      // When true, this post is pinned to the hero slot on the blog index
      // regardless of pubDate order. Use sparingly, at most one featured
      // post at a time.
      featured: z.boolean().default(false),
    }),
});

// Press releases. Each entry is the canonical text a journalist or
// blogger can lift verbatim. The schema captures everything a press
// page needs (contact, embargo, kit URL, audience targeting, optional
// pull-quotes) so the /press surface can render without bespoke
// per-release templating.
const press = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      pubDate: z.coerce.date(),
      // If set in the future, the /press index renders the release as a
      // redacted "embargoed until <date>" entry and the slug route
      // returns a 404 placeholder. Once `embargoUntil` has passed (or
      // the field is omitted), the release goes live.
      embargoUntil: z.coerce.date().optional(),
      // Press contact, populated on every release. Phone is optional
      // since a lot of inbound from US journalists prefers email.
      contactName: z.string(),
      contactEmail: z.string().email(),
      contactPhone: z.string().optional(),
      // Optional URL to a downloadable .zip of brand assets, headshots,
      // product screenshots. Lives under /press-kit/ in /public.
      pressKitUrl: z.string().optional(),
      category: z.enum(["launch", "milestone", "partnership", "feature", "open-source"]),
      audience: z
        .array(z.enum(["techcrunch", "ai-builder", "sports-media", "general"]))
        .default(["general"]),
      heroImage: z.union([image(), z.string()]).optional(),
      heroImageAlt: z.string().optional(),
      // Pull-quotes journalists can lift directly into copy. Each entry
      // is one attributable quote.
      quoteAttributable: z
        .array(
          z.object({
            quote: z.string(),
            source: z.string(),
          })
        )
        .optional(),
      // Optional override of the default "About Tournamental"
      // boilerplate footer rendered on the release page.
      boilerplate: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// Engineering log. A distinct surface from `blog`: deep technical posts
// about how Tournamental is built, written so an AI agent or a human
// engineer can read it and feed it back into their own build. Tagged
// by `area` rather than freeform tags, so the index can render a clean
// filter bar without growing into a tag-cloud mess. `relatedDocs` and
// `relatedSource` capture canonical doc + source refs in frontmatter
// so the post page can render a sidebar of "related docs" + "related
// source" links without per-post bespoke HTML.
const engineering = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updated: z.coerce.date().optional(),
      author: z.enum(["Tournamental Team", "Tim", "Orchestrator"]).default("Tim"),
      // Engineering posts tag by area, not freeform. Adding a new area
      // is intentional, missing-area must fail the build so the index
      // filter bar stays a curated set.
      area: z.enum([
        "stack-overview",
        "renderer",
        "scoring",
        "identity",
        "on-chain",
        "data-pipeline",
        "ai-agents",
        "infrastructure",
        "plugins",
        "performance",
      ]),
      tags: z.array(z.string()).default([]),
      heroImage: z.union([image(), z.string()]).optional(),
      heroImageAlt: z.string().optional(),
      heroImageCredit: z.string().optional(),
      draft: z.boolean().default(false),
      // Engineering posts deep-link into the repo. Capture canonical
      // doc + source refs in frontmatter so the post page can render
      // a "Related" sidebar without per-post markup. `relatedDocs`
      // entries are filenames inside `docs/` (e.g. `03-architecture.md`).
      // `relatedSource` entries are repo-root-relative paths (e.g.
      // `apps/web/components/molecule/Molecule.tsx`).
      relatedDocs: z.array(z.string()).default([]),
      relatedSource: z.array(z.string()).default([]),
    }),
});

export const collections = { blog, press, engineering };
