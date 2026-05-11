"use client";

/**
 * MoleculeLegend, small, dismissable overlay explaining what the rings
 * + bond colours mean. Visible by default, can be collapsed by the user
 * so it gets out of the way on small screens.
 */

import { useState } from "react";

import { PALETTE } from "@/lib/molecule/layout";

export function MoleculeLegend() {
  const [open, setOpen] = useState(true);
  return (
    <div className="molecule-legend" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="molecule-legend-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="molecule-legend-body"
      >
        Legend {open ? "▾" : "▴"}
      </button>
      {open ? (
        <ul id="molecule-legend-body" className="molecule-legend-list" aria-label="Molecule legend">
          <li><Swatch hex={PALETTE.champion} /> Champion</li>
          <li><Swatch hex={PALETTE.runner_up} /> Runner-up</li>
          <li><Swatch hex={PALETTE.third_place} /> 3rd place</li>
          <li><Swatch hex={PALETTE.qf} /> Out in QF</li>
          <li><Swatch hex={PALETTE.r16} /> Out in R16</li>
          <li><Swatch hex={PALETTE.r32} /> Out in R32</li>
          <li><Swatch hex={PALETTE.group} /> Out in group stage</li>
        </ul>
      ) : null}
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      className="molecule-legend-swatch"
      style={{ background: hex }}
      aria-hidden
    />
  );
}
