// Astro Content Collections registry.
//
// We keep one collection, `blog`, for the public-facing build log on
// tournamental.com/blog. Posts are MDX, hero images live under
// `apps/marketing/public/blog/` so they go through the public asset
// pipeline (immutable hashing handled by Astro for assets imported via
// `image()`; raw `/blog/*.jpg` references stay long-cache via
// docs/22-deployment-and-tunnels.md).
//
// Frontmatter contract is intentionally narrow. If a field is missing
// the build fails, Tim hates "the post shipped without a date" bugs.
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
    }),
});

export const collections = { blog };
