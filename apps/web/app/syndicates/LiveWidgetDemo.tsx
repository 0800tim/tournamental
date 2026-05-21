"use client";

/**
 * Embeds the production `<tournamental-syndicate>` widget on the
 * /syndicates marketing page itself, so visitors see exactly what
 * they will be shipping rather than just the snippet. Loads the
 * widget bundle on mount; the Custom Element handles its own
 * lifecycle inside shadow DOM.
 */

import { useEffect, useRef } from "react";

export function LiveWidgetDemo({ slug }: { slug: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Inject the widget element. If we're hot-reloading, clear first
    // so we don't stack duplicates.
    host.innerHTML = "";
    const el = document.createElement("tournamental-syndicate");
    el.setAttribute("slug", slug);
    host.appendChild(el);

    // Load the widget bundle once per page. We append a `bv` (build
    // version) query so the edge / browser cache doesn't pin an
    // outdated copy when the widget source ships a fix (e.g. the
    // 2026-05-21 CORS-credentials fix). Partner sites use the bare
    // /embed/widget.js URL; this cache-bust is just for the internal
    // demo where freshness matters.
    if (!document.querySelector('script[data-tnm-embed-bundle]')) {
      const s = document.createElement("script");
      s.src = `/embed/widget.js?bv=${Date.now()}`;
      s.async = true;
      s.setAttribute("data-tnm-embed-bundle", "true");
      document.head.appendChild(s);
    }
  }, [slug]);

  return <div ref={hostRef} className="vt-syndicates-demo-host" />;
}
