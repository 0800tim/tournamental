// /press/rss.xml, RSS 2.0 feed for official press releases.
//
// Cloned from blog/rss.xml.ts with two differences:
//   - the feed only includes non-draft, non-embargoed releases at
//     build/request time; embargoed releases never appear in the feed
//     (a journalist who needs the embargoed text emails press@),
//   - categories come from the release's tag array, prefixed with the
//     category enum so feeds can filter by "Launch", "Feature", etc.
//
// The feed is consumed by Google News, journalist RSS readers, and the
// internal news desk; keep it stable.
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const now = new Date();
  const releases = (await getCollection("press", ({ data }) => !data.draft))
    .filter((r) => !r.data.embargoUntil || r.data.embargoUntil.getTime() <= now.getTime())
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  const categoryLabel = ({
    launch: "Launch",
    milestone: "Milestone",
    partnership: "Partnership",
    feature: "Feature",
    "open-source": "Open source",
  } as const);

  return rss({
    title: "Tournamental, Press releases",
    description:
      "Official press releases from Tournamental. Launch announcements, feature releases, partnerships and milestones. For demos and embargoed briefs, email play@tournamental.com.",
    site: context.site ?? "https://tournamental.com",
    items: releases.map((release) => ({
      title: release.data.title,
      pubDate: release.data.pubDate,
      description: release.data.subtitle ?? release.data.title,
      link: `/press/${release.slug}`,
      categories: [categoryLabel[release.data.category], ...release.data.tags],
      author: release.data.contactEmail,
    })),
    customData: `<language>en-nz</language>`,
    stylesheet: false,
  });
}
