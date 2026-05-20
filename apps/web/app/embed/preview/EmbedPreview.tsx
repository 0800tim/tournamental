"use client";

import { useEffect, useRef, useState } from "react";

export function EmbedPreview({ slug: initialSlug }: { slug: string }): JSX.Element {
  const [slug, setSlug] = useState(initialSlug || "");
  const [copied, setCopied] = useState(false);
  const widgetHostRef = useRef<HTMLDivElement>(null);

  // (Re)inject the widget element when slug changes. Loading the script
  // once is enough; subsequent slug changes just swap the element.
  useEffect(() => {
    const host = widgetHostRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (!slug) return;
    const el = document.createElement("tournamental-syndicate");
    el.setAttribute("slug", slug);
    host.appendChild(el);
  }, [slug]);

  useEffect(() => {
    // One-time script load.
    if (document.querySelector('script[data-tnm-embed]')) return;
    const s = document.createElement("script");
    s.src = "/embed/widget.js";
    s.async = true;
    s.setAttribute("data-tnm-embed", "true");
    document.head.appendChild(s);
  }, []);

  const snippet = `<tournamental-syndicate slug="${slug || "your-slug"}"></tournamental-syndicate>
<script src="https://embed.tournamental.com/widget.js" async></script>`;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <main
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "32px 20px 80px",
        color: "#e7ecf7",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
      }}
    >
      <p
        style={{
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#fbbf24",
          fontWeight: 600,
          margin: 0,
        }}
      >
        Embed preview
      </p>
      <h1 style={{ fontSize: 32, margin: "8px 0 12px", letterSpacing: "-0.01em" }}>
        See your widget before you ship it
      </h1>
      <p style={{ color: "#cdd5e7", maxWidth: "60ch", margin: "0 0 24px" }}>
        Type any syndicate slug below to see what the embed renders on a partner
        site. Once it looks right, copy the snippet and paste it into your
        Squarespace / WordPress / Shopify / Webflow / custom site.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
          placeholder="your-syndicate-slug"
          style={{
            flex: "1 1 240px",
            background: "#15151a",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            color: "#fff",
            padding: "12px 16px",
            fontSize: 15,
            fontFamily: "inherit",
          }}
        />
      </div>

      <section
        style={{
          marginBottom: 32,
          padding: 24,
          background: "rgba(16,22,38,0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
        }}
      >
        <p
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#9aa6c2",
            margin: "0 0 12px",
          }}
        >
          Live preview
        </p>
        <div ref={widgetHostRef} />
        {!slug && (
          <p style={{ color: "#9aa6c2", margin: 0, fontSize: 14 }}>
            Enter a slug above to load the widget.
          </p>
        )}
      </section>

      <section>
        <p
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#9aa6c2",
            margin: "0 0 8px",
          }}
        >
          Paste this snippet on your site
        </p>
        <pre
          style={{
            background: "#15151a",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: 16,
            color: "#fde68a",
            fontSize: 12,
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
            overflowX: "auto",
            margin: 0,
          }}
        >
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          style={{
            marginTop: 12,
            background: "#fbbf24",
            color: "#15151a",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {copied ? "Copied!" : "Copy snippet"}
        </button>
      </section>
    </main>
  );
}
