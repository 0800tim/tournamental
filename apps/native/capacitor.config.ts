/**
 * Capacitor 6 configuration for the Tournamental native shell.
 *
 * The shell is a thin native wrapper around the production `apps/web`
 * deployment. We do **not** ship a separate native UI; the web app is
 * the single source of truth for screens. The `server.url` field tells
 * the WebView to load that remote URL on app start.
 *
 * Per-build-target overrides via env:
 *   VTORN_WEB_URL              — full URL the WebView loads on launch.
 *                                 default: https://tournamental.com
 *                                 stage:   https://play.tournamental.com
 *                                 dev:     http://10.0.2.2:3300 (Android emu)
 *                                          http://localhost:3300 (iOS sim)
 *   VTORN_ANDROID_CLEARTEXT    — "true" to allow http:// (dev only).
 *
 * The bundled webDir (`./www`) holds a tiny offline shell — a static
 * splash + "open the app" message — only used if `server.url` is left
 * unset (e.g. for fully offline app-store review builds).
 */

import type { CapacitorConfig } from '@capacitor/cli';

const webUrl = process.env.VTORN_WEB_URL ?? 'https://tournamental.com';
const cleartext =
  process.env.VTORN_ANDROID_CLEARTEXT === 'true' || webUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.tournamental.app',
  appName: 'Tournamental',
  webDir: 'www',
  server: {
    // Loading the remote site rather than a bundled SPA. Capacitor's bridge
    // is still injected so plugin calls work from the live web app.
    url: webUrl,
    cleartext,
    // Allow the WebView to navigate inside tournamental.com and our staging host
    // without bouncing back to the system browser.
    allowNavigation: [
      'tournamental.com',
      '*.tournamental.com',
      'localhost',
    ],
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#0c1722',
  },
  android: {
    backgroundColor: '#0c1722',
    allowMixedContent: cleartext,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0c1722',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    PushNotifications: {
      // 'badge' requires the user-permission grant flow we run on first
      // launch. 'sound' + 'alert' are the standard set.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
