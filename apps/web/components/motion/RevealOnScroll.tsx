/*
 * Copyright 2026 Tournamental
 *
 * Licensed under the Apache Licence, Version 2.0 (the "Licence");
 * you may not use this file except in compliance with the Licence.
 * You may obtain a copy of the Licence at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * RevealOnScroll, thin client wrapper that lets server components reach
 * the shared `useRevealOnScroll` motion hook.
 *
 * The play app's pages are mostly server components (the share landing,
 * the syndicate manage screens). They can't call hooks directly, so this
 * tiny `"use client"` shim owns the ref and renders its children inside
 * the container. Use it whenever a server page needs the "fade-and-rise
 * on scroll into view" choreography.
 *
 * The wrapper renders a `<div>` by default; callers that need a
 * different element (e.g. a `<section>` to preserve landmark semantics)
 * pass `as="section"`. The wrapper accepts a className so callers can
 * keep their existing layout styles.
 */

"use client";

import type { ElementType, PropsWithChildren, ReactNode } from "react";
import type { CSSProperties } from "react";

import {
  useRevealOnScroll,
  type RevealOnScrollOptions,
} from "@/lib/motion/use-reveal-on-scroll";

export interface RevealOnScrollProps extends RevealOnScrollOptions {
  /** Optional override element. Defaults to `<div>`. */
  readonly as?: Extract<ElementType, "div" | "section" | "ul" | "ol" | "aside">;
  readonly className?: string;
  readonly id?: string;
  readonly style?: CSSProperties;
  /** Forwards through to the wrapping element for landmark labelling. */
  readonly "aria-label"?: string;
  /** Forwards through to the wrapping element for landmark labelling. */
  readonly "aria-labelledby"?: string;
  /** Optional data-testid for hookable selectors in tests. */
  readonly "data-testid"?: string;
  readonly children: ReactNode;
}

export function RevealOnScroll(props: PropsWithChildren<RevealOnScrollProps>) {
  const {
    as = "div",
    className,
    id,
    style,
    children,
    distance,
    duration,
    stagger,
    selector,
    start,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "data-testid": dataTestId,
  } = props;
  const ref = useRevealOnScroll<HTMLElement>({
    distance,
    duration,
    stagger,
    selector,
    start,
  });
  const Tag = as;
  // The cast is fine: every supported tag accepts a ref<HTMLElement>.
  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={className}
      id={id}
      style={style}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      data-testid={dataTestId}
    >
      {children}
    </Tag>
  );
}
