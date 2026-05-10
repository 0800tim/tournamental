/**
 * StoriesStrip — Instagram-style horizontal strip of 80px circular
 * tappable items. Used for "Bracket of the day", "Top pundits",
 * featured matches.
 */

import Link from "next/link";

import "./ui.css";

export interface StoryItem {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly imageUrl?: string;
  /** Show the dashed-border "progress" ring around the avatar. */
  readonly progress?: boolean;
  /** Single-glyph text shown when `imageUrl` is missing. */
  readonly initials?: string;
}

export interface StoriesStripProps {
  readonly items: readonly StoryItem[];
}

export function StoriesStrip({ items }: StoriesStripProps) {
  return (
    <div className="vt-stories" role="list">
      {items.map((item) => {
        const inner = (
          <>
            <span className="vt-story-circle" aria-hidden="true">
              <span
                className="vt-story-inner"
                style={
                  item.imageUrl
                    ? { backgroundImage: `url(${item.imageUrl})` }
                    : undefined
                }
              >
                {!item.imageUrl ? item.initials ?? item.label[0] : null}
              </span>
            </span>
            <span className="vt-story-label">{item.label}</span>
          </>
        );
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className="vt-story"
              role="listitem"
              data-progress={item.progress ? "1" : undefined}
            >
              {inner}
            </Link>
          );
        }
        return (
          <div
            key={item.id}
            className="vt-story"
            role="listitem"
            data-progress={item.progress ? "1" : undefined}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
