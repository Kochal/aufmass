import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Search } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortHead } from "@/components/ui/sort-head";
import type { components } from "@/api/schema";

type RechnungRead = components["schemas"]["RechnungRead"];
type AngebotRead = components["schemas"]["AngebotRead"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  issued: "Ausgestellt",
  storniert: "Storniert",
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-green-100 text-green-800",
  storniert: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: (id?: string) => void }) {
  const qc = useQueryClient();
  const [direktrechnung, setDirektrechnung] = useState(false);
  const [auftraggeberId, setAuftraggeberId] = useState("");
  const [projektId, setProjektId] = useState("");

  const { data: angebote } = useQuery<AngebotRead[]>({
    queryKey: ["angebot", { forRechnung: true }],
    queryFn: async () => unwrap(await apiClient.GET("/api/angebot", {})) as AngebotRead[],
    enabled: open,
  });
  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
    enabled: open,
  });
  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
    enabled: open,
  });

  const activeAngebote = (angebote ?? []).filter(
    (a) => a.status !== "cancelled" && a.status !== "superseded",
  );
  const allowedAgIds = new Set(activeAngebote.map((a) => a.auftraggeber_id));
  const allowedProjIds = new Set(
    activeAngebote
      .filter((a) => a.auftraggeber_id === auftraggeberId && a.projekt_id)
      .map((a) => a.projekt_id as string),
  );

  const agOptions = direktrechnung
    ? (auftraggeber ?? []).map((ag) => ({ value: ag.id, label: ag.name }))
    : (auftraggeber ?? []).filter((ag) => allowedAgIds.has(ag.id)).map((ag) => ({ value: ag.id, label: ag.name }));

  const projOptions = direktrechnung
    ? (projekte ?? []).filter((p) => !auftraggeberId || p.auftraggeber_id === auftraggeberId).map((p) => ({ value: p.id, label: p.name }))
    : (projekte ?? []).filter((p) => allowedProjIds.has(p.id)).map((p) => ({ value: p.id, label: p.name }));

  function reset() {
    setDirektrechnung(false);
    setAuftraggeberId("");
    setProjektId("");
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/rechnung", {
        body: {
          auftraggeber_id: auftraggeberId || null,
          projekt_id: projektId || null,
          waehrung: "EUR",
        },
      });
      return unwrap(res) as RechnungRead;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rechnung"] });
      reset();
      onClose(data.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neue Rechnung</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Auftraggeber</label>
            <Combobox
              className="mt-1"
              options={agOptions}
              value={auftraggeberId}
              onChange={(v) => { setAuftraggeberId(v); setProjektId(""); }}
              placeholder="Auftraggeber auswählen …"
              allowClear
            />
          </div>
          <div>
            <label className="text-sm font-medium">Projekt</label>
            <Combobox
              className="mt-1"
              options={projOptions}
              value={projektId}
              onChange={setProjektId}
              placeholder="— kein —"
              allowClear
            />
          </div>
          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={direktrechnung}
              onChange={(e) => { setDirektrechnung(e.target.checked); setAuftraggeberId(""); setProjektId(""); }}
              className="rounded"
            />
            <span className="text-sm text-muted-foreground">Direktrechnung (ohne Angebot)</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Abbrechen</Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>Anlegen</Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-2">
            {(create.error as Error)?.message ?? "Fehler"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RechnungList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortCol, setSortCol] = useState("rechnungsdatum");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const { data: rechnungen, isLoading } = useQuery<RechnungRead[]>({
    queryKey: ["rechnung"],
    queryFn: async () => unwrap(await apiClient.GET("/api/rechnung", {})) as RechnungRead[],
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
  });
  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const agMap = new Map(auftraggeber?.map((ag) => [ag.id, ag.name]) ?? []);
  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  let displayed = [...(rechnungen ?? [])];
  if (statusFilter) displayed = displayed.filter((r) => r.status === statusFilter);
  if (search.trim()) {
    const q = search.toLowerCase();
    displayed = displayed.filter(
      (r) =>
        (r.rechnungsnummer ?? "").toLowerCase().includes(q) ||
        (r.auftraggeber_id ? (agMap.get(r.auftraggeber_id) ?? "") : "").toLowerCase().includes(q) ||
        (r.projekt_id ? (projMap.get(r.projekt_id) ?? "") : "").toLowerCase().includes(q),
    );
  }
  displayed.sort((a, b) => {
    let av = "";
    let bv = "";
    if (sortCol === "auftraggeber") {
      av = a.auftraggeber_id ? (agMap.get(a.auftraggeber_id) ?? "") : "";
      bv = b.auftraggeber_id ? (agMap.get(b.auftraggeber_id) ?? "") : "";
    } else if (sortCol === "projekt") {
      av = a.projekt_id ? (projMap.get(a.projekt_id) ?? "") : "";
      bv = b.projekt_id ? (projMap.get(b.projekt_id) ?? "") : "";
    } else if (sortCol === "summe_brutto") {
      const an = parseFloat(a.summe_brutto ?? "0");
      const bn = parseFloat(b.summe_brutto ?? "0");
      return sortDir === "asc" ? an - bn : bn - an;
    } else if (sortCol === "status") {
      av = a.status; bv = b.status;
    } else if (sortCol === "rechnungsnummer") {
      av = a.rechnungsnummer ?? ""; bv = b.rechnungsnummer ?? "";
    } else {
      av = a.rechnungsdatum ?? ""; bv = b.rechnungsdatum ?? "";
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = rechnungen?.length ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Rechnungen</h1>
          <span className="text-sm text-muted-foreground">
            ({(search || statusFilter) ? `${displayed.length} / ${total}` : total})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-48 text-sm"
            />
          </div>
          <Combobox
            className="w-40"
            options={[
              { value: "draft", label: "Entwurf" },
              { value: "issued", label: "Ausgestellt" },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            placeholder="Alle Status"
            allowClear
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neue Rechnung
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !rechnungen?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Receipt className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch keine Rechnungen angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Erste Rechnung anlegen
          </Button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="border rounded-md p-12 text-center">
          <p className="text-muted-foreground text-sm">Keine Rechnungen gefunden.</p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead col="rechnungsnummer" label="Rechnungsnr." sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-36" />
                <SortHead col="auftraggeber" label="Auftraggeber" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="projekt" label="Projekt" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="summe_brutto" label="Brutto" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-32" align="end" />
                <SortHead col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                <SortHead col="rechnungsdatum" label="Datum" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/rechnungen/${r.id}`)}
                >
                  <TableCell className="font-mono text-xs">
                    {r.rechnungsnummer ?? "Entwurf"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.auftraggeber_id ? (agMap.get(r.auftraggeber_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.projekt_id ? (projMap.get(r.projekt_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {r.summe_brutto
                      ? `${parseFloat(r.summe_brutto).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`
                      : "—"}
                  </TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.rechnungsdatum ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog
        open={showCreate}
        onClose={(id) => { setShowCreate(false); if (id) navigate(`/office/rechnungen/${id}`); }}
      />
    </div>
  );
}
