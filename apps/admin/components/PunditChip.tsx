/**
 * Customer-360 chip for the Verified-Pundit signal (foundation for the
 * future contributor revenue-share — docs/19). Subtle gold tick + level
 * count, hidden when the user is un-verified.
 *
 * Aligned visually with HumannessChip but uses gold to signal the
 * brand-trust meaning ("this user has won at the prediction game", not
 * "this user has passed humanness checks").
 */

export interface PunditChipProps {
  status: {
    verified: boolean;
    levels: number;
    sinceDate: string | null;
    tournaments: ReadonlyArray<string>;
  } | null;
}

export function PunditChip({ status }: PunditChipProps) {
  if (!status || !status.verified) return null;

  const since = status.sinceDate
    ? new Date(status.sinceDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      })
    : "earlier this season";
  const tip = `Verified Pundit — top 100 in ${status.levels} tournament${
    status.levels === 1 ? "" : "s"
  } since ${since}`;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-flame-500/15 px-2 py-0.5 text-xs text-flame-500"
      aria-label={tip}
      title={tip}
      data-testid="pundit-chip"
      data-pundit-levels={status.levels}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="6" cy="6" r="5" fill="#f1c84b" stroke="#c9a21f" />
        <path
          d="M3.6 6.2 L5.4 8 L8.4 4.4"
          fill="none"
          stroke="#1f1604"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-semibold uppercase tracking-wider">Pundit</span>
      <span className="opacity-70 font-mono">×{status.levels}</span>
    </span>
  );
}
