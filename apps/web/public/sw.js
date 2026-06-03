/* eslint-disable */
/**
 * Tournamental PWA service worker.
 *
 * Strategies:
 *   - App shell precache: HTML route templates + critical CSS/JS at install.
 *   - Cache-first for hashed static assets under /_next/static and /icons.
 *   - Network-first for API routes under /api with a cache fallback.
 *   - Stale-while-revalidate for everything else.
 *
 * Background sync: bracket draft writes ("vt-bracket-sync" tag) replay
 * queued POSTs to /api/bracket/draft when the network returns.
 *
 * Push notifications: kickoff / goal alerts. The actual subscription is
 * managed by `apps/push-notifications`; this worker only handles the
 * delivery + click handler.
 */

"use strict";

// Bumped 2026-06-04 to flush any client state captured before the
// /s/<handle> resolver hardening + display-name uniqueness landed
// (PR #263, #264). A user who tested handle collisions before the
// fix could end up with their own bracket re-rendered on someone
// else's /s/<handle> page when client-side state hung around in
// runtime caches; bumping the SW version drops those caches.
// Previous bump 2026-06-03, dropped stale avatars + pool branding.
// Previous bump 2026-05-24, wiped i18n-blind cached HTML.
const VERSION = "vt-shell-v4-2026-06-04-share-state-flush";
const SHELL_CACHE = `vt-shell-${VERSION}`;
const STATIC_CACHE = `vt-static-${VERSION}`;
const RUNTIME_CACHE = `vt-runtime-${VERSION}`;
const API_CACHE = `vt-api-${VERSION}`;

const OFFLINE_URL = "/offline";

const SHELL_URLS = [
  "/",
  "/world-cup-2026",
  "/watch",
  "/profile",
  "/leaderboard",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/fonts/Fraunces-Variable.woff2",
];

const BRACKET_QUEUE_DB = "vt-bracket-queue";
const BRACKET_QUEUE_STORE = "writes";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort precache; missing routes (e.g. /watch in dev) won't
      // fail the install, we just continue without them.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(url).catch(() => {
            /* ignore */
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    // Bracket draft writes: queue on offline, replay on sync.
    if (
      req.method === "POST" &&
      new URL(req.url).pathname.startsWith("/api/bracket/")
    ) {
      event.respondWith(handleBracketWrite(req));
    }
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // User-uploaded media (avatars + pool branding) must NEVER be served
  // from the SW cache — uploading a new image must be visible
  // immediately. Let the request pass straight through to the network,
  // honour origin Cache-Control headers (avatar route serves `no-store`,
  // branding serves `max-age=60 must-revalidate` with an ETag). Tim
  // 2026-06-03.
  if (
    url.pathname.startsWith("/avatars/") ||
    url.pathname.startsWith("/branding/")
  ) {
    return; // no respondWith → browser handles the fetch normally
  }

  // Cache-first for hashed static assets.
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons") ||
    url.pathname.startsWith("/flags") ||
    url.pathname.startsWith("/fonts") ||
    url.pathname.startsWith("/animations") ||
    url.pathname.startsWith("/models")
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Network-first for API routes.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Navigation requests: shell-cache fallback when offline.
  if (req.mode === "navigate") {
    event.respondWith(navigationStrategy(req));
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return cached ?? new Response("", { status: 504 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}

async function navigationStrategy(req) {
  try {
    // Force-bypass the HTTP cache so a locale-cookie change is reflected
    // on the very next reload (default fetch may use cached responses
    // when the SHELL_CACHE precache primed them earlier in the session).
    const res = await fetch(req, { cache: "no-store" });
    // Do NOT cache HTML responses anymore. SSR output depends on the
    // vt_locale cookie, so a single cached HTML would lie to every
    // subsequent visitor regardless of their language pick. The
    // SHELL_CACHE precache (install handler) still primes the
    // navigationStrategy's offline fallback, but we never overwrite it
    // with locale-specific responses.
    return res;
  } catch (e) {
    const cache = await caches.open(SHELL_CACHE);
    const cached =
      (await cache.match(req)) ??
      (await cache.match(OFFLINE_URL)) ??
      (await cache.match("/")) ??
      null;
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}

// ---------- Background sync for bracket draft writes ----------

async function handleBracketWrite(req) {
  try {
    const res = await fetch(req.clone());
    if (!res.ok) throw new Error("non-ok");
    return res;
  } catch (e) {
    try {
      await queueBracketWrite(await serializeRequest(req));
      if (
        "sync" in self.registration &&
        typeof self.registration.sync.register === "function"
      ) {
        await self.registration.sync.register("vt-bracket-sync");
      }
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    } catch (qe) {
      return new Response(JSON.stringify({ error: "offline-queue-failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}

async function serializeRequest(req) {
  const clone = req.clone();
  const body = await clone.text();
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body,
    timestamp: Date.now(),
  };
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(BRACKET_QUEUE_DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(BRACKET_QUEUE_STORE)) {
        db.createObjectStore(BRACKET_QUEUE_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function queueBracketWrite(entry) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BRACKET_QUEUE_STORE, "readwrite");
    tx.objectStore(BRACKET_QUEUE_STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function drainQueue() {
  const db = await openQueueDb();
  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction(BRACKET_QUEUE_STORE, "readonly");
    const req = tx.objectStore(BRACKET_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      });
      if (res.ok) {
        await new Promise((resolve) => {
          const tx = db.transaction(BRACKET_QUEUE_STORE, "readwrite");
          tx.objectStore(BRACKET_QUEUE_STORE).delete(entry.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
    } catch (e) {
      // leave in queue for next sync
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "vt-bracket-sync") {
    event.waitUntil(drainQueue());
  }
});

// ---------- Push notifications ----------

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "Tournamental", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title ?? "Tournamental";
  const options = {
    body: payload.body ?? "Kickoff in 5 minutes",
    icon: payload.icon ?? "/icons/icon-192.png",
    badge: payload.badge ?? "/icons/icon-192.png",
    data: payload.data ?? {},
    tag: payload.tag ?? "vt-default",
    renotify: Boolean(payload.renotify),
    actions: payload.actions ?? [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ("focus" in c) {
            c.navigate(url).catch(() => {});
            return c.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// Allow a host page to update theme-color on theme switch by posting
// a message; some browsers cache the theme-color from manifest only.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "VT_THEME") {
    // No-op for now; clients update meta directly. Reserved for future
    // server-driven theme propagation.
  }
});
