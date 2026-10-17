/**
 * Minimal intl-aware render for the accessibility tests. The suite-wide
 * helper lands with PR #344 (`__tests__/helpers/render`); until it
 * merges this file keeps these tests self-contained.
 */
import { render as rtlRender, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import en from "@/locales/en.json";

// The catalogue carries a `_meta` block with numbers, which the strict
// message type rejects; next-intl ignores unknown keys at runtime.
const messages = en as unknown as AbstractIntlMessages;

export * from "@testing-library/react";

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export function render(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  return rtlRender(ui, { ...options, wrapper: Wrapper });
}
