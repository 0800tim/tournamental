/**
 * Native bridge — the small surface the wrapped web app talks to when it
 * detects it's running inside the Capacitor shell.
 *
 * The web app stays the source of truth for every screen. When it boots, it
 * dynamically imports this module **only on native** (gated by
 * `Capacitor.isNativePlatform()`). On the web, the same calls fall back to
 * `navigator.vibrate` / `navigator.share` etc. via the helpers in
 * `apps/web/lib/native.ts`.
 *
 * Wired:
 *   • Push notifications: APNs / FCM register → POST to push-notifications
 *     `/v1/subscribe/native`. Incoming notifications surface via the
 *     `pushNotificationReceived` listener; we don't display anything custom
 *     because Capacitor's runtime already shows the OS banner.
 *   • Haptics: `Haptics.impact()` shim.
 *   • Share: `Share.share()` shim with sensible fallbacks.
 *   • Preferences: tiny KV used to persist the `vtorn:userId` so the
 *     subscription endpoint always gets the same user across launches.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
} from '@capacitor/push-notifications';
import { Share } from '@capacitor/share';

const PUSH_BASE_URL =
  // Set at build time via the @capacitor/preferences key 'vtorn:pushBaseUrl'
  // or fallback to the stable production URL. We don't read process.env at
  // runtime because that's not present in the WebView.
  'https://push.tournamental.com';

const USER_ID_KEY = 'vtorn:userId';

export interface NativeStartOptions {
  /** Override the push-notifications base URL (default prod). */
  pushBaseUrl?: string;
  /** A logger; defaults to console. */
  log?: (msg: string, extra?: unknown) => void;
}

function defaultLog(msg: string, extra?: unknown): void {
  // Capacitor pipes console.log through to the native logs (Xcode / logcat)
  // so this gives us a single ergonomic place to debug native flows.
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[vtorn-native] ${msg}`, extra);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[vtorn-native] ${msg}`);
  }
}

/** Get-or-create a stable opaque user id. Persisted in @capacitor/preferences. */
export async function getUserId(): Promise<string> {
  const existing = await Preferences.get({ key: USER_ID_KEY });
  if (existing.value) return existing.value;
  const id = `nat_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await Preferences.set({ key: USER_ID_KEY, value: id });
  return id;
}

/**
 * POST `{ userId, consent, platform, token }` to the push-notifications
 * service. Returns true on a 2xx, false otherwise — never throws so app
 * launch is never blocked by a transient network blip.
 */
export async function registerNativePushToken(
  baseUrl: string,
  userId: string,
  platform: 'ios' | 'android',
  token: string,
  log: (msg: string, extra?: unknown) => void = defaultLog,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/subscribe/native`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, consent: true, platform, token }),
    });
    if (!res.ok) {
      log(`registerNativePushToken: ${res.status} ${res.statusText}`);
      return false;
    }
    log(`registerNativePushToken: registered (${platform})`);
    return true;
  } catch (err) {
    log('registerNativePushToken: network error', err);
    return false;
  }
}

/**
 * Initialise native push: ask the user, register with the OS, post the
 * token to the push-notifications service. Idempotent — Capacitor itself
 * filters duplicate `registration` events per launch.
 */
export async function initPushNotifications(
  opts: NativeStartOptions = {},
): Promise<void> {
  const log = opts.log ?? defaultLog;
  if (!Capacitor.isNativePlatform()) {
    log('not on native; skipping push registration');
    return;
  }

  const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
  if (platform !== 'ios' && platform !== 'android') {
    log(`unsupported platform: ${platform}`);
    return;
  }

  const baseUrl = opts.pushBaseUrl ?? PUSH_BASE_URL;
  const userId = await getUserId();

  // Wire the registration listener BEFORE asking for permission so we never
  // miss the token event on slow devices.
  await PushNotifications.addListener('registration', (t: Token) => {
    void registerNativePushToken(baseUrl, userId, platform, t.value, log);
  });

  await PushNotifications.addListener('registrationError', (err) => {
    log('push registrationError', err);
  });

  await PushNotifications.addListener(
    'pushNotificationReceived',
    (n: PushNotificationSchema) => {
      // Capacitor's runtime renders the OS banner for foreground pushes
      // when `presentationOptions: ['alert']` is set in capacitor.config.ts,
      // so we just log here. If we later want a custom in-app toast the
      // hook is to import the local-notifications plugin and re-emit.
      log('pushNotificationReceived', { title: n.title, body: n.body });
    },
  );

  await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    log('pushNotificationActionPerformed', { actionId: a.actionId });
  });

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    log(`push permission: ${perm.receive} — registration skipped`);
    return;
  }

  await PushNotifications.register();
}

/**
 * Cross-platform haptic-tap shim. On native, uses `Haptics.impact()` at
 * the `Light` style for pick-feedback. On web, falls back to
 * `navigator.vibrate(10)` if available, otherwise a no-op.
 *
 * Style mapping: 'light' → ImpactStyle.Light, 'medium' → ImpactStyle.Medium,
 * 'heavy' → ImpactStyle.Heavy.
 */
export async function tapFeedback(
  style: 'light' | 'medium' | 'heavy' = 'light',
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const map: Record<typeof style, ImpactStyle> = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    };
    try {
      await Haptics.impact({ style: map[style] });
    } catch {
      // Some Android devices report the plugin as available but throw when
      // the haptics actuator is missing. Swallow rather than break the UI.
    }
    return;
  }
  const nav: (Navigator & { vibrate?: (p: number | number[]) => boolean }) | undefined =
    typeof navigator !== 'undefined' ? (navigator as unknown as Navigator & { vibrate?: (p: number | number[]) => boolean }) : undefined;
  if (nav && typeof nav.vibrate === 'function') {
    const ms = style === 'heavy' ? 30 : style === 'medium' ? 15 : 10;
    nav.vibrate(ms);
  }
}

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
  /** Used as the iOS share-sheet "subject" when the dialog is for email. */
  dialogTitle?: string;
}

/**
 * Cross-platform share. On native, uses Capacitor's Share plugin which
 * presents the OS share-sheet. On web, uses the Web Share API where
 * available, and falls back to copying the URL to the clipboard.
 *
 * Returns `true` if the share went through (or the URL was at least
 * copied), `false` if the user dismissed.
 */
export async function shareContent(input: ShareInput): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({
        title: input.title,
        text: input.text,
        url: input.url,
        dialogTitle: input.dialogTitle ?? 'Share',
      });
      return true;
    } catch {
      // User cancelled the sheet — Capacitor throws in that case.
      return false;
    }
  }
  // Web Share API (mobile Safari + Chrome on Android).
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
  // Fallback: copy the URL to clipboard so something useful happens.
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

/**
 * Top-level entrypoint. Call from the web app's `<RootLayout>` on mount,
 * gated by `Capacitor.isNativePlatform()`. Idempotent.
 */
export async function startNativeShell(opts: NativeStartOptions = {}): Promise<void> {
  const log = opts.log ?? defaultLog;
  log(`startNativeShell: platform=${Capacitor.getPlatform()}`);

  await initPushNotifications(opts);

  // Wire the back button on Android to honour browser history first; only
  // exit the app when there's nowhere left to go.
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}

// Re-export the underlying plugins for advanced consumers (e.g. a feature
// flag panel that wants to toggle haptics directly).
export { Capacitor, Haptics, ImpactStyle, PushNotifications, Share, Preferences, App };
