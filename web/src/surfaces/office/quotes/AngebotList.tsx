/**
 * AngebotList — office entry point for the quotation surface.
 *
 * Shows all Angebote for the tenant, sorted newest first. Each row links to
 * the matching review screen. The status column uses the same confidence-tier
 * colour language: draft is neutral, issued is green, etc.
 *
 * Scope: Büro / Admin / Buchhaltung roles (enforced by the nav filter in
 * AppShell). Buchhaltung sees issued invoices; Büro sees everything.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient, unwrap } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText } from "lucide-react";
import type { components } from "@/api/schema";

type AngebotRead = components["schemas"]["AngebotRead"];

const STATUS_CFG: Record<string, { label: string; variant: string }> = {
  draft: { label: "Entwurf", variant: "secondary" },
  issued: { label: "Ausgestellt", variant: "confidence-high" },
  awarded: { label: "Beauftragt", variant: "default" },
  voided: { label: "Storniert", variant: "destructive" },
};

function statusBadge(status: string) {
  const cfg = STATUS_CFG[status] ?? { label: status, variant: "outline" };
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Badge variant={cfg.variant as any} className="text-xs">
      {cfg.label}
    </Badge>
  );
}

export function AngebotList() {
  const { data: angebote, isLoading, error } = useQuery({
    queryKey: ["angebot"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/angebot", {});
      return unwrap(res);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          Fehler beim Laden der Angebote:{" "}
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  const sorted = [...(angebote ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Angebote</h1>
          {angebote && (
            <span className="text-sm text-muted-foreground">
              ({angebote.length})
            </span>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="border rounded-lg p-12 text-center space-y-2">
          <p className="text-muted-foreground text-sm">Noch keine Angebote.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Angebotsnummer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => (
                <AngebotRow key={a.id} angebot={a} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function AngebotRow({ angebot }: { angebot: AngebotRead }) {
  const isDraft = angebot.status === "draft";

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">
        {angebot.angebotsnummer ?? (
          <span className="text-muted-foreground italic">nicht ausgestellt</span>
        )}
      </TableCell>
      <TableCell>{statusBadge(angebot.status)}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        v{angebot.version_no}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {new Date(angebot.created_at).toLocaleDateString("de-DE")}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {angebot.summe_brutto
          ? new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency: angebot.waehrung ?? "EUR",
            }).format(parseFloat(angebot.summe_brutto))
          : "—"}
      </TableCell>
      <TableCell>
        {isDraft && (
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link
              to={`/office/angebote/${angebot.id}/review`}
              title="Prüfung öffnen"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
