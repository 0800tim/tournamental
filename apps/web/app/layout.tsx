import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { NativeShellBoot } from "@/components/NativeShellBoot";

export const metadata: Metadata = {
  title: "VTourn — Live Match Renderer",
  description: "VTourn 3D match renderer (Next.js + React Three Fiber)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NativeShellBoot />
        {children}
      </body>
    </html>
  );
}
