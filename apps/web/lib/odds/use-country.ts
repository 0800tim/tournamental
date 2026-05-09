/**
 * useCountry — client-side hook that fetches the visitor's country
 * from `/api/odds/country` once on mount. Default `null`; the affiliate
 * CTA hides itself when the country is `null` (failsafe, see
 * `lib/odds/geo.ts`).
 */

"use client";

import { useEffect, useState } from "react";

const SESSION_KEY = "vtorn:cf-country";

export function useCountry(): string | null {
  const [country, setCountry] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (country) return;
    let cancelled = false;
    fetch("/api/odds/country", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || typeof j.country !== "string") return;
        setCountry(j.country);
        try {
          window.sessionStorage.setItem(SESSION_KEY, j.country);
        } catch {
          // ignore — sessionStorage may be unavailable in private mode
        }
      })
      .catch(() => {
        // Stay null; CTA stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  return country;
}
