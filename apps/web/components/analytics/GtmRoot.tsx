"use client";

/**
 * Tournamental GTM root.
 *
 * Mounted once in `app/layout.tsx`. Responsibilities:
 *
 *  1. Inject the GTM `<script>` snippet via Next's `<Script>` so it
 *     loads after first paint (strategy `afterInteractive`), no
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
 * nothing, no script, no banner, no page-view events. The rest of
 * the app's `track()` calls become silent no-ops.
 */

import Script from "next/script";

import { getGtmId } from "@/lib/analytics";

import { ConsentBanner } from "./ConsentBanner";
import { PageViewListener } from "./PageViewListener";

/**
 * `showConsentBanner` defaults to `true` so existing call sites that
 * don't yet pass the prop (tests, future surfaces) preserve the
 * pre-2026-05-22 always-on behaviour. The root layout reads
 * CF-IPCountry server-side and only sets this to `false` for visitors
 * outside the GDPR / UK GDPR / FADP zone.
 */
export interface GtmRootProps {
  readonly showConsentBanner?: boolean;
}

export function GtmRoot({ showConsentBanner = true }: GtmRootProps = {}) {
  const gtmId = getGtmId();
  if (!gtmId) return null;

  // Accept either a GTM container ID (`GTM-XXXX`) or a GA4 measurement
  // ID (`G-XXXX`). Tim's current setup is GA4-direct via gtag.js, but
  // the env var name is unchanged for backwards compatibility.
  const isGa4Direct = gtmId.startsWith("G-");

  // Common consent + dataLayer setup. Both paths feed window.dataLayer
  // so the rest of the app's track() calls don't need to know which
  // tag is installed.
  const consentInit = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('consent', 'default', {
      'analytics_storage': 'granted',
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied'
    });
  `;

  const gtmBootstrap = `
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','${gtmId}');
  `;

  const gtagBootstrap = `
    gtag('js', new Date());
    gtag('config', '${gtmId}');
  `;

  return (
    <>
      {isGa4Direct && (
        <Script
          id="tournamental-gtag-src"
          src={`https://www.googletagmanager.com/gtag/js?id=${gtmId}`}
          strategy="afterInteractive"
        />
      )}
      <Script id="tournamental-gtm" strategy="afterInteractive">
        {consentInit + (isGa4Direct ? gtagBootstrap : gtmBootstrap)}
      </Script>
      {!isGa4Direct && (
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
      )}
      <PageViewListener />
      {showConsentBanner ? <ConsentBanner /> : null}
    </>
  );
}
