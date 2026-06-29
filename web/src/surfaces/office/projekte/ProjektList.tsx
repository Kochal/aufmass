import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
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
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber");
      return unwrap(res) as AuftraggeberRead[];
    },
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
        <DialogHeader>
          <DialogTitle>Neues Projekt</DialogTitle>
        </DialogHeader>
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
            <select
              id="proj-ag"
              value={auftraggeberId}
              onChange={(e) => setAuftraggeberId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— wählen —</option>
              {auftraggeber?.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                  {ag.kundennummer ? ` (${ag.kundennummer})` : ""}
                </option>
              ))}
            </select>
            {!auftraggeber?.length && (
              <p className="text-xs text-muted-foreground mt-1">
                Noch kein Auftraggeber angelegt.{" "}
                <Link to="/office/auftraggeber" className="underline">
                  Jetzt anlegen
                </Link>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!canSubmit} onClick={() => create.mutate()}>
            Anlegen
          </Button>
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
  const [statusFilter, setStatusFilter] = useState<ProjektStatus | "">("");

  const { data: projekte, isLoading } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", statusFilter],
    queryFn: async () => {
      const res = await apiClient.GET("/api/projekt", {
        params: statusFilter ? { query: { status: statusFilter } } : {},
      });
      return unwrap(res) as ProjektRead[];
    },
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber");
      return unwrap(res) as AuftraggeberRead[];
    },
  });

  const agMap = new Map(auftraggeber?.map((ag) => [ag.id, ag.name]) ?? []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Projekte</h1>
          {projekte && (
            <span className="text-sm text-muted-foreground">({projekte.length})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjektStatus | "")}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Alle Status</option>
            {(Object.keys(STATUS_LABELS) as ProjektStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neues Projekt
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !projekte?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {statusFilter
              ? `Keine Projekte mit Status „${STATUS_LABELS[statusFilter as ProjektStatus]}".`
              : "Noch keine Projekte angelegt."}
          </p>
          {!statusFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Erstes Projekt anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Nr.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Auftraggeber</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-24">Start</TableHead>
                <TableHead className="w-24">Ende</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projekte.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/projekte/${p.id}`)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.nummer ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {agMap.get(p.auftraggeber_id) ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.start_datum ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.end_datum ?? "—"}
                  </TableCell>
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
