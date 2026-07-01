import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen, Search } from "lucide-react";
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

type ProjektRead = components["schemas"]["ProjektRead"];
type ProjektStatus = ProjektRead["status"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];

const STATUS_LABELS: Record<ProjektStatus, string> = {
  angelegt: "Angelegt",
  kalkulation: "Kalkulation",
  beauftragt: "Beauftragt",
  in_ausfuehrung: "In Ausführung",
  abgenommen: "Abgenommen",
  abgerechnet: "Abgerechnet",
  gewaehrleistung: "Gewährleistung",
  abgeschlossen: "Abgeschlossen",
  pausiert: "Pausiert",
  storniert: "Storniert",
};

const STATUS_COLORS: Record<ProjektStatus, string> = {
  angelegt: "bg-muted text-muted-foreground",
  kalkulation: "bg-blue-100 text-blue-700",
  beauftragt: "bg-blue-200 text-blue-800",
  in_ausfuehrung: "bg-yellow-100 text-yellow-800",
  abgenommen: "bg-green-100 text-green-700",
  abgerechnet: "bg-green-200 text-green-800",
  gewaehrleistung: "bg-purple-100 text-purple-700",
  abgeschlossen: "bg-green-300 text-green-900",
  pausiert: "bg-orange-100 text-orange-700",
  storniert: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: ProjektStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [auftraggeberId, setAuftraggeberId] = useState("");

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/projekt", {
        body: { name, auftraggeber_id: auftraggeberId },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projekt"] });
      setName("");
      setAuftraggeberId("");
      onClose();
    },
  });

  const canSubmit = name && auftraggeberId && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neues Projekt</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="proj-name" className="text-sm font-medium">
              Projektname <span className="text-destructive">*</span>
            </label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Fassade Musterstraße 12"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && canSubmit && create.mutate()}
            />
          </div>
          <div>
            <label htmlFor="proj-ag" className="text-sm font-medium">
              Auftraggeber <span className="text-destructive">*</span>
            </label>
            <Combobox
              className="mt-1"
              options={auftraggeber?.map((ag) => ({
                value: ag.id,
                label: ag.kundennummer ? `${ag.name} (${ag.kundennummer})` : ag.name,
              })) ?? []}
              value={auftraggeberId}
              onChange={(v) => setAuftraggeberId(v)}
              placeholder="— wählen —"
            />
            {!auftraggeber?.length && (
              <p className="text-xs text-muted-foreground mt-1">
                Noch kein Auftraggeber angelegt.{" "}
                <Link to="/office/auftraggeber" className="underline">Jetzt anlegen</Link>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!canSubmit} onClick={() => create.mutate()}>Anlegen</Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-2">
            {(create.error as Error)?.message ?? "Fehler beim Anlegen"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProjektList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjektStatus | "">("");
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const { data: projekte, isLoading } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
  });

  const agMap = new Map((auftraggeber ?? []).map((ag) => [ag.id, ag.name]));

  let displayed = [...(projekte ?? [])];
  if (statusFilter) displayed = displayed.filter((p) => p.status === statusFilter);
  if (search.trim()) {
    const q = search.toLowerCase();
    displayed = displayed.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nummer ?? "").toLowerCase().includes(q) ||
        (agMap.get(p.auftraggeber_id) ?? "").toLowerCase().includes(q),
    );
  }
  displayed.sort((a, b) => {
    let av = "";
    let bv = "";
    if (sortCol === "auftraggeber") { av = agMap.get(a.auftraggeber_id) ?? ""; bv = agMap.get(b.auftraggeber_id) ?? ""; }
    else if (sortCol === "status") { av = a.status; bv = b.status; }
    else if (sortCol === "start_datum") { av = a.start_datum ?? ""; bv = b.start_datum ?? ""; }
    else if (sortCol === "end_datum") { av = a.end_datum ?? ""; bv = b.end_datum ?? ""; }
    else if (sortCol === "nummer") { av = a.nummer ?? ""; bv = b.nummer ?? ""; }
    else { av = a.name; bv = b.name; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = projekte?.length ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Projekte</h1>
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
            className="w-44"
            options={(Object.keys(STATUS_LABELS) as ProjektStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as ProjektStatus | "")}
            placeholder="Alle Status"
            allowClear
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neues Projekt
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !projekte?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch keine Projekte angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Erstes Projekt anlegen
          </Button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="border rounded-md p-12 text-center">
          <p className="text-muted-foreground text-sm">Keine Projekte gefunden.</p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead col="nummer" label="Nr." sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                <SortHead col="name" label="Name" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="auftraggeber" label="Auftraggeber" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-36" />
                <SortHead col="start_datum" label="Start" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-24" />
                <SortHead col="end_datum" label="Ende" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/projekte/${p.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.nummer ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {agMap.get(p.auftraggeber_id) ?? "—"}
                  </TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.start_datum ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.end_datum ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
