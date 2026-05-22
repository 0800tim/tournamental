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
    // so we don't stack duplicates. Tim 2026-05-23: switched from the
    // backward-compat `tournamental-syndicate` alias to the primary
    // `tournamental-pool` tag — the alias is registered as a
    // function-based custom element (Reflect.construct) which doesn't
    // upgrade reliably when the DOM node is created before the bundle
    // loads, which is exactly our race here. The primary tag uses the
    // same pattern but is the one that's actually exercised by
    // partner sites, so we keep that path warm.
    host.innerHTML = "";
    const el = document.createElement("tournamental-pool");
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
      s.src = `/widget.js?bv=${Date.now()}`;
      s.async = true;
      s.setAttribute("data-tnm-embed-bundle", "true");
      document.head.appendChild(s);
    }
  }, [slug]);

  return <div ref={hostRef} className="vt-syndicates-demo-host" />;
}
