/**
 * Shared test helpers — `walk` traverses the satori JSON tree so tests
 * can assert a) particular text content appears, and b) particular style
 * properties are present.
 */

import type { SatoriElement } from "../src/jsdl.js";

type Node = SatoriElement | string | number | null | undefined | Node[];

export function walkText(node: Node): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(walkText).join(" ");
  // SatoriElement
  const kids = (node as SatoriElement).props?.children as Node;
  return walkText(kids ?? null);
}

export function walkAll(node: Node, visitor: (n: SatoriElement) => void): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    for (const c of node) walkAll(c, visitor);
    return;
  }
  visitor(node as SatoriElement);
  walkAll((node as SatoriElement).props?.children as Node, visitor);
}

export function findStyles(
  root: SatoriElement,
  predicate: (style: Record<string, unknown>) => boolean,
): SatoriElement[] {
  const out: SatoriElement[] = [];
  walkAll(root, (n) => {
    const style = (n.props?.style ?? {}) as Record<string, unknown>;
    if (predicate(style)) out.push(n);
  });
  return out;
}

export function containsText(root: SatoriElement, needle: string): boolean {
  return walkText(root).includes(needle);
}
