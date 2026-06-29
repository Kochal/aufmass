import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { components } from "@/api/schema";

type BestellungRead = components["schemas"]["BestellungRead"];
type LieferantRead = components["schemas"]["LieferantRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

const STATUS_LABELS: Record<string, string> = {
  entwurf: "Entwurf",
  bestellt: "Bestellt",
  teilgeliefert: "Teilgeliefert",
  geliefert: "Geliefert",
  storniert: "Storniert",
};

const STATUS_COLORS: Record<string, string> = {
  entwurf: "bg-gray-100 text-gray-700",
  bestellt: "bg-blue-100 text-blue-800",
  teilgeliefert: "bg-orange-100 text-orange-800",
  geliefert: "bg-green-100 text-green-800",
  storniert: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtSumme(s: string | number | null | undefined): string {
  if (s == null) return "—";
  return Number(s).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open, onClose, lieferanten, projekte,
}: {
  open: boolean; onClose: (id?: string) => void;
  lieferanten: LieferantRead[]; projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [lieferantId, setLieferantId] = useState("");
  const [projektId, setProjektId] = useState("");
  const [bestelldatum, setBestelldatum] = useState(today);
  const [summe, setSumme] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/bestellung", {
        body: {
          lieferant_id: lieferantId,
          projekt_id: projektId || null,
          bestelldatum: bestelldatum || null,
          summe: (summe ? summe : null) as unknown as number | null,
          auftragsbestaetigung_document_id: null,
        },
      });
      return unwrap(res) as BestellungRead;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["bestellung"] });
      setLieferantId(""); setProjektId(""); setBestelldatum(today); setSumme("");
      onClose(data.id);
      toast.success("Bestellung angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neue Bestellung</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="bs-lf" className="text-sm font-medium">
              Lieferant <span className="text-destructive">*</span>
            </label>
            <select id="bs-lf" value={lieferantId} onChange={(e) => setLieferantId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">— wählen —</option>
              {lieferanten.map((lf) => <option key={lf.id} value={lf.id}>{lf.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bs-proj" className="text-sm font-medium">Projekt</label>
            <select id="bs-proj" value={projektId} onChange={(e) => setProjektId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">— kein —</option>
              {projekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bs-datum" className="text-sm font-medium">Bestelldatum</label>
              <Input id="bs-datum" type="date" value={bestelldatum}
                onChange={(e) => setBestelldatum(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label htmlFor="bs-summe" className="text-sm font-medium">Summe (€)</label>
              <Input id="bs-summe" type="number" min={0} step={0.01} value={summe}
                onChange={(e) => setSumme(e.target.value)} placeholder="0,00" className="mt-1" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()}>Abbrechen</Button>
          <Button disabled={!lieferantId || create.isPending} onClick={() => create.mutate()}>
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function BestellungList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [projektFilter, setProjektFilter] = useState("");

  const { data: lieferanten } = useQuery<LieferantRead[]>({
    queryKey: ["lieferant"],
    queryFn: async () => unwrap(await apiClient.GET("/api/lieferant")) as LieferantRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: bestellungen, isLoading } = useQuery<BestellungRead[]>({
    queryKey: ["bestellung", statusFilter, projektFilter],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (statusFilter) query.status = statusFilter;
      if (projektFilter) query.projekt_id = projektFilter;
      const res = await apiClient.GET("/api/bestellung", {
        params: Object.keys(query).length ? { query } : {},
      });
      return unwrap(res) as BestellungRead[];
    },
  });

  const lfMap = new Map(lieferanten?.map((lf) => [lf.id, lf.name]) ?? []);
  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  function handleCreated(id?: string) {
    setShowCreate(false);
    if (id) window.location.href = `/office/bestellungen/${id}`;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Bestellungen</h1>
          {bestellungen && <span className="text-sm text-muted-foreground">({bestellungen.length})</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Alle Status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={projektFilter} onChange={(e) => setProjektFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Alle Projekte</option>
            {projekte?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Neue Bestellung
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !bestellungen?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <ShoppingCart className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {statusFilter || projektFilter ? "Keine Bestellungen für diesen Filter." : "Noch keine Bestellungen."}
          </p>
          {!statusFilter && !projektFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Erste Bestellung anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lieferant</TableHead>
                <TableHead>Projekt</TableHead>
                <TableHead className="w-28">Bestelldatum</TableHead>
                <TableHead className="w-28 text-right">Summe</TableHead>
                <TableHead className="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bestellungen.map((bs) => (
                <TableRow key={bs.id} className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/bestellungen/${bs.id}`)}>
                  <TableCell className="font-medium text-sm">
                    {lfMap.get(bs.lieferant_id) ?? bs.lieferant_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {bs.projekt_id ? projMap.get(bs.projekt_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(bs.bestelldatum ? String(bs.bestelldatum) : null)}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right">{fmtSumme(bs.summe)}</TableCell>
                  <TableCell><StatusBadge status={bs.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showCreate && (
        <CreateDialog open={showCreate} onClose={handleCreated}
          lieferanten={lieferanten ?? []} projekte={projekte ?? []} />
      )}
    </div>
  );
}
