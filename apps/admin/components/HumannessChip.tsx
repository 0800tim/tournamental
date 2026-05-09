/**
 * Visual chip for the Humanness score (see docs/20). Bands:
 *   <20  red     ("low")
 *   20-49 amber  ("uncertain")
 *   50-79 sky   ("likely human")
 *   >=80 green  ("high-confidence human")
 *
 * Bots are explicit — when `bot` is true we show a neutral `BOT` chip
 * regardless of the score. See docs/20 §"Bots are first-class citizens".
 */

export interface HumannessChipProps {
  score: number;
  bot?: boolean;
}

export function HumannessChip({ score, bot }: HumannessChipProps) {
  if (bot) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-ink-700 px-2 py-0.5 text-xs text-ink-200"
        aria-label="Self-declared bot account"
      >
        BOT
      </span>
    );
  }

  let tone: string;
  let label: string;
  if (score < 20) {
    tone = "bg-danger-500/20 text-danger-500";
    label = "low";
  } else if (score < 50) {
    tone = "bg-flame-500/20 text-flame-500";
    label = "uncertain";
  } else if (score < 80) {
    tone = "bg-accent-500/20 text-accent-400";
    label = "likely";
  } else {
    tone = "bg-emerald-500/20 text-emerald-500";
    label = "verified";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${tone}`}
      aria-label={`Humanness score ${score} (${label})`}
      title={`Humanness ${score} — ${label}`}
    >
      <span className="font-mono">{score}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}
