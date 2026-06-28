/**
 * ConfidenceBand — the visual trust indicator for a review card.
 *
 * A coloured strip (rendered as a left border) conveys confidence tier
 * at a glance without a number to decode. The reviewer's eye goes straight
 * to where it's needed. Three tiers:
 *
 *   high  ≥ 0.85, or match_status='confirmed' → green (confidence-high)
 *   mid   0.60 – 0.84                         → amber (confidence-mid)
 *   low   < 0.60, unmatched, or no score      → red   (confidence-low)
 *
 * The tokens are defined in src/index.css so both this screen and the
 * future Aufmaß crop-verify screen use the same visual language.
 */
import { cn } from "@/lib/utils";
import { type ConfidenceTier } from "@/lib/utils";

interface Props {
  tier: ConfidenceTier;
  className?: string;
}

const tierClass: Record<ConfidenceTier, string> = {
  high: "bg-confidence-high",
  mid: "bg-confidence-mid",
  low: "bg-confidence-low",
};

export function ConfidenceBand({ tier, className }: Props) {
  return (
    <div
      aria-hidden="true"
      title={
        tier === "high"
          ? "Hohe Übereinstimmung"
          : tier === "mid"
            ? "Mittlere Übereinstimmung – prüfen"
            : "Niedrige Übereinstimmung – Aktion erforderlich"
      }
      className={cn(
        "w-1.5 shrink-0 rounded-l-lg",
        tierClass[tier],
        className,
      )}
    />
  );
}
