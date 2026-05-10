/**
 * Native-shell shim for the wrapped web app.
 *
 * The web app runs in three contexts:
 *   1. Plain browser (desktop + mobile web)        — `isNative()` → false
 *   2. Inside the iOS Capacitor shell             — `isNative()` → true
 *   3. Inside the Android Capacitor shell         — `isNative()` → true
 *
 * In contexts 2/3, Capacitor injects a global `window.Capacitor` object.
 * We **never** statically import `@capacitor/*` from this file because
 * that would pull a few kilobytes of bridge code into every web page
 * for users who'll never see the shell. Everything is dynamic-imported
 * behind `isNative()`.
 *
 * Public API:
 *   isNative()
 *   tapFeedback(style)        — haptic on native, navigator.vibrate on web
 *   shareContent(input)       — OS share-sheet on native, Web Share API on
 *                                web, clipboard fallback otherwise
 *   bootNativeShell()         — fire-and-forget; runs once per page load
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => 'ios' | 'android' | 'web';
    };
  }
}

export function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function') return false;
  return cap.isNativePlatform();
}

export type HapticStyle = 'light' | 'medium' | 'heavy';

/**
 * Haptic-tap feedback. On native devices fires `Haptics.impact()`; on web
 * falls back to `navigator.vibrate()` if available; otherwise no-op.
 *
 * Safe to await from event handlers — never throws.
 */
interface CapacitorHapticsModule {
  Haptics: { impact(opts: { style: unknown }): Promise<void> };
  ImpactStyle: { Light: unknown; Medium: unknown; Heavy: unknown };
}

interface CapacitorShareModule {
  Share: {
    share(opts: {
      title?: string;
      text?: string;
      url?: string;
      dialogTitle?: string;
    }): Promise<void>;
  };
}

/**
 * Dynamic-import via a string-variable so Webpack/Next's static analyser
 * does NOT try to resolve `@capacitor/*` at web-build time. The packages
 * are only present in the @vtorn/native bundle on device builds.
 */
async function loadCapacitorModule<T>(name: string): Promise<T | null> {
  try {
    const id = name; // string variable defeats static resolution
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ id)) as T;
    return mod;
  } catch {
    return null;
  }
}

export async function tapFeedback(style: HapticStyle = 'light'): Promise<void> {
  if (isNative()) {
    const mod = await loadCapacitorModule<CapacitorHapticsModule>(
      '@capacitor/haptics',
    );
    if (mod) {
      try {
        const styleVal =
          style === 'heavy'
            ? mod.ImpactStyle.Heavy
            : style === 'medium'
              ? mod.ImpactStyle.Medium
              : mod.ImpactStyle.Light;
        await mod.Haptics.impact({ style: styleVal });
        return;
      } catch {
        // fall through
      }
    }
  }
  if (typeof navigator !== 'undefined') {
    const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean })
      .vibrate;
    if (typeof v === 'function') {
      const ms = style === 'heavy' ? 30 : style === 'medium' ? 15 : 10;
      v.call(navigator, [ms]);
    }
  }
}

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Cross-platform share. Native → Capacitor Share plugin (OS sheet); web →
 * Web Share API where available; fallback → copy URL to clipboard.
 *
 * Returns `true` if the share / copy succeeded, `false` if the user
 * cancelled or no fallback was available.
 */
export async function shareContent(input: ShareInput): Promise<boolean> {
  if (isNative()) {
    const mod = await loadCapacitorModule<CapacitorShareModule>(
      '@capacitor/share',
    );
    if (mod) {
      try {
        await mod.Share.share({
          title: input.title,
          text: input.text,
          url: input.url,
          dialogTitle: input.title ?? 'Share',
        });
        return true;
      } catch {
        return false;
      }
    }
  }
  type ShareNav = Navigator & {
    share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    clipboard?: { writeText(text: string): Promise<void> };
  };
  const nav: ShareNav | undefined =
    typeof navigator !== 'undefined' ? (navigator as unknown as ShareNav) : undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({
        title: input.title,
        text: input.text,
        url: input.url,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (input.url && nav && nav.clipboard) {
    try {
      await nav.clipboard.writeText(input.url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

let booted = false;

/**
 * Boot the native shell — registers for push, wires the back button.
 * Idempotent and a no-op outside a Capacitor WebView.
 */
export async function bootNativeShell(): Promise<void> {
  if (booted) return;
  booted = true;
  if (!isNative()) return;
  try {
    // The full bridge lives in `@vtorn/native` (apps/native). It's only
    // present on the device build; on web it's not even installed. We
    // dynamic-import via a string variable so Webpack's static analyser
    // doesn't try to resolve the path on the web build.
    const modPath = '@vtorn/native/src/native-bridge';
    const bridge = (await import(/* webpackIgnore: true */ modPath)) as {
      startNativeShell: (opts?: { pushBaseUrl?: string }) => Promise<void>;
    };
    await bridge.startNativeShell({});
  } catch (err) {
    // The bridge module isn't part of the web build; if its dynamic load
    // fails we just stay in plain-web mode. This shouldn't happen inside
    // the actual Capacitor shell because the shell is built with the
    // same package set.
    // eslint-disable-next-line no-console
    console.warn('[vtorn] native bridge unavailable', err);
  }
}
