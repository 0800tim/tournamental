// /blog/rss.xml — RSS 2.0 feed for the build log.
//
// Astro's `@astrojs/rss` integration handles the boilerplate. We stamp
// the canonical site URL from `astro.config.mjs#site`, sort by
// pubDate desc, and exclude drafts — same filter as the index.
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = (await getCollection("blog", ({ data }) => !data.draft))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  return rss({
    title: "VTourn — Build Log",
    description:
      "The VTourn build log: behind-the-scenes engineering and feature show-offs as we ramp toward the 11 June 2026 World Cup kickoff.",
    site: context.site ?? "https://vtourn.com",
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blog/${post.slug}`,
      categories: post.data.tags,
      author: post.data.author,
    })),
    customData: `<language>en-nz</language>`,
    stylesheet: false,
  });
}
