/**
 * Overlay system public surface. Consumers should import from here
 * rather than the underlying files so the implementation can refactor
 * freely.
 */

export { OverlayProvider, useOverlay, useOptionalOverlay } from "./OverlayProvider";
export { OverlayRoot } from "./OverlayRoot";
export { OverlayLink } from "./OverlayLink";
export { OverlayServerShim } from "./OverlayServerShim";
export { OverlayBreadcrumb } from "./OverlayBreadcrumb";
export { Sheet } from "./Sheet";
export { encodeOverlayUrl, parseOverlayUrl, stacksEqual } from "./url";
export type { OverlayApi, OverlayFrame, OverlayKind } from "./types";
