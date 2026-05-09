/**
 * Pages-router shim.
 *
 * The admin app is fully app-router; this file exists only because
 * Next.js 14.2 prerenders synthetic /404 and /500 entries through the
 * legacy pages router. Without a `pages/_document.tsx` those passes
 * crash with "<Html> should not be imported outside of pages/_document".
 * See https://github.com/vercel/next.js/issues/55642.
 *
 * Do not add UI here; the actual error / not-found pages live in
 * `app/not-found.tsx` and `app/error.tsx`.
 */
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
