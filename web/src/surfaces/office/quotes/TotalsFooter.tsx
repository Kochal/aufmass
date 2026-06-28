/**
 * TotalsFooter — displays engine-computed Angebot totals and the issue gate.
 *
 * The frontend NEVER computes money values (directive 00/10). This component
 * only displays what the backend committed after /berechnen. The values are
 * always labelled with their source (the pricing rule and the berechnen action)
 * so the reviewer can see where each figure comes from.
 *
 * The three action buttons follow the mandatory ordering:
 *   berechnen → prüfen → ausstellen
 *
 * If there are unresolved hard-fail check_results, ausstellen is disabled with
 * a clear explanation — the gate is the backend's guard, but we surface it here
 * so the reviewer doesn't have to discover it on rejection.
 */
import type { components } from "@/api/schema";
import { formatEuro } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Calculator, CheckCheck, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type AngebotRead = components["schemas"]["AngebotRead"];
type CheckResultRead = components["schemas"]["CheckResultRead"];

interface Props {
  angebot: AngebotRead;
  angebotChecks: CheckResultRead[];
  onBerechnen: () => void;
  onPruefen: () => void;
  onAusstellen: () => void;
  berechnenPending: boolean;
  pruefenPending: boolean;
  ausstellenPending: boolean;
}

export function TotalsFooter({
  angebot,
  angebotChecks,
  onBerechnen,
  onPruefen,
  onAusstellen,
  berechnenPending,
  pruefenPending,
  ausstellenPending,
}: Props) {
  const isDraft = angebot.status === "draft";
  const isIssued = angebot.status === "issued";

  // Hard failures on the angebot itself block ausstellen
  const hardFails = angebotChecks.filter(
    (c) => !c.resolved && !c.passed && c.severity === "error",
  );
  const canAusstellen = isDraft && hardFails.length === 0;

  return (
    <div className="border-t border-border bg-card">
      {/* Totals row */}
      <div className="flex items-center gap-6 px-6 py-3 text-sm">
        <div className="flex-1 flex items-center gap-4 flex-wrap">
          <TotalLine label="Summe netto" value={angebot.summe_netto} />
          {angebot.nachlass_betrag && (
            <TotalLine
              label="Nachlass"
              value={angebot.nachlass_betrag}
              negative
            />
          )}
          {angebot.zuschlag_betrag && (
            <TotalLine label="Zuschlag" value={angebot.zuschlag_betrag} />
          )}
          <Separator orientation="vertical" className="h-5" />
          <TotalLine
            label="Gesamtbetrag brutto"
            value={angebot.summe_brutto}
            large
          />
        </div>

        {/* Status badge */}
        <div>
          <StatusBadge status={angebot.status} />
        </div>
      </div>

      {/* Hard-fail notice */}
      {hardFails.length > 0 && (
        <div className="px-6 pb-2 flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {hardFails.length} blockierende{hardFails.length > 1 ? " Prüfungen" : " Prüfung"}{" "}
            — Ausstellen nicht möglich bis sie behoben sind.
          </span>
        </div>
      )}

      {/* Action buttons */}
      {!isIssued && (
        <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onBerechnen}
            disabled={!isDraft || berechnenPending}
          >
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
            {berechnenPending ? "Berechne …" : "Berechnen"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onPruefen}
            disabled={!isDraft || pruefenPending}
          >
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
            {pruefenPending ? "Prüfe …" : "Prüfen"}
          </Button>
          <Button
            size="sm"
            onClick={onAusstellen}
            disabled={!canAusstellen || ausstellenPending}
            title={
              !canAusstellen
                ? "Alle blockierenden Prüfungen müssen behoben sein."
                : undefined
            }
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {ausstellenPending ? "Stellt aus …" : "Ausstellen"}
          </Button>

          {/* Provenance note */}
          <span className="text-xs text-muted-foreground ml-1">
            Reihenfolge: Berechnen → Prüfen → Ausstellen
          </span>
        </div>
      )}
    </div>
  );
}

function TotalLine({
  label,
  value,
  negative = false,
  large = false,
}: {
  label: string;
  value: string | null | undefined;
  negative?: boolean;
  large?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono",
          large ? "text-base font-semibold" : "text-sm",
          negative && "text-confidence-low",
        )}
      >
        {negative && value ? `–${formatEuro(value)}` : formatEuro(value)}
      </p>
    </div>
  );
}

const STATUS_MAP: Record<
  string,
  { label: string; className: string }
> = {
  draft: { label: "Entwurf", className: "bg-muted text-muted-foreground" },
  issued: { label: "Ausgestellt", className: "bg-confidence-high-bg text-confidence-high-fg" },
  awarded: { label: "Beauftragt", className: "bg-primary text-primary-foreground" },
  voided: { label: "Storniert", className: "bg-destructive/10 text-destructive" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full",
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}
