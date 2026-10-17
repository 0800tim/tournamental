/**
 * Shared render helpers for component tests.
 *
 * Every client component under `components/` and `app/` can call
 * next-intl's `useTranslations` or `useLocale`, which throw without a
 * `NextIntlClientProvider` above them. The app's root layout supplies
 * that provider in production; this module supplies it in tests so a
 * test file can import `render` from here instead of
 * `@testing-library/react` and keep everything else the same.
 *
 * - `render(ui, options)`: identical to Testing Library's render, with
 *   the English catalogue mounted. A caller-supplied `wrapper` still
 *   applies, inside the provider.
 * - `renderAsync(<Page {...props} />)`: for async server components
 *   (`export default async function Page()`), which React cannot
 *   render as a child. The element's function is awaited first and the
 *   resolved tree is rendered through the same provider. A `notFound()`
 *   or any other throw rejects the returned promise, so
 *   `await expect(renderAsync(...)).rejects.toThrow(...)` works.
 *
 * Everything else from `@testing-library/react` (screen, fireEvent,
 * waitFor, within, act, cleanup, ...) is re-exported unchanged.
 */
import {
  render as rtlRender,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ComponentType, ReactElement, ReactNode } from "react";

import en from "@/locales/en.json";

// The catalogue carries a `_meta` block with numbers, which the strict
// message type rejects; next-intl ignores unknown keys at runtime.
const messages = en as unknown as AbstractIntlMessages;

export * from "@testing-library/react";

const TEST_LOCALE = "en";

function IntlWrapper({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider locale={TEST_LOCALE} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function composeWrapper(inner?: ComponentType<{ children: ReactNode }>) {
  if (!inner) return IntlWrapper;
  const Inner = inner;
  return function ComposedWrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <IntlWrapper>
        <Inner>{children}</Inner>
      </IntlWrapper>
    );
  };
}

export function render(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  return rtlRender(ui, { ...options, wrapper: composeWrapper(options.wrapper as ComponentType<{ children: ReactNode }> | undefined) });
}

export async function renderAsync(
  element: ReactElement,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const component = element.type as (props: unknown) => Promise<ReactElement> | ReactElement;
  const resolved = await component(element.props);
  return render(resolved, options);
}
