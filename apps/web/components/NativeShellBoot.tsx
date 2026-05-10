/**
 * Boots the Capacitor native shell on mount. No-op outside a native
 * WebView. Renders nothing.
 *
 * Lives at the root layout so push registration + Android back-button
 * wiring happens once per app launch, not once per route navigation.
 */

"use client";

import { useEffect } from "react";

import { bootNativeShell } from "@/lib/native";

export function NativeShellBoot(): null {
  useEffect(() => {
    void bootNativeShell();
  }, []);
  return null;
}
