import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, ArrowRight, FileText } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import type { components } from "@/api/schema";

type AngebotRead = components["schemas"]["AngebotRead"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

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

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateAngebotDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [auftraggeberId, setAuftraggeberId] = useState("");
  const [projektId, setProjektId] = useState("");

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () =>
      unwrap(await apiClient.GET("/api/auftraggeber", {})) as AuftraggeberRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () =>
      unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/angebot", {
        body: {
          auftraggeber_id: auftraggeberId,
          projekt_id: projektId || undefined,
          waehrung: "EUR",
        },
      });
      return unwrap(res) as AngebotRead;
    },
    onSuccess: (angebot) => {
      qc.invalidateQueries({ queryKey: ["angebot"] });
      onClose();
      setAuftraggeberId("");
      setProjektId("");
      navigate(`/office/angebote/${angebot.id}/review`);
    },
  });

  const agOptions = (auftraggeber ?? []).map((a) => ({
    value: a.id,
    label: a.name,
  }));

  const projektOptions = (projekte ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Neues Angebot</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Auftraggeber *</label>
            <Combobox
              className="mt-1"
              options={agOptions}
              value={auftraggeberId}
              onChange={(v) => setAuftraggeberId(v ?? "")}
              placeholder="Auftraggeber wählen…"
              searchPlaceholder="Suchen…"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Projekt (optional)</label>
            <Combobox
              className="mt-1"
              options={projektOptions}
              value={projektId}
              onChange={(v) => setProjektId(v ?? "")}
              placeholder="Projekt wählen…"
              searchPlaceholder="Suchen…"
              allowClear
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            disabled={!auftraggeberId || create.isPending}
            onClick={() => create.mutate()}
          >
            Erstellen
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-1">
            {(create.error as Error)?.message ?? "Fehler beim Erstellen"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

export function AngebotList() {
  const [showCreate, setShowCreate] = useState(false);

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
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neues Angebot
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <p className="text-muted-foreground text-sm">Noch keine Angebote.</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neues Angebot erstellen
          </Button>
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

      <CreateAngebotDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}

function AngebotRow({ angebot }: { angebot: AngebotRead }) {
  const navigate = useNavigate();
  const to = `/office/angebote/${angebot.id}/review`;

  return (
    <TableRow className="cursor-pointer" onClick={() => navigate(to)}>
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
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to={to} title="Öffnen" onClick={(e) => e.stopPropagation()}>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
