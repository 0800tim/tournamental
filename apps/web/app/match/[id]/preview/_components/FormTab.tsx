/**
 * Form tab — two RecentForm strips side-by-side (home left, away right),
 * each showing the team's last 5 W/D/L results.
 *
 * Reuses the existing `RecentForm` component from `/team/[code]` so the
 * visual treatment matches the team-detail page exactly.
 */

"use client";

import { TeamFlag } from "@/components/bracket/TeamFlag";

import type { FormGame } from "../../../../team/[code]/_lib/team-data";
import { RecentForm } from "../../../../team/[code]/_components/RecentForm";

export interface FormTabProps {
  readonly homeName: string;
  readonly awayName: string;
  readonly homeCode?: string;
  readonly awayCode?: string;
  readonly homeForm: readonly FormGame[];
  readonly awayForm: readonly FormGame[];
}

export function FormTab(props: FormTabProps) {
  const { homeName, awayName, homeCode, awayCode, homeForm, awayForm } = props;

  if (!homeCode || !awayCode) {
    return (
      <div className="mp-tab-content mp-form-empty">
        <p className="mp-empty-headline">
          Form data unavailable until both teams are confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="mp-tab-content mp-form">
      <div className="mp-form-side">
        <header className="mp-form-side-head">
          <TeamFlag
            code={homeCode}
            name={homeName}
            size="md"
            shape="circle"
            sparkle={false}
          />
          <span className="mp-form-side-name">{homeName}</span>
        </header>
        <RecentForm games={homeForm} />
      </div>
      <div className="mp-form-side">
        <header className="mp-form-side-head">
          <TeamFlag
            code={awayCode}
            name={awayName}
            size="md"
            shape="circle"
            sparkle={false}
          />
          <span className="mp-form-side-name">{awayName}</span>
        </header>
        <RecentForm games={awayForm} />
      </div>
    </div>
  );
}
