/**
 * SyndicateActivityFeed — chat-style "what happened in the pool"
 * timeline. 8 events from the deterministic mock-data generator.
 */

import { pickAvatar } from "@/lib/mock/avatar";
import { mockActivityFeed, type MockActivityEvent } from "@/lib/mock/syndicate";

import "./syndicate.css";

export interface SyndicateActivityFeedProps {
  readonly syndicateSlug: string;
  readonly events?: readonly MockActivityEvent[];
  readonly title?: string;
}

export function SyndicateActivityFeed({
  syndicateSlug,
  events,
  title = "Pool activity",
}: SyndicateActivityFeedProps) {
  const rows = events ?? mockActivityFeed(syndicateSlug);
  return (
    <section className="vt-syn-section">
      <h3 className="vt-syn-section-title">
        {title}
        <span className="vt-syn-section-title-meta">Last 7 days</span>
      </h3>
      <ol className="vt-syn-feed">
        {rows.map((e) => (
          <li className="vt-syn-feed-event" key={e.id}>
            <img
              className="vt-syn-feed-avatar"
              src={pickAvatar(e.handle)}
              alt=""
              width={28}
              height={28}
              loading="lazy"
            />
            <span className="vt-syn-feed-line">
              <strong>{e.handle}</strong> {e.verb}
              {e.target ? <> · {e.target}</> : null}
            </span>
            <span className="vt-syn-feed-when">{e.when}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
