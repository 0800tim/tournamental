/**
 * GET /embed/widget.js
 *
 * Serves the Tournamental embed widget as a single self-contained
 * JavaScript bundle. Partners drop this on any site with:
 *
 *   <tournamental-pool slug="your-slug"></tournamental-pool>
 *   <script src="https://play.tournamental.com/embed/widget.js" async></script>
 *
 * The widget is a Custom Element with shadow DOM, so its styles
 * cannot leak into or out of the host page.
 *
 * Modes (attribute `mode="..."`):
 *   - "hub"  (default) — branded shell with tabs (My Predictions /
 *                        Leaderboard / About), login CTA when not
 *                        authed, "Powered by Tournamental" footer.
 *   - "play" — full-bleed iframe of the bracket builder, no chrome.
 *   - "card" — legacy promotional card layout.
 *
 * The auth state is checked via a CORS GET to /v1/auth/me on
 * auth.tournamental.com. When the user is logged out, the My
 * Predictions tab shows a "Log in to play" button that opens
 * /auth/popup in a 520×720 window; the popup posts back via
 * window.postMessage when sign-in succeeds and the widget refreshes.
 *
 * In production this is reached at:
 *   - https://play.tournamental.com/embed/widget.js (CNAME → play; future)
 *   - https://play.tournamental.com/embed/widget.js (current)
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_ORIGIN = process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";
const AUTH_ORIGIN = process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? "https://auth.tournamental.com";

function widgetSource(apiOrigin: string, authOrigin: string): string {
  return `/* Tournamental embed widget v2. Apache 2.0. */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (
    window.customElements &&
    (window.customElements.get("tournamental-pool") ||
      window.customElements.get("tournamental-syndicate"))
  )
    return;

  var API_ORIGIN = ${JSON.stringify(apiOrigin)};
  var AUTH_ORIGIN = ${JSON.stringify(authOrigin)};

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(cents, currency) {
    if (typeof cents !== "number" || cents <= 0) return "";
    var dollars = cents / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "NZD",
        minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
      }).format(dollars);
    } catch (e) {
      return (currency || "NZD") + " " + dollars.toFixed(2);
    }
  }

  function fetchJson(url, opts) {
    var init = opts || {};
    // Public config endpoint doesn't need cookies; setting
    // credentials: "include" forced the server to echo a specific
    // Origin (browsers reject "*" + credentials), which broke the
    // widget on every cross-origin partner site. Callers that DO
    // need cookies (auth-status) pass opts.credentials explicitly.
    if (!init.credentials) init.credentials = "omit";
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // ---- Styles ----
  // Theme palettes. Default is now "dark" per Tim 2026-05-21: the
  // play app is dark-only and the embed should match. Light still
  // exists for partner sites whose chrome is bright (newspaper-style
  // partners pass theme_mode="light" explicitly to opt in).
  var THEMES = {
    light: {
      bg: "#ffffff",
      surface: "#f7f9fc",
      border: "rgba(15,22,38,0.10)",
      borderSoft: "rgba(15,22,38,0.06)",
      textStrong: "#15151a",
      text: "#293041",
      textMuted: "#6b7283",
      iframeBg: "#ffffff",
      shadow: "0 10px 32px rgba(15,22,38,0.10)",
      footerBg: "#f7f9fc",
      ctaText: "#15151a",
      statBg: "rgba(15,22,38,0.04)",
    },
    dark: {
      // Charcoal canvas + gold accents, matching docs/BRAND.md §2.
      // Surface tokens are warm-neutral rather than navy-tinted so
      // partner-site embeds read as a piece of the editorial-sport
      // brand instead of a legacy Tournamental sky-blue widget.
      bg: "#15151a",
      surface: "#1c1c22",
      border: "rgba(255,255,255,0.08)",
      borderSoft: "rgba(255,255,255,0.05)",
      textStrong: "#ffffff",
      text: "#e6e6ea",
      textMuted: "#a3a3ad",
      iframeBg: "#15151a",
      shadow: "0 14px 44px rgba(0,0,0,0.55)",
      footerBg: "rgba(0,0,0,0.35)",
      ctaText: "#15151a",
      statBg: "rgba(255,255,255,0.04)",
    },
  };

  function widgetStyles(primary, accent, theme) {
    var t = THEMES[theme] || THEMES.light;
    return [
      ':host { display: block; width: 100%; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: ' + t.text + '; }',
      '.tnm-shell { background: ' + t.bg + '; border-radius: 14px; border: 1px solid ' + t.border + '; overflow: hidden; box-shadow: ' + t.shadow + '; display: flex; flex-direction: column; }',
      '.tnm-header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: linear-gradient(135deg, ' + primary + '14 0%, ' + accent + '14 100%); border-bottom: 1px solid ' + t.borderSoft + '; }',
      '.tnm-logo { width: 40px; height: 40px; border-radius: 10px; background: #ffffff; padding: 5px; box-sizing: border-box; flex: 0 0 40px; display: flex; align-items: center; justify-content: center; border: 1px solid ' + t.borderSoft + '; }',
      '.tnm-logo img { width: 100%; height: 100%; object-fit: contain; }',
      '.tnm-logo--initial { background: ' + primary + '; color: #15151a; font-weight: 800; font-size: 18px; padding: 0; border: 0; }',
      '.tnm-title { display: flex; flex-direction: column; min-width: 0; flex: 1; }',
      '.tnm-name { font-size: 15px; font-weight: 700; color: ' + t.textStrong + '; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.tnm-tour { font-size: 11px; color: ' + t.textMuted + '; letter-spacing: 0.04em; text-transform: uppercase; }',
      '.tnm-tabs { display: flex; gap: 0; background: ' + t.surface + '; border-bottom: 1px solid ' + t.borderSoft + '; }',
      '.tnm-tab { flex: 1; padding: 12px 8px; background: transparent; border: 0; border-bottom: 2px solid transparent; color: ' + t.textMuted + '; font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; transition: color 120ms, border-color 120ms, background 120ms; }',
      '.tnm-tab:hover { color: ' + t.text + '; background: ' + t.surface + '; }',
      '.tnm-tab[aria-selected="true"] { color: ' + primary + '; border-bottom-color: ' + primary + '; }',
      '.tnm-pane { padding: 18px; min-height: 320px; }',
      '.tnm-pane[data-pane="play"] { padding: 0; }',
      // min-height is just the pre-message fallback; the iframe sends a
      // tnm:resize postMessage on every layout change and the listener
      // below rewrites height to fit content, removing the inner scroll.
      '.tnm-iframe { width: 100%; min-height: 320px; height: 320px; border: 0; display: block; background: ' + t.iframeBg + '; transition: height 180ms ease; }',
      '.tnm-cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 22px; border-radius: 999px; background: ' + primary + '; color: ' + t.ctaText + '; font: inherit; font-weight: 700; font-size: 14px; border: 0; cursor: pointer; text-decoration: none; }',
      '.tnm-cta:hover { filter: brightness(1.05); }',
      '.tnm-cta--ghost { background: transparent; color: ' + primary + '; border: 1px solid ' + primary + '44; }',
      '.tnm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 36px 18px; text-align: center; }',
      '.tnm-empty h3 { margin: 0; font-size: 18px; font-weight: 800; color: ' + t.textStrong + '; }',
      '.tnm-empty p { margin: 0; color: ' + t.text + '; max-width: 36ch; font-size: 13px; }',
      // Soft sign-in nudge for anonymous guests on a public pool. Sits
      // above the bracket iframe; non-blocking, non-modal. The button
      // shares the .tnm-cta data-action="login" handler so the existing
      // popup-flow listener picks it up.
      '.tnm-anon-nudge { padding: 10px 14px; background: ' + t.statBg + '; border-bottom: 1px solid ' + t.borderSoft + '; color: ' + t.textMuted + '; font-size: 12px; line-height: 1.45; }',
      '.tnm-nudge-link { background: transparent; border: 0; color: ' + primary + '; font: inherit; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px; }',
      '.tnm-nudge-link:hover { filter: brightness(1.1); }',
      '.tnm-stat-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }',
      '.tnm-stat { background: ' + t.statBg + '; border: 1px solid ' + t.borderSoft + '; padding: 10px 14px; border-radius: 10px; min-width: 130px; }',
      '.tnm-stat-label { font-size: 11px; color: ' + t.textMuted + '; letter-spacing: 0.05em; text-transform: uppercase; }',
      '.tnm-stat-value { font-size: 18px; font-weight: 800; color: ' + t.textStrong + '; margin-top: 2px; }',
      '.tnm-section { margin-top: 16px; }',
      '.tnm-section-title { font-size: 11px; color: ' + t.textMuted + '; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; font-weight: 700; }',
      '.tnm-about { margin: 0; color: ' + t.text + '; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }',
      '.tnm-prize-row { display: flex; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid ' + t.borderSoft + '; }',
      '.tnm-prize-row:last-child { border-bottom: 0; }',
      '.tnm-prize-rank { width: 24px; font-weight: 700; color: ' + primary + '; }',
      '.tnm-prize-label { flex: 1; color: ' + t.text + '; font-size: 13px; }',
      '.tnm-prize-pct { font-weight: 700; color: ' + t.textStrong + '; }',
      '.tnm-sponsor { margin-top: 16px; padding: 12px; background: ' + t.statBg + '; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: ' + t.text + '; }',
      '.tnm-sponsor img { max-height: 28px; max-width: 80px; object-fit: contain; }',
      '.tnm-footer { padding: 10px 18px; background: ' + t.footerBg + '; border-top: 1px solid ' + t.borderSoft + '; text-align: center; font-size: 11px; color: ' + t.textMuted + '; }',
      '.tnm-footer a { color: ' + primary + '; text-decoration: none; font-weight: 600; }',
      '.tnm-loading { padding: 40px 18px; text-align: center; color: ' + t.textMuted + '; font-size: 13px; }',
      '.tnm-error { padding: 30px 18px; text-align: center; color: #d63b3b; font-size: 13px; }',
    ].join("");
  }

  function loadingMarkup() {
    return '<div class="tnm-loading">Loading pool…</div>';
  }
  function errorMarkup(msg) {
    return '<div class="tnm-error">' + escapeHtml(msg) + '</div>';
  }

  // ---- Hub rendering ----

  function renderHub(root, config, authed, currentTab) {
    var primary = (config.branding && config.branding.primary_colour) || "#fbbf24";
    var accent = (config.branding && config.branding.accent_colour) || "#3c8bcf";
    var theme = config.theme_mode === "light" ? "light" : "dark";
    var name = config.name || "Pool";
    var logoUrl = config.branding && config.branding.logo_url ? config.branding.logo_url : null;
    var sponsor = config.sponsor;
    var hideFooter = !!config.hide_tournamental_footer;

    var tabs = [
      { id: "play", label: "My Predictions" },
      { id: "leaderboard", label: "Leaderboard" },
      { id: "about", label: "About" },
    ];
    // Default tab: Play when the user can actually play (authed, OR
    // anonymous on a public pool). About otherwise (i.e. private pool
    // + anon, where Play is just an access-request CTA).
    var poolIsPublic = config.is_public !== false;
    var canPlayNow = authed || poolIsPublic;
    var tab = currentTab || (canPlayNow ? "play" : "about");

    // Resolve logo (might be a relative /branding/... URL).
    var absLogo = null;
    if (logoUrl) {
      absLogo = /^https?:\\/\\//.test(logoUrl) ? logoUrl : API_ORIGIN + logoUrl;
    }

    var html = '<style>' + widgetStyles(primary, accent, theme) + '</style>' +
      '<div class="tnm-shell">' +
        '<div class="tnm-header">' +
          (absLogo
            ? '<div class="tnm-logo"><img src="' + escapeHtml(absLogo) + '" alt=""/></div>'
            : '<div class="tnm-logo tnm-logo--initial">' + escapeHtml((name.charAt(0) || "T").toUpperCase()) + '</div>') +
          '<div class="tnm-title">' +
            '<div class="tnm-name">' + escapeHtml(name) + '</div>' +
            '<div class="tnm-tour">FIFA World Cup 2026 Predictor</div>' +
          '</div>' +
        '</div>' +
        '<div class="tnm-tabs" role="tablist">';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      html += '<button class="tnm-tab" role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + escapeHtml(t.label) + '</button>';
    }
    html += '</div>' +
        '<div class="tnm-pane" data-pane="' + tab + '">' + paneMarkup(tab, config, authed) + '</div>';
    if (!hideFooter) {
      html += '<div class="tnm-footer">Powered by <a href="https://tournamental.com" target="_blank" rel="noopener noreferrer">Tournamental</a> · the global bracket game</div>';
    }
    html += '</div>';
    root.innerHTML = html;

    // Wire tab clicks.
    var tabButtons = root.querySelectorAll(".tnm-tab");
    tabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = btn.getAttribute("data-tab");
        if (next === tab) return;
        renderHub(root, config, authed, next);
      });
    });
  }

  function paneMarkup(tab, config, authed) {
    if (tab === "play") return playPaneMarkup(config, authed);
    if (tab === "leaderboard") return leaderboardPaneMarkup(config);
    return aboutPaneMarkup(config);
  }

  function playPaneMarkup(config, authed) {
    var slug = config.slug;
    var theme = config.theme_mode === "light" ? "light" : "dark";
    var name = escapeHtml(config.name || "this pool");
    var isPublic = config.is_public !== false; // default-open if older config payload omits the flag
    var requiresApproval = !isPublic && config.requires_approval === true;

    // PRIVATE + unauthenticated -> hard gate. We do NOT show the iframe
    // because the bracket save flow can't attach anonymous picks to a
    // not-yet-existent member row. Owner approval is required.
    if (requiresApproval && !authed) {
      return '<div class="tnm-empty">' +
        '<h3>' + name + ' is a private pool</h3>' +
        '<p>The pool owner approves who plays. Sign up to request access -- you can build your bracket once they approve you.</p>' +
        '<button type="button" class="tnm-cta" data-action="login">Sign up &amp; request access</button>' +
        '</div>';
    }

    // PRIVATE + authed but still waiting on owner approval. config._joinState
    // is "pending" when the post-auth join POST returned status=pending,
    // "active" when accepted on the spot. Anything else falls through to
    // the iframe (legacy approved members from before this flag landed).
    if (requiresApproval && authed && config._joinState === "pending") {
      return '<div class="tnm-empty">' +
        '<h3>Waiting for owner approval</h3>' +
        '<p>We sent your request to the pool owner. You\'ll be able to build your bracket as soon as they approve you -- reload this page after that to start picking.</p>' +
        '</div>';
    }

    // PUBLIC (or unrestricted) -> drop the iframe in regardless of auth.
    // Anonymous players' picks persist in localStorage on the partner
    // origin via the iframe page's own anon-storage path. Login is
    // nudged from the Save & share + Leaderboard surfaces, not here.
    var src = API_ORIGIN + "/world-cup-2026?embed=1&pool=" + encodeURIComponent(slug) + "&theme=" + theme;
    var iframe = '<iframe class="tnm-iframe" src="' + escapeHtml(src) +
      '" allow="clipboard-write *; fullscreen *" loading="lazy" referrerpolicy="origin"></iframe>';

    // Soft sign-in nudge above the iframe for unauthenticated public
    // visitors -- no friction, but signals that login unlocks saving
    // across devices + the official leaderboard.
    if (!authed) {
      return '<div class="tnm-anon-nudge">' +
        '<span>Playing as a guest. <button type="button" class="tnm-nudge-link" data-action="login">Sign in</button> to save across devices and join the official leaderboard.</span>' +
        '</div>' + iframe;
    }
    return iframe;
  }

  function leaderboardPaneMarkup(config) {
    var members = config.member_count || 0;
    var landingUrl = config.public_landing_url || "https://play.tournamental.com/s/" + encodeURIComponent(config.slug);
    return '<div class="tnm-empty">' +
      '<h3>Leaderboard activates at kickoff</h3>' +
      '<p>' + members + ' ' + (members === 1 ? "member has" : "members have") + ' joined so far. Points unlock when the first match starts on 11 June 2026.</p>' +
      '<a class="tnm-cta tnm-cta--ghost" href="' + escapeHtml(landingUrl) + '" target="_blank" rel="noopener noreferrer">Open full leaderboard →</a>' +
      '</div>';
  }

  function aboutPaneMarkup(config) {
    var members = config.member_count || 0;
    var entryFee = config.entry_fee || null;
    var feeCents = entryFee && typeof entryFee.cents === "number" ? entryFee.cents : 0;
    var feeCurrency = entryFee && entryFee.currency ? entryFee.currency : "NZD";
    var poolCents = feeCents > 0 ? feeCents * Math.max(1, members) : 0;
    var prizeSplit = (config.prize_split && Array.isArray(config.prize_split)) ? config.prize_split : null;
    var prizeText = config.prize_text || "";
    var bonus = config.bonus_prize_text || "";
    var aboutText = config.about_text || "";
    var sponsor = config.sponsor;

    var html = '<div class="tnm-stat-row">' +
      '<div class="tnm-stat"><div class="tnm-stat-label">Members</div><div class="tnm-stat-value">' + members + '</div></div>' +
      '<div class="tnm-stat"><div class="tnm-stat-label">Entry</div><div class="tnm-stat-value">' +
        (feeCents > 0 ? escapeHtml(formatMoney(feeCents, feeCurrency)) : "Free") +
      '</div></div>';
    if (feeCents > 0) {
      html += '<div class="tnm-stat"><div class="tnm-stat-label">Prize pool</div><div class="tnm-stat-value">' + escapeHtml(formatMoney(poolCents, feeCurrency)) + '</div></div>';
    }
    html += '</div>';

    if (aboutText) {
      html += '<div class="tnm-section"><h4 class="tnm-section-title">About this pool</h4><p class="tnm-about">' + escapeHtml(aboutText) + '</p></div>';
    }
    if (prizeText && !prizeSplit) {
      html += '<div class="tnm-section"><h4 class="tnm-section-title">Prize</h4><p class="tnm-about">' + escapeHtml(prizeText) + '</p></div>';
    }
    if (prizeSplit && prizeSplit.length) {
      html += '<div class="tnm-section"><h4 class="tnm-section-title">Prize split</h4><div>';
      for (var i = 0; i < prizeSplit.length; i++) {
        var row = prizeSplit[i] || {};
        var rank = Number(row.rank || (i + 1));
        var pct = Number(row.percent || 0);
        var label = row.label || ordinal(rank) + " place";
        html += '<div class="tnm-prize-row">' +
          '<span class="tnm-prize-rank">' + escapeHtml(ordinal(rank)) + '</span>' +
          '<span class="tnm-prize-label">' + escapeHtml(label) + '</span>' +
          '<span class="tnm-prize-pct">' + pct + '%</span>' +
        '</div>';
      }
      html += '</div></div>';
    }
    if (bonus) {
      html += '<div class="tnm-section"><h4 class="tnm-section-title">Bonus prize</h4><p class="tnm-about">' + escapeHtml(bonus) + '</p></div>';
    }
    if (sponsor && (sponsor.name || sponsor.logo_url)) {
      var sponsorInner = '';
      if (sponsor.logo_url) sponsorInner += '<img src="' + escapeHtml(sponsor.logo_url) + '" alt="' + escapeHtml(sponsor.name || "Sponsor") + '"/>';
      sponsorInner += '<span>Sponsored by ' + escapeHtml(sponsor.name || "this pool's sponsor") + '</span>';
      html += '<div class="tnm-sponsor">' + sponsorInner + '</div>';
    }
    return html;
  }

  function ordinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    switch (n % 10) {
      case 1: return n + "st";
      case 2: return n + "nd";
      case 3: return n + "rd";
      default: return n + "th";
    }
  }

  // ---- Auth token store ----
  //
  // The widget stores a bearer token in localStorage keyed by the
  // partner-page origin (i.e. wherever this widget is embedded). The
  // token is minted by play.tournamental.com/api/v1/auth/widget-token
  // inside the sign-in popup and posted back to us via postMessage.
  // We send it as "Authorization: Bearer <token>" on every API call,
  // which works on every browser regardless of third-party-cookie
  // policy (Safari ITP, Firefox ETP, partitioned Chrome).
  //
  // The cookie path (credentials: "include") is still attempted as a
  // fallback for the rare browser configurations where it just works
  // and the partner happens to not have ever logged out -- belt and
  // braces.

  var TOKEN_STORAGE_KEY = "tnm.widget.token.v1";

  function loadStoredToken() {
    try {
      var raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data.token !== "string") return null;
      if (typeof data.expires_at === "number" && data.expires_at * 1000 < Date.now()) {
        try { window.localStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) { /* ignore */ }
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function storeToken(tokenData) {
    try {
      if (!tokenData || !tokenData.token) return;
      window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
        token: tokenData.token,
        expires_at: tokenData.expires_at || 0,
        user: tokenData.user || null,
      }));
    } catch (e) { /* localStorage might be disabled; degrade gracefully */ }
  }

  function clearStoredToken() {
    try { window.localStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function authHeaders() {
    var tok = loadStoredToken();
    return tok ? { Authorization: "Bearer " + tok.token } : {};
  }

  // ---- Auth probe ----

  function checkAuth() {
    // Sends both paths:
    //   - Authorization: Bearer <token> when we have a token from the
    //     popup (works cross-origin regardless of cookie policy)
    //   - credentials: "include" so the apex tnm_session cookie is
    //     attempted as a fallback (works only on browsers that don't
    //     block third-party cookies)
    // The server resolves either; the client doesn't need to know
    // which one succeeded.
    return fetch(API_ORIGIN + "/api/v1/auth-status", {
      credentials: "include",
      headers: authHeaders(),
    })
      .then(function (r) {
        if (r.status === 401) {
          // Token has been invalidated server-side; clear so we revert
          // to the unauthenticated CTA cleanly.
          clearStoredToken();
          return { authenticated: false };
        }
        return r.ok ? r.json() : { authenticated: false };
      })
      .then(function (j) { return !!(j && j.authenticated); })
      .catch(function () { return false; });
  }

  // ---- Element ----

  var TournamentalSyndicate = function () {
    var elem = Reflect.construct(HTMLElement, [], TournamentalSyndicate);
    return elem;
  };
  TournamentalSyndicate.prototype = Object.create(HTMLElement.prototype);
  TournamentalSyndicate.prototype.constructor = TournamentalSyndicate;
  Object.setPrototypeOf(TournamentalSyndicate, HTMLElement);

  TournamentalSyndicate.prototype.connectedCallback = function () {
    var self = this;
    var slug = (this.getAttribute("slug") || this.getAttribute("data-syndicate") || "").trim().toLowerCase();
    var mode = (this.getAttribute("mode") || "hub").trim().toLowerCase();
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!slug) {
      this.shadowRoot.innerHTML = errorMarkup("Missing slug attribute.");
      return;
    }

    // Bare iframe mode (no chrome).
    if (mode === "play") {
      // The height attribute (default 780) is now just the pre-message
      // fallback height before the iframe reports its real content
      // size via tnm:resize. The global listener at the top of this
      // IIFE rewrites the height on every change.
      var iframeHeight = (this.getAttribute("height") || "780").trim();
      var iframeSrc = API_ORIGIN + "/world-cup-2026?embed=1&pool=" + encodeURIComponent(slug);
      this.shadowRoot.innerHTML =
        '<style>:host{display:block;width:100%;}iframe.tnm-iframe{width:100%;height:' + escapeHtml(iframeHeight) + 'px;border:0;border-radius:12px;background:#15151a;display:block;transition:height 180ms ease;}</style>' +
        '<iframe class="tnm-iframe" src="' + escapeHtml(iframeSrc) + '" allow="clipboard-write *; fullscreen *" loading="lazy" referrerpolicy="origin"></iframe>';
      return;
    }

    // mode === "card" → legacy minimal card not built in v2; treat as "hub".
    // mode === "hub" (default) → branded shell with tabs.
    this.shadowRoot.innerHTML = '<style>' + widgetStyles("#fbbf24", "#3c8bcf", "light") + '</style>' + loadingMarkup();
    var root = this.shadowRoot;

    Promise.all([
      fetchJson(API_ORIGIN + "/api/v1/syndicates/" + encodeURIComponent(slug) + "/config")
        .then(function (j) { return j.syndicate || j; })
        .then(function (cfg) { cfg.slug = slug; return cfg; }),
      checkAuth(),
    ])
      .then(function (results) {
        var config = results[0];
        var authed = results[1];
        renderHub(root, config, authed, null);

        // Click handler: "Log in to play" CTA opens the auth popup.
        root.addEventListener("click", function (ev) {
          var target = ev.target;
          if (!target || target.getAttribute("data-action") !== "login") return;
          ev.preventDefault();
          var url = API_ORIGIN + "/auth/popup?pool=" + encodeURIComponent(slug) + "&from=embed";
          var w = 520, h = 720;
          var left = (window.screen.width - w) / 2;
          var top = (window.screen.height - h) / 2;
          window.open(url, "tnm_auth", "width=" + w + ",height=" + h + ",top=" + top + ",left=" + left + ",resizable=yes,scrollbars=yes");
        });

        // postMessage listener for auth success → store the bearer
        // token the popup minted for us, then re-check auth.
        //
        // Origin check: only accept messages from the play app origin.
        // Without this, any third-party iframe on the partner page
        // could spoof a tournamental-auth message and shove our
        // widget into authed state. The popup runs on API_ORIGIN
        // (play.tournamental.com) so we lock the check there.
        window.addEventListener("message", function (ev) {
          if (ev.origin !== API_ORIGIN) return;
          if (!ev.data || ev.data.type !== "tournamental-auth" || !ev.data.ok) return;
          if (ev.data.token) {
            storeToken({
              token: ev.data.token,
              expires_at: ev.data.expires_at,
              user: ev.data.user,
            });
          }
          checkAuth().then(function (nowAuthed) {
            // Private pool: now that the user is authed, POST a join
            // request so the owner gets notified. The response tells
            // us whether they were immediately accepted ("active") or
            // are still waiting ("pending"); we surface that in the
            // Play tab via the joinState attached to config.
            var privatePool =
              config.is_public === false && config.requires_approval === true;
            if (nowAuthed && privatePool) {
              fetch(
                API_ORIGIN + "/api/v1/syndicates/" + encodeURIComponent(slug) + "/join",
                {
                  method: "POST",
                  credentials: "include",
                  headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
                  body: "{}",
                },
              )
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; })
                .then(function (res) {
                  config._joinState = res && res.status ? res.status : "pending";
                  renderHub(root, config, true, "play");
                });
              return;
            }
            renderHub(root, config, nowAuthed, "play");
          });
        });
      })
      .catch(function (err) {
        root.innerHTML = errorMarkup(
          err && err.message === "HTTP 404" ? "Pool not found." : "Could not load pool."
        );
      });
  };

  // ---- Iframe auto-height ----
  // The bracket page mounts <EmbedHeightReporter> when ?embed=1 and
  // posts { type: "tnm:resize", height } to the parent on every
  // content-size change. We match the message back to the iframe via
  // event.source === iframe.contentWindow, then write the new height
  // so the partner page never sees an inner scrollbar. Locked to
  // API_ORIGIN so a third-party iframe on the same page can't shove
  // our widget around.
  function findTnmIframes() {
    var iframes = [];
    var hosts = document.querySelectorAll(
      "tournamental-pool, tournamental-syndicate",
    );
    for (var i = 0; i < hosts.length; i++) {
      var sr = hosts[i].shadowRoot;
      if (!sr) continue;
      var found = sr.querySelectorAll("iframe.tnm-iframe");
      for (var j = 0; j < found.length; j++) iframes.push(found[j]);
    }
    return iframes;
  }
  window.addEventListener("message", function (ev) {
    if (!ev.data || ev.data.type !== "tnm:resize") return;
    if (ev.origin !== API_ORIGIN) return;
    var h = Number(ev.data.height);
    if (!isFinite(h) || h <= 0) return;
    var iframes = findTnmIframes();
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === ev.source) {
        iframes[i].style.height = h + "px";
        break;
      }
    }
  });

  // Register the primary element name.
  if (window.customElements) {
    if (!window.customElements.get("tournamental-pool")) {
      try { window.customElements.define("tournamental-pool", TournamentalSyndicate); } catch (e) {}
    }
    // Backward-compat alias for the previous snippet name.
    if (!window.customElements.get("tournamental-syndicate")) {
      try {
        var TournamentalSyndicateAlias = function () {
          return Reflect.construct(HTMLElement, [], TournamentalSyndicateAlias);
        };
        TournamentalSyndicateAlias.prototype = Object.create(HTMLElement.prototype);
        TournamentalSyndicateAlias.prototype.constructor = TournamentalSyndicateAlias;
        Object.setPrototypeOf(TournamentalSyndicateAlias, HTMLElement);
        TournamentalSyndicateAlias.prototype.connectedCallback =
          TournamentalSyndicate.prototype.connectedCallback;
        window.customElements.define("tournamental-syndicate", TournamentalSyndicateAlias);
      } catch (e) {}
    }
  }
})();
`;
}

export function GET(_req: NextRequest): Response {
  const body = widgetSource(API_ORIGIN, AUTH_ORIGIN);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short browser cache + short edge cache so widget updates
      // propagate in ~1 minute. Partner sites that want hard-pin can
      // version their script src manually (?v=N).
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
