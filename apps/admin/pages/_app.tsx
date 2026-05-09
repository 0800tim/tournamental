/**
 * Pages-router shim — see pages/_document.tsx for context.
 */
import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
