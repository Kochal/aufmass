import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortHead } from "@/components/ui/sort-head";
import { ColFilter, ColSelect } from "@/components/ui/table-filters";
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
const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([v, label]) => ({ value: v, label }));

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
  const [angebotId, setAngebotId] = useState("");
  const [auftraggeberId, setAuftraggeberId] = useState("");
  const [projektId, setProjektId] = useState("");

  const { data: angebote } = useQuery<AngebotRead[]>({
    queryKey: ["angebot"],
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

  const agMap = new Map((auftraggeber ?? []).map((ag) => [ag.id, ag.name]));
  const projMap = new Map((projekte ?? []).map((p) => [p.id, p.name]));

  const activeAngebote = (angebote ?? []).filter(
    (a) => a.status !== "cancelled" && a.status !== "superseded",
  );
  const angebotOptions = activeAngebote.map((a) => {
    const ag = agMap.get(a.auftraggeber_id) ?? "—";
    const proj = a.projekt_id ? projMap.get(a.projekt_id) : null;
    const nr = a.angebotsnummer ?? new Date(a.created_at).toLocaleDateString("de-DE");
    return { value: a.id, label: proj ? `${ag} / ${proj} — ${nr}` : `${ag} — ${nr}` };
  });

  const selectedAngebot = angebote?.find((a) => a.id === angebotId);

  function reset() {
    setDirektrechnung(false);
    setAngebotId("");
    setAuftraggeberId("");
    setProjektId("");
  }

  const create = useMutation({
    mutationFn: async () => {
      const body = direktrechnung
        ? { auftraggeber_id: auftraggeberId || null, projekt_id: projektId || null, waehrung: "EUR" }
        : { angebot_id: angebotId || null, waehrung: "EUR" };
      const res = await apiClient.POST("/api/rechnung", { body });
      return unwrap(res) as RechnungRead;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rechnung"] });
      reset();
      onClose(data.id);
    },
  });

  const canCreate = direktrechnung ? true : !!angebotId;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neue Rechnung</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {!direktrechnung ? (
            <div>
              <label className="text-sm font-medium">Angebot *</label>
              <Combobox
                className="mt-1"
                options={angebotOptions}
                value={angebotId}
                onChange={(v) => setAngebotId(v ?? "")}
                placeholder="Angebot auswählen…"
                searchPlaceholder="Suchen…"
                allowClear
              />
              {selectedAngebot && (
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5 pl-1">
                  <div>Auftraggeber: <span className="text-foreground">{agMap.get(selectedAngebot.auftraggeber_id) ?? "—"}</span></div>
                  {selectedAngebot.projekt_id && (
                    <div>Projekt: <span className="text-foreground">{projMap.get(selectedAngebot.projekt_id) ?? "—"}</span></div>
                  )}
                  <div className="text-[11px] text-muted-foreground/60">
                    Positionen werden aus dem Angebot importiert und können angepasst werden.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium">Auftraggeber</label>
                <Combobox className="mt-1" options={(auftraggeber ?? []).map((ag) => ({ value: ag.id, label: ag.name }))} value={auftraggeberId} onChange={(v) => { setAuftraggeberId(v); setProjektId(""); }} placeholder="Auftraggeber auswählen…" allowClear />
              </div>
              <div>
                <label className="text-sm font-medium">Projekt</label>
                <Combobox className="mt-1" options={(projekte ?? []).filter((p) => !auftraggeberId || p.auftraggeber_id === auftraggeberId).map((p) => ({ value: p.id, label: p.name }))} value={projektId} onChange={setProjektId} placeholder="— kein —" allowClear />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={direktrechnung}
              onChange={(e) => { setDirektrechnung(e.target.checked); setAngebotId(""); setAuftraggeberId(""); setProjektId(""); }}
              className="rounded"
            />
            <span className="text-sm text-muted-foreground">Direktrechnung (ohne Angebot)</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Abbrechen</Button>
          <Button disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>Anlegen</Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-2">{(create.error as Error)?.message ?? "Fehler"}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RechnungList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState("rechnungsdatum");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function setFilter(col: string, val: string) {
    setFilters((f) => ({ ...f, [col]: val }));
  }
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
  if (filters.rechnungsnummer) {
    const q = filters.rechnungsnummer.toLowerCase();
    displayed = displayed.filter((r) => (r.rechnungsnummer ?? "").toLowerCase().includes(q));
  }
  if (filters.auftraggeber) {
    const q = filters.auftraggeber.toLowerCase();
    displayed = displayed.filter((r) =>
      (r.auftraggeber_id ? (agMap.get(r.auftraggeber_id) ?? "") : "").toLowerCase().includes(q),
    );
  }
  if (filters.projekt) {
    const q = filters.projekt.toLowerCase();
    displayed = displayed.filter((r) =>
      (r.projekt_id ? (projMap.get(r.projekt_id) ?? "") : "").toLowerCase().includes(q),
    );
  }
  if (filters.status) {
    displayed = displayed.filter((r) => r.status === filters.status);
  }
  displayed.sort((a, b) => {
    if (sortCol === "summe_brutto") {
      const an = parseFloat(a.summe_brutto ?? "0");
      const bn = parseFloat(b.summe_brutto ?? "0");
      return sortDir === "asc" ? an - bn : bn - an;
    }
    let av = "";
    let bv = "";
    if (sortCol === "auftraggeber") { av = a.auftraggeber_id ? (agMap.get(a.auftraggeber_id) ?? "") : ""; bv = b.auftraggeber_id ? (agMap.get(b.auftraggeber_id) ?? "") : ""; }
    else if (sortCol === "projekt") { av = a.projekt_id ? (projMap.get(a.projekt_id) ?? "") : ""; bv = b.projekt_id ? (projMap.get(b.projekt_id) ?? "") : ""; }
    else if (sortCol === "status") { av = a.status; bv = b.status; }
    else if (sortCol === "rechnungsnummer") { av = a.rechnungsnummer ?? ""; bv = b.rechnungsnummer ?? ""; }
    else { av = a.rechnungsdatum ?? ""; bv = b.rechnungsdatum ?? ""; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = rechnungen?.length ?? 0;
  const hasFilter = Object.values(filters).some((v) => !!v);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Rechnungen</h1>
          <span className="text-sm text-muted-foreground">
            ({hasFilter ? `${displayed.length} / ${total}` : total})
          </span>
          {hasFilter && (
            <button type="button" onClick={() => setFilters({})} className="text-xs text-muted-foreground hover:text-foreground underline">
              Filter zurücksetzen
            </button>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neue Rechnung
        </Button>
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
              <TableRow className="hover:bg-transparent">
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.rechnungsnummer ?? ""} onChange={(v) => setFilter("rechnungsnummer", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.auftraggeber ?? ""} onChange={(v) => setFilter("auftraggeber", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.projekt ?? ""} onChange={(v) => setFilter("projekt", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3" />
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColSelect value={filters.status ?? ""} onChange={(v) => setFilter("status", v)} options={STATUS_OPTIONS} />
                </TableHead>
                <TableHead className="py-1.5 px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    Keine Rechnungen gefunden.
                  </TableCell>
                </TableRow>
              ) : displayed.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/rechnungen/${r.id}`)}
                >
                  <TableCell className="font-mono text-xs">{r.rechnungsnummer ?? "Entwurf"}</TableCell>
                  <TableCell className="text-sm">{r.auftraggeber_id ? (agMap.get(r.auftraggeber_id) ?? "—") : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.projekt_id ? (projMap.get(r.projekt_id) ?? "—") : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {r.summe_brutto ? `${parseFloat(r.summe_brutto).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €` : "—"}
                  </TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.rechnungsdatum ?? "—"}</TableCell>
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
