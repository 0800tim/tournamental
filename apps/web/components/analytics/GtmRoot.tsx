"use client";

/**
 * Tournamental GTM root.
 *
 * Mounted once in `app/layout.tsx`. Responsibilities:
 *
 *  1. Inject the GTM `<script>` snippet via Next's `<Script>` so it
 *     loads after first paint (strategy `afterInteractive`) — no
 *     LCP regression.
 *  2. Render the `<noscript>` iframe fallback for JS-disabled
 *     browsers (rare on a PWA, but it costs nothing and Google's
 *     GTM docs require it for accurate page-view counts).
 *  3. Fire a `page.view` event on every client-side route change
 *     (via `usePageView()`).
 *  4. Render the `<ConsentBanner/>` on first visit.
 *
 * If `NEXT_PUBLIC_GTM_ID` is unset (Tim's container ID is still
 * pending per docs/26-setup-checklist.md), this component renders
 * nothing — no script, no banner, no page-view events. The rest of
 * the app's `track()` calls become silent no-ops.
 */

import Script from "next/script";

import { getGtmId } from "@/lib/analytics";

import { ConsentBanner } from "./ConsentBanner";
import { PageViewListener } from "./PageViewListener";

export function GtmRoot() {
  const gtmId = getGtmId();
  if (!gtmId) return null;

  // The standard GTM bootstrap, lightly trimmed. Note the
  // `consent default` push before the GTM library loads — this is
  // Google's recommended pattern for consent mode v2 and means GA4
  // honours the user's decision from the very first event.
  const gtmInit = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    // Consent defaults: analytics on (essential for product analytics),
    // ads off until the consent banner upgrades us. The
    // <ConsentBanner/> writes a localStorage decision; on subsequent
    // visits we re-apply it via setConsent() in app code.
    gtag('consent', 'default', {
      'analytics_storage': 'granted',
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied'
    });
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','${gtmId}');
  `;

  return (
    <>
      <Script id="tournamental-gtm" strategy="afterInteractive">
        {gtmInit}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager (no-JS fallback)"
        />
      </noscript>
      <PageViewListener />
      <ConsentBanner />
    </>
  );
}
