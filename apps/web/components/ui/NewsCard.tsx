/**
 * NewsCard, image-left + headline-right + category-pill row card.
 * Tap target spans the whole card.
 */

import Link from "next/link";

import "./ui.css";

export interface NewsCardProps {
  readonly title: string;
  readonly category?: string;
  readonly meta?: string;
  readonly imageUrl?: string;
  readonly href?: string;
}

export function NewsCard({
  title,
  category,
  meta,
  imageUrl,
  href,
}: NewsCardProps) {
  const body = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="vt-news-card-img" src={imageUrl} alt="" loading="lazy" />
      ) : (
        <div
          className="vt-news-card-img"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(135deg, #2071b8, #6cabdd 60%, #f3b83b)",
          }}
        />
      )}
      <div className="vt-news-card-body">
        {category ? <span className="vt-news-card-cat">{category}</span> : null}
        <h3 className="vt-news-card-title">{title}</h3>
        {meta ? <span className="vt-news-card-meta">{meta}</span> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="vt-news-card">
        {body}
      </Link>
    );
  }
  return <div className="vt-news-card">{body}</div>;
}
