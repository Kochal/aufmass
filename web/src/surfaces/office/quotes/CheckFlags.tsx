/**
 * CheckFlags — renders unresolved sense-check results for a position.
 *
 * Hard failures (severity='error', passed=false) block the Ausstellen gate
 * and are shown with a red destructive style. Soft failures (severity='warning')
 * route the position to review and are shown in amber. Resolved flags are
 * omitted — they are done.
 *
 * The onResolve callback fires the PATCH /api/check-result/{id}/resolve action
 * so the reviewer can clear soft flags inline.
 */
import type { components } from "@/api/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

type CheckResultRead = components["schemas"]["CheckResultRead"];

interface Props {
  checks: CheckResultRead[];
  onResolve?: (check: CheckResultRead) => void;
  resolving?: string | null; // check id being resolved
}

export function CheckFlags({ checks, onResolve, resolving }: Props) {
  const active = checks.filter((c) => !c.resolved && !c.passed);
  if (active.length === 0) return null;

  const errors = active.filter((c) => c.severity === "error");
  const warnings = active.filter((c) => c.severity !== "error");

  return (
    <div className="space-y-1.5 mt-2">
      {errors.map((c) => (
        <div
          key={c.id}
          className="flex items-start gap-2 rounded-md bg-destructive/8 border border-destructive/20 px-2.5 py-1.5 text-xs"
        >
          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-destructive">
              {humaniseRule(c.rule)}
            </span>
            {c.detail != null && (
              <span className="text-muted-foreground ml-1">
                — {String(c.detail)}
              </span>
            )}
          </div>
          <Badge variant="destructive" className="text-[10px] px-1 shrink-0">
            blockierend
          </Badge>
        </div>
      ))}

      {warnings.map((c) => (
        <div
          key={c.id}
          className="flex items-start gap-2 rounded-md bg-confidence-mid-bg border border-confidence-mid/30 px-2.5 py-1.5 text-xs"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-confidence-mid shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-confidence-mid-fg">
              {humaniseRule(c.rule)}
            </span>
            {c.detail != null && (
              <span className="text-muted-foreground ml-1">
                — {String(c.detail)}
              </span>
            )}
          </div>
          {onResolve && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] shrink-0"
              disabled={resolving === c.id}
              onClick={() => onResolve(c)}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Quittieren
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Convert an internal rule identifier to German trade vocabulary. */
function humaniseRule(rule: string): string {
  const map: Record<string, string> = {
    arithmetic_integrity: "Rechnerische Integrität",
    unit_consistency: "Einheit stimmt nicht",
    price_out_of_band: "Preis außerhalb Erfahrungsbereich",
    zero_guard: "Nullpreis oder Nullmenge",
    completeness: "Pflichtfelder fehlen",
    gaeb_round_trip: "GAEB-Abgleich fehlgeschlagen",
    absurd_price: "Preis unplausibel",
  };
  return map[rule] ?? rule.replaceAll("_", " ");
}
