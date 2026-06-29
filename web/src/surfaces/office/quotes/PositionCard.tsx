/**
 * PositionCard — one LV position in the two-pane review layout.
 *
 * The layout is the whole UX bet: source (LV position) on the left, match
 * (catalog item + price) on the right. The confidence band is a coloured
 * left-border strip that tells the reviewer at a glance where attention is
 * needed, without a number to decode.
 *
 * Trust is made visible:
 *   • The price shows its pricing_rule (how it was computed)
 *   • The source shows its origin (GAEB vs PDF)
 *   • Check flags appear where they apply, not in a separate list
 *   • "Annehmen" is the primary action; "Korrigieren" opens the catalog picker
 *
 * Nothing on this card computes a money value (directive 00/10). All figures
 * come from the API; they are displayed and confirmed, never re-derived here.
 */
import { useRef, useEffect } from "react";
import type { components } from "@/api/schema";
import { formatEuro, formatMenge, confidenceTier } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ConfidenceBand } from "./ConfidenceBand";
import { CheckFlags } from "./CheckFlags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCheck, Pencil } from "lucide-react";

type LvPositionRead = components["schemas"]["LvPositionRead"];
type LeistungRead = components["schemas"]["LeistungRead"];
type CheckResultRead = components["schemas"]["CheckResultRead"];

interface Props {
  position: LvPositionRead;
  leistungMap: Map<string, LeistungRead>;
  checks: CheckResultRead[];
  isActive: boolean;
  onAccept: () => void;
  onOpenPicker: () => void;
  onEdit: () => void;
  onResolveFlag: (check: CheckResultRead) => void;
  resolvingFlagId: string | null;
  accepting: boolean;
}

export function PositionCard({
  position,
  leistungMap,
  checks,
  isActive,
  onAccept,
  onOpenPicker,
  onEdit,
  onResolveFlag,
  resolvingFlagId,
  accepting,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = confidenceTier(position.match_confidence, position.match_status);
  const matchedLeistung = position.matched_leistung_id
    ? leistungMap.get(position.matched_leistung_id)
    : undefined;
  const isConfirmed = position.match_status === "confirmed";
  const isUnmatched = !position.matched_leistung_id;

  // Scroll active card into view when keyboard navigates to it
  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  return (
    <div
      ref={ref}
      className={cn(
        "flex rounded-lg border overflow-hidden transition-shadow",
        isActive
          ? "border-ring shadow-md ring-1 ring-ring/20"
          : "border-border hover:border-muted-foreground/30",
        isConfirmed && "opacity-70",
      )}
      onClick={() => {
        /* focus without scrolling — just activate */
      }}
    >
      {/* Confidence band */}
      <ConfidenceBand tier={tier} className="self-stretch" />

      {/* Two panes */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-border min-w-0">
        {/* ── LEFT: LV source ── */}
        <div className="p-3 min-w-0 space-y-1 group/left">
          {/* Header row: OZ + source badge + edit button */}
          <div className="flex items-center gap-2 flex-wrap">
            {position.oz && (
              <span className="font-mono text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                {position.oz}
              </span>
            )}
            {position.position_nr != null && (
              <span className="text-xs text-muted-foreground">
                #{position.position_nr}
              </span>
            )}
            {position.source && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {position.source === "gaeb" ? "GAEB" : position.source === "pdf" ? "PDF" : position.source}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto opacity-0 group-hover/left:opacity-100 transition-opacity shrink-0"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title="Position bearbeiten"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>

          {/* Kurztext */}
          {position.kurztext && (
            <p className="text-sm font-medium leading-snug line-clamp-2">
              {position.kurztext}
            </p>
          )}

          {/* Langtext (first line) */}
          {position.langtext && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {position.langtext}
            </p>
          )}

          {/* Menge × Einheit */}
          {position.menge && (
            <p className="text-xs text-foreground font-mono">
              {formatMenge(position.menge, position.einheit)}
            </p>
          )}
        </div>

        {/* ── RIGHT: Match ── */}
        <div className="p-3 min-w-0 space-y-1.5">
          {/* Match status badge + match_status label */}
          <div className="flex items-center gap-2">
            <MatchStatusBadge status={position.match_status} />
            {position.match_confidence && (
              <span className="text-xs text-muted-foreground font-mono">
                {(parseFloat(position.match_confidence) * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {isUnmatched ? (
            <p className="text-xs text-muted-foreground italic">
              Kein Katalogeintrag zugewiesen
            </p>
          ) : matchedLeistung ? (
            <div className="space-y-1">
              {/* Matched catalog item */}
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded shrink-0 mt-0.5">
                  {matchedLeistung.code}
                </span>
                <p className="text-sm leading-snug line-clamp-1">
                  {matchedLeistung.kurztext}
                </p>
              </div>

              {/* Price — shown only, never computed here */}
              {position.einheitspreis && (
                <div className="text-xs space-y-0.5">
                  <p className="font-mono">
                    {formatEuro(position.einheitspreis)}/{position.einheit ?? matchedLeistung.einheit}
                    {position.gesamtpreis && (
                      <span className="text-muted-foreground ml-2">
                        = {formatEuro(position.gesamtpreis)}
                      </span>
                    )}
                  </p>
                  {position.pricing_rule && (
                    <p className="text-muted-foreground text-[10px] font-mono">
                      Formel: {position.pricing_rule}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // matched_leistung_id set but not in our leistung map yet (loading)
            <p className="text-xs text-muted-foreground font-mono">
              {position.matched_leistung_id?.slice(0, 8)}…
            </p>
          )}

          {/* Check flags */}
          <CheckFlags
            checks={checks}
            onResolve={onResolveFlag}
            resolving={resolvingFlagId}
          />

          {/* Action row */}
          {!isConfirmed && (
            <div className="flex items-center gap-1.5 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={onAccept}
                disabled={accepting || isUnmatched}
                title={
                  isUnmatched
                    ? "Erst Leistung auswählen (Taste c)"
                    : "Annehmen (Taste a / Enter)"
                }
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                {accepting ? "…" : "Annehmen"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={onOpenPicker}
                title="Katalog öffnen (Taste c)"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Korrigieren
              </Button>
            </div>
          )}

          {isConfirmed && (
            <div className="flex items-center gap-1 text-xs text-confidence-high-fg pt-1">
              <CheckCheck className="h-3 w-3" />
              Bestätigt
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground ml-1"
                onClick={onOpenPicker}
              >
                Ändern
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; variant: string }> = {
    confirmed: { label: "Bestätigt", variant: "confidence-high" },
    auto: { label: "Automatisch", variant: "secondary" },
    review: { label: "Prüfen", variant: "confidence-mid" },
  };
  const c = cfg[status] ?? { label: status, variant: "outline" };
  return (
    <Badge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variant={c.variant as any}
      className="text-[10px] px-1.5 py-0 h-4"
    >
      {c.label}
    </Badge>
  );
}
