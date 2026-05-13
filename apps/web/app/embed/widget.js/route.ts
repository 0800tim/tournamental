/**
 * GET /embed/widget.js
 *
 * Serves the Tournamental embed widget as a single self-contained
 * JavaScript bundle. Partners drop this on any site with:
 *
 *   <tournamental-syndicate slug="your-slug"></tournamental-syndicate>
 *   <script src="https://embed.tournamental.com/widget.js" async></script>
 *
 * The widget is a Custom Element with shadow DOM, so its styles
 * cannot leak into or out of the host page. Fetches branding from
 * `/api/v1/syndicates/[slug]/config` (CORS-open), renders a branded
 * card with the syndicate name, prize copy, member count, sponsor
 * block, and a "Join the syndicate" button that opens the public
 * landing page on play.tournamental.com.
 *
 * Why served from a route handler rather than a static file: we want
 * to support env-based config injection (e.g. switch the API origin
 * for staging) without rebuilding the bundle. The handler templates
 * the origin once at request time and caches aggressively.
 *
 * In production this route is reached at:
 *   - https://embed.tournamental.com/widget.js (CNAME → play; future)
 *   - https://play.tournamental.com/embed/widget.js (current)
 *
 * Both paths serve the same bytes.
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_ORIGIN = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

function widgetSource(apiOrigin: string): string {
  // Single-file IIFE. No external dependencies, no framework.
  // Defensively wrapped so a missing slug just no-ops rather than
  // breaking the host page.
  return `/* Tournamental embed widget. Apache 2.0. */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.customElements && window.customElements.get("tournamental-syndicate")) return;

  var API_ORIGIN = ${JSON.stringify(apiOrigin)};

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadingMarkup() {
    return '<div class="tnm-skel" aria-live="polite">Loading syndicate…</div>';
  }

  function errorMarkup(message) {
    return '<div class="tnm-err" role="alert">' + escapeHtml(message) + '</div>';
  }

  function styles(primary, accent) {
    return [
      ':host{display:block;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e7ecf7;}',
      '.tnm-wrap{box-sizing:border-box;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#101626,#0a0e1a);border:1px solid rgba(255,255,255,0.08);max-width:560px;margin:0 auto;}',
      '.tnm-hero{position:relative;padding:24px 24px 16px;background-size:cover;background-position:center;}',
      '.tnm-hero[data-has-hero="true"]{background-color:#0a0e1a;}',
      '.tnm-hero[data-has-hero="true"]::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,14,26,0.35),rgba(10,14,26,0.92));}',
      '.tnm-hero-inner{position:relative;z-index:1;display:flex;align-items:center;gap:12px;}',
      '.tnm-logo{width:48px;height:48px;border-radius:10px;background:rgba(255,255,255,0.06);object-fit:cover;flex-shrink:0;}',
      '.tnm-title{margin:0;font:800 20px/1.2 -apple-system,system-ui,sans-serif;color:#fff;letter-spacing:-0.01em;}',
      '.tnm-eyebrow{margin:0 0 4px;font:700 11px/1 -apple-system,system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.12em;color:' + primary + ';}',
      '.tnm-body{padding:16px 24px 20px;}',
      '.tnm-prize{margin:0 0 12px;padding:10px 14px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:10px;color:' + primary + ';font-weight:600;}',
      '.tnm-stats{display:flex;gap:24px;margin:8px 0 16px;color:#cdd5e7;font-size:13px;}',
      '.tnm-stat-num{display:block;font:800 22px/1 -apple-system,system-ui,sans-serif;color:#fff;}',
      '.tnm-cta{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:14px 18px;border-radius:10px;font:700 15px/1 -apple-system,system-ui,sans-serif;background:' + primary + ';color:#0a0e1a;text-decoration:none;border:none;cursor:pointer;transition:transform 80ms ease, filter 120ms;}',
      '.tnm-cta:hover{filter:brightness(1.08);}',
      '.tnm-cta:active{transform:translateY(1px);}',
      '.tnm-secondary{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;width:100%;padding:10px 14px;border-radius:10px;color:#cdd5e7;text-decoration:none;font:600 13px/1 -apple-system,system-ui,sans-serif;border:1px solid rgba(255,255,255,0.12);background:transparent;}',
      '.tnm-sponsor{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#9aa6c2;}',
      '.tnm-sponsor img{height:20px;width:auto;border-radius:3px;}',
      '.tnm-foot{padding:10px 16px;background:rgba(0,0,0,0.25);font-size:11px;color:#9aa6c2;text-align:center;}',
      '.tnm-foot a{color:' + primary + ';text-decoration:none;font-weight:600;}',
      '.tnm-skel{padding:32px 24px;color:#9aa6c2;text-align:center;}',
      '.tnm-err{padding:16px 20px;color:#fda4af;text-align:center;}'
    ].join("");
  }

  function render(root, config) {
    var primary = (config.branding && config.branding.primary_colour) || "#fbbf24";
    var accent = (config.branding && config.branding.accent_colour) || "#21a34a";
    var heroUrl = config.branding && config.branding.hero_url ? config.branding.hero_url : null;
    var logoUrl = config.branding && config.branding.logo_url ? config.branding.logo_url : null;
    var name = config.name || "Syndicate";
    var tier = config.tier || "free";
    var members = config.member_count || 0;
    var prize = config.prize_text || "";
    var joinUrl = config.join_url || "https://play.tournamental.com/";
    var landingUrl = config.public_landing_url || "https://play.tournamental.com/";
    var hideFooter = !!config.hide_tournamental_footer;
    var sponsor = config.sponsor;

    var heroStyle = heroUrl ? ' style="background-image:url(' + JSON.stringify(heroUrl).slice(1, -1) + ')"' : '';
    var logoMarkup = logoUrl
      ? '<img class="tnm-logo" src="' + escapeHtml(logoUrl) + '" alt="" />'
      : '';

    var prizeMarkup = prize
      ? '<p class="tnm-prize">' + escapeHtml(prize) + '</p>'
      : '';

    var sponsorMarkup = "";
    if (sponsor && (sponsor.name || sponsor.logo_url)) {
      var sponsorBody =
        (sponsor.logo_url ? '<img src="' + escapeHtml(sponsor.logo_url) + '" alt="" />' : '') +
        '<span>Sponsored by ' + escapeHtml(sponsor.name || "") + '</span>';
      sponsorMarkup = sponsor.url
        ? '<a class="tnm-sponsor" href="' + escapeHtml(sponsor.url) + '" target="_blank" rel="noopener noreferrer">' + sponsorBody + '</a>'
        : '<div class="tnm-sponsor">' + sponsorBody + '</div>';
    }

    var footerMarkup = hideFooter
      ? ""
      : '<div class="tnm-foot">Powered by <a href="https://tournamental.com" target="_blank" rel="noopener noreferrer">Tournamental</a></div>';

    root.innerHTML =
      '<style>' + styles(primary, accent) + '</style>' +
      '<div class="tnm-wrap">' +
        '<div class="tnm-hero" data-has-hero="' + (heroUrl ? 'true' : 'false') + '"' + heroStyle + '>' +
          '<div class="tnm-hero-inner">' +
            logoMarkup +
            '<div>' +
              '<p class="tnm-eyebrow">' + (tier === "premium" ? "Premium syndicate" : "Tournamental syndicate") + '</p>' +
              '<h3 class="tnm-title">' + escapeHtml(name) + '</h3>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="tnm-body">' +
          prizeMarkup +
          '<div class="tnm-stats">' +
            '<div><span class="tnm-stat-num">' + members + '</span>members</div>' +
            '<div><span class="tnm-stat-num">FREE</span>to play</div>' +
          '</div>' +
          '<a class="tnm-cta" href="' + escapeHtml(joinUrl) + '" target="_blank" rel="noopener noreferrer">Join the syndicate →</a>' +
          '<a class="tnm-secondary" href="' + escapeHtml(landingUrl) + '" target="_blank" rel="noopener noreferrer">View leaderboard</a>' +
          sponsorMarkup +
        '</div>' +
        footerMarkup +
      '</div>';
  }

  function fetchConfig(slug) {
    return fetch(API_ORIGIN + "/api/v1/syndicates/" + encodeURIComponent(slug) + "/config", {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { "Accept": "application/json" },
    }).then(function (r) {
      if (!r.ok) {
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    }).then(function (body) {
      if (!body || !body.syndicate) throw new Error("malformed response");
      return body.syndicate;
    });
  }

  var TournamentalSyndicate = function () {
    // Custom Elements require this prototype chain.
    var elem = Reflect.construct(HTMLElement, [], TournamentalSyndicate);
    return elem;
  };
  TournamentalSyndicate.prototype = Object.create(HTMLElement.prototype);
  TournamentalSyndicate.prototype.constructor = TournamentalSyndicate;
  Object.setPrototypeOf(TournamentalSyndicate, HTMLElement);

  TournamentalSyndicate.prototype.connectedCallback = function () {
    var slug = (this.getAttribute("slug") || this.getAttribute("data-syndicate") || "").trim().toLowerCase();
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    if (!slug) {
      this.shadowRoot.innerHTML = errorMarkup("Missing slug attribute.");
      return;
    }
    this.shadowRoot.innerHTML = loadingMarkup();
    var root = this.shadowRoot;
    fetchConfig(slug)
      .then(function (config) { render(root, config); })
      .catch(function (err) {
        root.innerHTML = errorMarkup(
          err && err.message === "HTTP 404"
            ? "Syndicate not found."
            : "Could not load syndicate."
        );
      });
  };

  if (window.customElements && !window.customElements.get("tournamental-syndicate")) {
    try {
      window.customElements.define("tournamental-syndicate", TournamentalSyndicate);
    } catch (e) {
      // Older browsers without Custom Elements v1 fall through here;
      // we render nothing rather than throwing into the host page.
    }
  }
})();
`;
}

export function GET(_req: NextRequest): Response {
  const body = widgetSource(API_ORIGIN);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Aggressive edge cache; bump via the version string in the
      // partner's script tag (?v=2) to invalidate when needed.
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
