/**
 * Minimal JSX-like node builder for satori.
 *
 * Satori accepts React-style elements *or* a JSON shape: `{ type, props }`.
 * We use the JSON shape so the package has no React dependency at all and
 * is safely usable from build scripts, edge runtimes, and Fastify.
 *
 * This is the canonical, stable internal API. Card builders only use:
 *  - `el(type, props, ...children)` — element builder.
 *  - `text(string)`                  — text leaf.
 */

export type SatoriProps = Record<string, unknown> & {
  style?: Record<string, unknown>;
  children?: unknown;
};

export interface SatoriElement {
  type: string;
  props: SatoriProps;
}

/** Build a satori-compatible element. */
export function el(
  type: string,
  props: Omit<SatoriProps, "children"> = {},
  ...children: Array<SatoriElement | string | number | null | undefined | false>
): SatoriElement {
  const filtered = children.filter(
    (c) => c !== null && c !== undefined && c !== false,
  ) as Array<SatoriElement | string | number>;

  // Satori expects either a single child or an array.
  let kids: unknown;
  if (filtered.length === 0) kids = undefined;
  else if (filtered.length === 1) kids = filtered[0];
  else kids = filtered;

  return {
    type,
    props: { ...props, children: kids } as SatoriProps,
  };
}

/** Convenience for plain text leaves. */
export function text(value: string | number): string {
  return String(value);
}

/** Common style fragments shared across card kinds. */
export const styles = {
  /** Full-card flex container, used as the root element of every card. */
  root(width: number, height: number, background: string): Record<string, unknown> {
    return {
      width,
      height,
      display: "flex",
      flexDirection: "column",
      background,
      color: "#fff",
      fontFamily: "Inter",
      padding: 0,
      position: "relative",
    };
  },

  /** Centred body region. */
  body(): Record<string, unknown> {
    return {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      padding: "64px 72px",
      justifyContent: "center",
    };
  },

  footer(): Record<string, unknown> {
    return {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "28px 72px",
      borderTop: "1px solid #1a2238",
      fontSize: 22,
      color: "#cdd5e7",
    };
  },

  pill(bg: string, fg: string): Record<string, unknown> {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 14px",
      background: bg,
      color: fg,
      borderRadius: 999,
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    };
  },
};
