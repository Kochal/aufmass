import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, FileText, ArrowRight } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { SortHead } from "@/components/ui/sort-head";
import { ColFilter, ColSelect } from "@/components/ui/table-filters";
import type { components } from "@/api/schema";

type AngebotRead = components["schemas"]["AngebotRead"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

const STATUS_CFG: Record<string, { label: string; variant: string }> = {
  draft:   { label: "Entwurf",      variant: "secondary" },
  issued:  { label: "Ausgestellt",  variant: "confidence-high" },
  awarded: { label: "Beauftragt",   variant: "default" },
  voided:  { label: "Storniert",    variant: "destructive" },
};

const STATUS_OPTIONS = Object.entries(STATUS_CFG).map(([v, c]) => ({ value: v, label: c.label }));

function statusBadge(status: string) {
  const cfg = STATUS_CFG[status] ?? { label: status, variant: "outline" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Badge variant={cfg.variant as any} className="text-xs">{cfg.label}</Badge>;
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateAngebotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [auftraggeberId, setAuftraggeberId] = useState("");
  const [projektId, setProjektId] = useState("");
  const [newAgMode, setNewAgMode] = useState(false);
  const [newAgName, setNewAgName] = useState("");
  const [newProjMode, setNewProjMode] = useState(false);
  const [newProjName, setNewProjName] = useState("");

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber", {})) as AuftraggeberRead[],
    enabled: open,
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
    enabled: open,
  });

  function reset() {
    setAuftraggeberId(""); setProjektId("");
    setNewAgMode(false); setNewAgName("");
    setNewProjMode(false); setNewProjName("");
  }

  const createAg = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/auftraggeber", {
        body: { name: newAgName.trim(), eas_scheme: "EM" },
      });
      return unwrap(res) as AuftraggeberRead;
    },
    onSuccess: (ag) => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      setAuftraggeberId(ag.id);
      setProjektId("");
      setNewAgName("");
      setNewAgMode(false);
    },
  });

  const createProj = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/projekt", {
        body: { auftraggeber_id: auftraggeberId, name: newProjName.trim() },
      });
      return unwrap(res) as ProjektRead;
    },
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ["projekt"] });
      setProjektId(proj.id);
      setNewProjName("");
      setNewProjMode(false);
    },
  });

  const createAngebot = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/angebot", {
        body: { auftraggeber_id: auftraggeberId, projekt_id: projektId || undefined, waehrung: "EUR" },
      });
      return unwrap(res) as AngebotRead;
    },
    onSuccess: (angebot) => {
      qc.invalidateQueries({ queryKey: ["angebot"] });
      reset();
      onClose();
      navigate(`/office/angebote/${angebot.id}/review`);
    },
  });

  const agOptions = (auftraggeber ?? []).map((a) => ({ value: a.id, label: a.name }));
  const projektOptions = (projekte ?? [])
    .filter((p) => !auftraggeberId || p.auftraggeber_id === auftraggeberId)
    .map((p) => ({ value: p.id, label: p.name }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neues Angebot</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Auftraggeber *</label>
              <button
                type="button"
                onClick={() => { setNewAgMode((m) => !m); setNewAgName(""); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />Neu
              </button>
            </div>
            <Combobox
              options={agOptions}
              value={auftraggeberId}
              onChange={(v) => { setAuftraggeberId(v ?? ""); setProjektId(""); setNewProjMode(false); }}
              placeholder="Auftraggeber wählen…"
              searchPlaceholder="Suchen…"
            />
            {newAgMode && (
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  value={newAgName}
                  onChange={(e) => setNewAgName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newAgName.trim()) createAg.mutate(); if (e.key === "Escape") setNewAgMode(false); }}
                  placeholder="Name des Auftraggebers"
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" className="h-8" disabled={!newAgName.trim() || createAg.isPending} onClick={() => createAg.mutate()}>
                  Anlegen
                </Button>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Projekt (optional)</label>
              <button
                type="button"
                disabled={!auftraggeberId}
                onClick={() => { setNewProjMode((m) => !m); setNewProjName(""); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                <Plus className="h-3 w-3" />Neu
              </button>
            </div>
            <Combobox
              options={projektOptions}
              value={projektId}
              onChange={(v) => setProjektId(v ?? "")}
              placeholder={auftraggeberId ? "Projekt wählen…" : "Erst Auftraggeber wählen"}
              searchPlaceholder="Suchen…"
              allowClear
            />
            {newProjMode && (
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newProjName.trim()) createProj.mutate(); if (e.key === "Escape") setNewProjMode(false); }}
                  placeholder="Projektname"
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" className="h-8" disabled={!newProjName.trim() || createProj.isPending} onClick={() => createProj.mutate()}>
                  Anlegen
                </Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Abbrechen</Button>
          <Button disabled={!auftraggeberId || createAngebot.isPending} onClick={() => createAngebot.mutate()}>
            Erstellen
          </Button>
        </DialogFooter>
        {createAngebot.isError && (
          <p className="text-sm text-destructive mt-1">
            {(createAngebot.error as Error)?.message ?? "Fehler beim Erstellen"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

export function AngebotList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function setFilter(col: string, val: string) {
    setFilters((f) => ({ ...f, [col]: val }));
  }
  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const { data: angebote, isLoading, error } = useQuery({
    queryKey: ["angebot"],
    queryFn: async () => unwrap(await apiClient.GET("/api/angebot", {})),
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber", {})) as AuftraggeberRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const agMap = new Map((auftraggeber ?? []).map((ag) => [ag.id, ag.name]));
  const projMap = new Map((projekte ?? []).map((p) => [p.id, p.name]));

  let displayed: AngebotRead[] = [...((angebote as AngebotRead[]) ?? [])];
  if (filters.auftraggeber) {
    const q = filters.auftraggeber.toLowerCase();
    displayed = displayed.filter((a) => (agMap.get(a.auftraggeber_id) ?? "").toLowerCase().includes(q));
  }
  if (filters.projekt) {
    const q = filters.projekt.toLowerCase();
    displayed = displayed.filter((a) =>
      (a.projekt_id ? (projMap.get(a.projekt_id) ?? "") : "").toLowerCase().includes(q),
    );
  }
  if (filters.angebotsnummer) {
    const q = filters.angebotsnummer.toLowerCase();
    displayed = displayed.filter((a) => (a.angebotsnummer ?? "").toLowerCase().includes(q));
  }
  if (filters.status) {
    displayed = displayed.filter((a) => a.status === filters.status);
  }
  displayed.sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    if (sortCol === "auftraggeber") { av = agMap.get(a.auftraggeber_id) ?? ""; bv = agMap.get(b.auftraggeber_id) ?? ""; }
    else if (sortCol === "projekt") { av = a.projekt_id ? (projMap.get(a.projekt_id) ?? "") : ""; bv = b.projekt_id ? (projMap.get(b.projekt_id) ?? "") : ""; }
    else if (sortCol === "angebotsnummer") { av = a.angebotsnummer ?? ""; bv = b.angebotsnummer ?? ""; }
    else if (sortCol === "status") { av = a.status; bv = b.status; }
    else if (sortCol === "summe_brutto") { av = parseFloat(a.summe_brutto ?? "0"); bv = parseFloat(b.summe_brutto ?? "0"); }
    else { av = a.created_at; bv = b.created_at; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = (angebote as AngebotRead[] | undefined)?.length ?? 0;
  const hasFilter = Object.values(filters).some((v) => !!v);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          Fehler beim Laden: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Angebote</h1>
          <span className="text-sm text-muted-foreground">
            ({hasFilter ? `${displayed.length} / ${total}` : total})
          </span>
          {hasFilter && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neues Angebot
        </Button>
      </div>

      {(angebote as AngebotRead[] | undefined)?.length === 0 ? (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <p className="text-muted-foreground text-sm">Noch keine Angebote.</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Neues Angebot erstellen
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead col="auftraggeber" label="Auftraggeber" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="projekt" label="Projekt" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="angebotsnummer" label="Angebotsnr." sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                <SortHead col="created_at" label="Erstellt" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                <SortHead col="summe_brutto" label="Brutto" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-36" align="end" />
                <TableHead className="w-10" />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.auftraggeber ?? ""} onChange={(v) => setFilter("auftraggeber", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.projekt ?? ""} onChange={(v) => setFilter("projekt", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.angebotsnummer ?? ""} onChange={(v) => setFilter("angebotsnummer", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColSelect value={filters.status ?? ""} onChange={(v) => setFilter("status", v)} options={STATUS_OPTIONS} />
                </TableHead>
                <TableHead className="py-1.5 px-3" />
                <TableHead className="py-1.5 px-3" />
                <TableHead className="py-1.5 px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    Keine Angebote gefunden.
                  </TableCell>
                </TableRow>
              ) : displayed.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/office/angebote/${a.id}/review`)}
                >
                  <TableCell className="font-medium">
                    {agMap.get(a.auftraggeber_id) ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.projekt_id ? (projMap.get(a.projekt_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {a.angebotsnummer ?? <span className="italic text-muted-foreground">Entwurf</span>}
                  </TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(a.created_at).toLocaleDateString("de-DE")}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {a.summe_brutto
                      ? new Intl.NumberFormat("de-DE", { style: "currency", currency: a.waehrung ?? "EUR" }).format(parseFloat(a.summe_brutto))
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); navigate(`/office/angebote/${a.id}/review`); }}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateAngebotDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
