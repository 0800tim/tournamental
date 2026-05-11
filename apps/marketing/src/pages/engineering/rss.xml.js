// /engineering/rss.xml, RSS 2.0 feed for the engineering log.
//
// The brief specified a .js extension (not .ts) for this file. Astro
// happily serves either; we go with .js so the file is callable from
// curl without a separate compile step and matches the spec the brief
// asked for.
//
// Each entry's <category> uses the post's `area` so a reader's feed
// reader can colour-code by area if it wants to. We don't expose the
// freeform tags through RSS because the engineering log filters on
// area, not on tags; tags stay a per-post in-page concern.
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

const AREA_LABELS = {
  "stack-overview": "Stack overview",
  renderer: "Renderer",
  scoring: "Scoring",
  identity: "Identity",
  "on-chain": "On-chain",
  "data-pipeline": "Data pipeline",
  "ai-agents": "AI agents",
  infrastructure: "Infrastructure",
  plugins: "Plugins",
  performance: "Performance",
};

export async function GET(context) {
  const posts = (await getCollection("engineering", ({ data }) => !data.draft))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  return rss({
    title: "Tournamental, Engineering Log",
    description:
      "How we built the open-source bracket-prediction stack. Architecture notes, decision logs, technique deep-dives. CC-BY licensed, fork the ideas.",
    site: context.site ?? "https://tournamental.com",
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/engineering/${post.slug}`,
      categories: [AREA_LABELS[post.data.area] ?? post.data.area, ...post.data.tags],
      author: post.data.author,
    })),
    customData: `<language>en-nz</language>`,
    stylesheet: false,
  });
}
