"use client";

/**
 * MoleculeLayerLabels, left-edge layer guide for the v5 molecule pyramid.
 *
 * Static DOM overlay (no R3F, no per-frame re-renders). Renders the seven
 * pyramid-layer names aligned to the Y heights of each ring so a viewer
 * reading the picture for the first time knows what each tier represents.
 *
 *   CHAMPION       ← apex
 *   FINAL
 *   SEMIS
 *   QUARTERS
 *   ROUND OF 16
 *   ROUND OF 32
 *   GROUP STAGE    ← base
 *
 * Desktop: a vertical strip pinned to the left edge of the molecule canvas.
 *   `justify-content: space-between` distributes labels evenly between the
 *   top and bottom of the canvas, which matches how the default camera
 *   frames the pyramid (apex ~30% from top, base ~70% from top).
 *
 * Mobile (<=720px): collapses into a horizontal pill row of abbreviated
 *   labels above the canvas, so the vertical strip never competes with
 *   the molecule's own atom labels on a narrow screen.
 *
 * Accessibility:
 *   - The container has `role="img"` + a sentence-style `aria-label`
 *     describing the orientation. Individual labels are decorative.
 *   - No animations, `prefers-reduced-motion` is a no-op for this
 *     component.
 *
 * Reads the canonical Y values from `@/lib/molecule/layout` via the
 * public `LAYER_Y` export so this stays in lockstep with the 3D scene.
 */

import { LAYER_Y, type LayerStage } from "@/lib/molecule/layout";

/** Full-word label for the vertical strip (desktop). */
interface LayerLabelSpec {
  readonly stage: LayerStage;
  readonly full: string;
  readonly short: string;
}

/**
 * Ordered from apex → base so flex column rendering reads top-to-bottom
 * the same way the pyramid is viewed (champion on top, group at base).
 */
const LAYERS_TOP_TO_BOTTOM: readonly LayerLabelSpec[] = [
  { stage: "champion", full: "Champion", short: "Champ" },
  { stage: "f", full: "Final", short: "Final" },
  { stage: "sf", full: "Semis", short: "SF" },
  { stage: "qf", full: "Quarters", short: "QF" },
  { stage: "r16", full: "Round of 16", short: "R16" },
  { stage: "r32", full: "Round of 32", short: "R32" },
  { stage: "group", full: "Group Stage", short: "Group" },
];

const ARIA_LABEL =
  "Pyramid layer guide, group stage at the base, champion at the apex";

/**
 * Sanity assertion in dev: the order in LAYERS_TOP_TO_BOTTOM must match
 * the descending Y order in LAYER_Y. If anyone changes LAYER_Y without
 * updating this list (or vice versa) the labels would silently mis-align.
 */
if (process.env.NODE_ENV !== "production") {
  const ys = LAYERS_TOP_TO_BOTTOM.map((l) => LAYER_Y[l.stage]);
  for (let i = 1; i < ys.length; i++) {
    if (ys[i]! >= ys[i - 1]!) {
      // eslint-disable-next-line no-console
      console.warn(
        "[MoleculeLayerLabels] LAYERS_TOP_TO_BOTTOM is out of sync with LAYER_Y",
        ys,
      );
      break;
    }
  }
}

export function MoleculeLayerLabels(): JSX.Element {
  return (
    <>
      {/* Desktop, vertical strip pinned to the canvas's left edge. */}
      <div
        className="molecule-layer-labels"
        role="img"
        aria-label={ARIA_LABEL}
        data-testid="molecule-layer-labels-vertical"
      >
        <div className="molecule-layer-labels-divider" aria-hidden="true" />
        <ul className="molecule-layer-labels-list" aria-hidden="true">
          {LAYERS_TOP_TO_BOTTOM.map((spec) => (
            <li
              key={spec.stage}
              className="molecule-layer-labels-item"
              data-stage={spec.stage}
            >
              {spec.stage === "champion" ? (
                <span
                  className="molecule-layer-labels-dot"
                  aria-hidden="true"
                />
              ) : null}
              <span className="molecule-layer-labels-text">{spec.full}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Mobile, compact horizontal pill row above the canvas. */}
      <div
        className="molecule-layer-labels-mobile"
        role="img"
        aria-label={ARIA_LABEL}
        data-testid="molecule-layer-labels-mobile"
      >
        <ul className="molecule-layer-labels-mobile-list" aria-hidden="true">
          {LAYERS_TOP_TO_BOTTOM.map((spec) => (
            <li
              key={spec.stage}
              className="molecule-layer-labels-mobile-item"
              data-stage={spec.stage}
            >
              {abbreviate(spec.stage)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Mobile abbreviations per Tim's brief. */
function abbreviate(stage: LayerStage): string {
  switch (stage) {
    case "champion":
      return "CHAMP";
    case "f":
      return "FINAL";
    case "sf":
      return "SF";
    case "qf":
      return "QF";
    case "r16":
      return "R16";
    case "r32":
      return "R32";
    case "group":
      return "GROUP";
  }
}
