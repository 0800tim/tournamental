/**
 * Syndicate landing component set, consumed by parallel agent #67's
 * `/s/[guid]` route. This file is the stable surface that other
 * agents import from; the components themselves can iterate behind
 * it.
 */

export { SyndicateHero } from "./SyndicateHero";
export type { SyndicateHeroProps } from "./SyndicateHero";

export { SyndicateLeaderboardSection } from "./SyndicateLeaderboardSection";
export type { SyndicateLeaderboardSectionProps } from "./SyndicateLeaderboardSection";

export { MembersGrid } from "./MembersGrid";
export type { MembersGridProps } from "./MembersGrid";

export { SyndicateTrophyShelf } from "./SyndicateTrophyShelf";
export type {
  SyndicateTrophyShelfProps,
  VirtualPodiumPlace,
} from "./SyndicateTrophyShelf";

export { SyndicateActivityFeed } from "./SyndicateActivityFeed";
export type { SyndicateActivityFeedProps } from "./SyndicateActivityFeed";
