import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { components } from "@/api/schema";

type GewaehrleistungRead = components["schemas"]["GewaehrleistungRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function FristEndeCell({ entry }: { entry: GewaehrleistungRead }) {
  const days = daysUntil(entry.frist_ende ? String(entry.frist_ende) : null);

  if (!entry.frist_ende) return <span className="text-sm text-muted-foreground">—</span>;

  const dateStr = fmtDate(String(entry.frist_ende));

  if (entry.status !== "laufend") {
    return <span className="text-sm text-muted-foreground">{dateStr}</span>;
  }

  if (days !== null && days < 0) {
    return (
      <div className="flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
        <span className="text-sm text-red-600 font-medium">{dateStr}</span>
      </div>
    );
  }
  if (days !== null && days <= 90) {
    return (
      <div>
        <div className="text-sm text-orange-600 font-medium">{dateStr}</div>
        <div className="text-[10px] text-orange-500">noch {days} Tage</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm">{dateStr}</div>
      {days !== null && (
        <div className="text-[10px] text-muted-foreground">noch {days} Tage</div>
      )}
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    laufend: "bg-green-100 text-green-800",
    abgelaufen: "bg-red-100 text-red-800",
    beendet: "bg-gray-100 text-gray-700",
  };
  const labels: Record<string, string> = {
    laufend: "Laufend",
    abgelaufen: "Abgelaufen",
    beendet: "Beendet",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function RegimeBadge({ regime }: { regime: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono
      ${regime === "vob" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}>
      {regime.toUpperCase()}
    </span>
  );
}

// ── Shared form fields ────────────────────────────────────────────────────────

interface FormProps {
  projektId: string; setProjektId: (v: string) => void;
  regime: string; setRegime: (v: string) => void;
  startDatum: string; setStartDatum: (v: string) => void;
  fristJahre: string; setFristJahre: (v: string) => void;
  status?: string; setStatus?: (v: string) => void;
  projekte: ProjektRead[];
  showProjekt?: boolean;
  showStatus?: boolean;
}

function GewaehrleistungFields({
  projektId, setProjektId, regime, setRegime,
  startDatum, setStartDatum, fristJahre, setFristJahre,
  status, setStatus,
  projekte, showProjekt = true, showStatus = false,
}: FormProps) {
  const defaultJahre = regime === "vob" ? 4 : 5;

  return (
    <div className="space-y-3 py-2">
      {showProjekt && (
        <div>
          <label htmlFor="gw-proj" className="text-sm font-medium">
            Projekt <span className="text-destructive">*</span>
          </label>
          <select
            id="gw-proj"
            value={projektId}
            onChange={(e) => setProjektId(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— wählen —</option>
            {projekte.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="gw-regime" className="text-sm font-medium">
            Regime <span className="text-destructive">*</span>
          </label>
          <select
            id="gw-regime"
            value={regime}
            onChange={(e) => setRegime(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="vob">VOB (§ 13 VOB/B)</option>
            <option value="bgb">BGB (§ 634a BGB)</option>
          </select>
        </div>
        <div>
          <label htmlFor="gw-frist" className="text-sm font-medium">
            Frist (Jahre)
          </label>
          <Input
            id="gw-frist"
            type="number"
            min={1}
            max={30}
            value={fristJahre}
            onChange={(e) => setFristJahre(e.target.value)}
            placeholder={`Standard: ${defaultJahre}`}
            className="mt-1"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Leer lassen = {defaultJahre} Jahre ({regime.toUpperCase()}-Standard)
          </p>
        </div>
      </div>
      <div>
        <label htmlFor="gw-start" className="text-sm font-medium">Startdatum</label>
        <Input id="gw-start" type="date" value={startDatum}
          onChange={(e) => setStartDatum(e.target.value)} className="mt-1" />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          In der Regel das Abnahmedatum
        </p>
      </div>
      {showStatus && setStatus && (
        <div>
          <label htmlFor="gw-status" className="text-sm font-medium">Status</label>
          <select
            id="gw-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="laufend">Laufend</option>
            <option value="abgelaufen">Abgelaufen</option>
            <option value="beendet">Beendet</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open, onClose, projekte,
}: {
  open: boolean; onClose: () => void; projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const [projektId, setProjektId] = useState("");
  const [regime, setRegime] = useState("vob");
  const [startDatum, setStartDatum] = useState("");
  const [fristJahre, setFristJahre] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/gewaehrleistung", {
        body: {
          projekt_id: projektId,
          regime: regime as GewaehrleistungRead["regime"],
          start_datum: startDatum || null,
          frist_jahre: fristJahre ? parseInt(fristJahre, 10) : null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gewaehrleistung"] });
      setProjektId(""); setRegime("vob"); setStartDatum(""); setFristJahre("");
      onClose();
      toast.success("Gewährleistung angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neue Gewährleistung</DialogTitle></DialogHeader>
        <GewaehrleistungFields
          projektId={projektId} setProjektId={setProjektId}
          regime={regime} setRegime={setRegime}
          startDatum={startDatum} setStartDatum={setStartDatum}
          fristJahre={fristJahre} setFristJahre={setFristJahre}
          projekte={projekte}
          showProjekt showStatus={false}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!projektId || !regime || create.isPending} onClick={() => create.mutate()}>
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditDialog({
  entry, projekte, onClose,
}: {
  entry: GewaehrleistungRead; projekte: ProjektRead[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [regime, setRegime] = useState<string>(entry.regime);
  const [startDatum, setStartDatum] = useState(entry.start_datum ? String(entry.start_datum) : "");
  const [fristJahre, setFristJahre] = useState(entry.frist_jahre ? String(entry.frist_jahre) : "");
  const [status, setStatus] = useState<string>(entry.status);

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/gewaehrleistung/{id}", {
        params: { path: { id: entry.id } },
        body: {
          row_version: entry.row_version,
          frist_jahre: fristJahre ? parseInt(fristJahre, 10) : null,
          start_datum: startDatum || null,
          status: status as GewaehrleistungRead["status"],
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gewaehrleistung"] });
      toast.success("Gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Gewährleistung bearbeiten</DialogTitle></DialogHeader>
        <GewaehrleistungFields
          projektId={entry.projekt_id} setProjektId={() => undefined}
          regime={regime} setRegime={setRegime}
          startDatum={startDatum} setStartDatum={setStartDatum}
          fristJahre={fristJahre} setFristJahre={setFristJahre}
          status={status} setStatus={setStatus}
          projekte={projekte}
          showProjekt={false}
          showStatus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={update.isPending} onClick={() => update.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GewaehrleistungList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editEntry, setEditEntry] = useState<GewaehrleistungRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GewaehrleistungRead | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: eintraege, isLoading } = useQuery<GewaehrleistungRead[]>({
    queryKey: ["gewaehrleistung", statusFilter],
    queryFn: async () => {
      const res = await apiClient.GET("/api/gewaehrleistung", {
        params: statusFilter ? { query: { status: statusFilter } } : {},
      });
      return unwrap(res) as GewaehrleistungRead[];
    },
  });

  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.DELETE("/api/gewaehrleistung/{id}", {
        params: { path: { id } },
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gewaehrleistung"] });
      setDeleteTarget(null);
      toast.success("Gewährleistung entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  // Count expiring soon (laufend, frist_ende within 90 days)
  const expiringSoon = (eintraege ?? []).filter((e) => {
    if (e.status !== "laufend" || !e.frist_ende) return false;
    const d = daysUntil(String(e.frist_ende));
    return d !== null && d >= 0 && d <= 90;
  }).length;

  const overdue = (eintraege ?? []).filter((e) => {
    if (e.status !== "laufend" || !e.frist_ende) return false;
    const d = daysUntil(String(e.frist_ende));
    return d !== null && d < 0;
  }).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Gewährleistung</h1>
          {eintraege && (
            <span className="text-sm text-muted-foreground">
              ({eintraege.length}
              {overdue > 0 && <> · <span className="text-red-600">{overdue} überfällig</span></>}
              {expiringSoon > 0 && <> · <span className="text-orange-600">{expiringSoon} läuft bald ab</span></>}
              )
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Alle Status</option>
            <option value="laufend">Laufend</option>
            <option value="abgelaufen">Abgelaufen</option>
            <option value="beendet">Beendet</option>
          </select>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neue Gewährleistung
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !eintraege?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Shield className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {statusFilter ? "Keine Einträge mit diesem Status." : "Noch keine Gewährleistungen."}
          </p>
          {!statusFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Erste Gewährleistung anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projekt</TableHead>
                <TableHead className="w-20">Regime</TableHead>
                <TableHead className="w-24">Start</TableHead>
                <TableHead className="w-20 text-center">Frist (J.)</TableHead>
                <TableHead className="w-36">Fristende</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {eintraege.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm font-medium">
                    {projMap.get(e.projekt_id) ?? e.projekt_id.slice(0, 8)}
                  </TableCell>
                  <TableCell><RegimeBadge regime={e.regime} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(e.start_datum ? String(e.start_datum) : null)}
                  </TableCell>
                  <TableCell className="text-sm text-center text-muted-foreground">
                    {e.frist_jahre ?? "—"}
                  </TableCell>
                  <TableCell><FristEndeCell entry={e} /></TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setEditEntry(e)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(e)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projekte={projekte ?? []}
      />
      {editEntry && (
        <EditDialog
          entry={editEntry}
          projekte={projekte ?? []}
          onClose={() => setEditEntry(null)}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Gewährleistung entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Der Eintrag für{" "}
            <span className="font-medium">
              {deleteTarget ? projMap.get(deleteTarget.projekt_id) ?? "dieses Projekt" : ""}
            </span>{" "}
            wird entfernt.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Abbrechen</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              Entfernen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
