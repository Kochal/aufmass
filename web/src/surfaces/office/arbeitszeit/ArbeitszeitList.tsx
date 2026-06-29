import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { components } from "@/api/schema";

type ArbeitszeitRead = components["schemas"]["ArbeitszeitRead"];
type AppUserRead = components["schemas"]["AppUserRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

// ── helpers ──────────────────────────────────────────────────────────────────

/** Format a PostgreSQL interval string "HH:MM:SS" → "8 h 30 min" */
function fmtDauer(dauer: string | null | undefined): string {
  if (!dauer) return "—";
  // Postgres returns intervals as "HH:MM:SS" or "H:MM:SS"
  const parts = dauer.split(":");
  if (parts.length < 2) return dauer;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function fmtDate(dt: string): string {
  return new Date(dt).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function fmtTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Convert local datetime-local input value to UTC ISO string
function localToISO(val: string): string {
  if (!val) return "";
  return new Date(val).toISOString();
}

// Convert UTC ISO string to datetime-local value (YYYY-MM-DDTHH:mm)
function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Status badge ─────────────────────────────────────────────────────────────

function FreigabeBadge({ status }: { status: "offen" | "freigegeben" }) {
  if (status === "freigegeben") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle2 className="h-3 w-3" />
        Freigegeben
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800">
      <AlertCircle className="h-3 w-3" />
      Offen
    </span>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onClose,
  users,
  projekte,
}: {
  open: boolean;
  onClose: () => void;
  users: AppUserRead[];
  projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [projektId, setProjektId] = useState("");
  const [startZeit, setStartZeit] = useState("");
  const [endZeit, setEndZeit] = useState("");
  const [pauseMin, setPauseMin] = useState("0");
  const [art, setArt] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/arbeitszeit", {
        body: {
          app_user_id: userId,
          projekt_id: projektId || null,
          start_zeit: localToISO(startZeit),
          end_zeit: endZeit ? localToISO(endZeit) : null,
          pause_minuten: parseInt(pauseMin, 10) || 0,
          art: art || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["arbeitszeit"] });
      setUserId(""); setProjektId(""); setStartZeit(""); setEndZeit("");
      setPauseMin("0"); setArt("");
      onClose();
      toast.success("Eintrag gespeichert.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neue Arbeitszeit</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="az-user" className="text-sm font-medium">
              Mitarbeiter <span className="text-destructive">*</span>
            </label>
            <Combobox
              className="mt-1"
              options={users.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))}
              value={userId}
              onChange={(v) => setUserId(v)}
              placeholder="— wählen —"
            />
          </div>
          <div>
            <label htmlFor="az-proj" className="text-sm font-medium">Projekt</label>
            <Combobox
              className="mt-1"
              options={projekte.map((p) => ({ value: p.id, label: p.name }))}
              value={projektId}
              onChange={(v) => setProjektId(v)}
              placeholder="— kein —"
              allowClear
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="az-start" className="text-sm font-medium">
                Beginn <span className="text-destructive">*</span>
              </label>
              <Input
                id="az-start"
                type="datetime-local"
                value={startZeit}
                onChange={(e) => setStartZeit(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="az-end" className="text-sm font-medium">Ende</label>
              <Input
                id="az-end"
                type="datetime-local"
                value={endZeit}
                onChange={(e) => setEndZeit(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="az-pause" className="text-sm font-medium">Pause (min)</label>
              <Input
                id="az-pause"
                type="number"
                min={0}
                value={pauseMin}
                onChange={(e) => setPauseMin(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="az-art" className="text-sm font-medium">Art</label>
              <Input
                id="az-art"
                value={art}
                onChange={(e) => setArt(e.target.value)}
                placeholder="z.B. Malerarbeit"
                className="mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!userId || !startZeit || create.isPending} onClick={() => create.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Korrektur dialog ──────────────────────────────────────────────────────────

function KorrekturDialog({
  entry,
  projekte,
  onClose,
}: {
  entry: ArbeitszeitRead;
  projekte: ProjektRead[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [projektId, setProjektId] = useState(entry.projekt_id ?? "");
  const [startZeit, setStartZeit] = useState(isoToLocal(entry.start_zeit));
  const [endZeit, setEndZeit] = useState(isoToLocal(entry.end_zeit));
  const [pauseMin, setPauseMin] = useState(String(entry.pause_minuten));
  const [art, setArt] = useState(entry.art ?? "");

  const korrektur = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/arbeitszeit/{id}/korrektur", {
        params: { path: { id: entry.id } },
        body: {
          start_zeit: localToISO(startZeit),
          end_zeit: endZeit ? localToISO(endZeit) : null,
          pause_minuten: parseInt(pauseMin, 10) || 0,
          art: art || null,
          projekt_id: projektId || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["arbeitszeit"] });
      toast.success("Korrektur gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Korrektur zu {fmtDate(entry.start_zeit)}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2 pb-1">
          Erzeugt einen neuen Eintrag, der den freigegebenen ersetzt.
        </p>
        <div className="space-y-3 py-1">
          <div>
            <label htmlFor="korr-proj" className="text-sm font-medium">Projekt</label>
            <Combobox
              className="mt-1"
              options={projekte.map((p) => ({ value: p.id, label: p.name }))}
              value={projektId}
              onChange={(v) => setProjektId(v)}
              placeholder="— kein —"
              allowClear
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="korr-start" className="text-sm font-medium">Beginn</label>
              <Input id="korr-start" type="datetime-local" value={startZeit}
                onChange={(e) => setStartZeit(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label htmlFor="korr-end" className="text-sm font-medium">Ende</label>
              <Input id="korr-end" type="datetime-local" value={endZeit}
                onChange={(e) => setEndZeit(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="korr-pause" className="text-sm font-medium">Pause (min)</label>
              <Input id="korr-pause" type="number" min={0} value={pauseMin}
                onChange={(e) => setPauseMin(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label htmlFor="korr-art" className="text-sm font-medium">Art</label>
              <Input id="korr-art" value={art} onChange={(e) => setArt(e.target.value)}
                placeholder="z.B. Malerarbeit" className="mt-1" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!startZeit || korrektur.isPending} onClick={() => korrektur.mutate()}>
            Korrektur speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ArbeitszeitList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [korrekturEntry, setKorrekturEntry] = useState<ArbeitszeitRead | null>(null);
  const [freigabeFilter, setFreigabeFilter] = useState<"" | "offen" | "freigegeben">("");
  const [projektFilter, setProjektFilter] = useState("");

  const { data: users } = useQuery<AppUserRead[]>({
    queryKey: ["app-user"],
    queryFn: async () => unwrap(await apiClient.GET("/api/app-user")) as AppUserRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: eintraege, isLoading } = useQuery<ArbeitszeitRead[]>({
    queryKey: ["arbeitszeit", freigabeFilter, projektFilter],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (freigabeFilter) query.freigabe_status = freigabeFilter;
      if (projektFilter) query.projekt_id = projektFilter;
      const res = await apiClient.GET("/api/arbeitszeit", {
        params: Object.keys(query).length ? { query } : {},
      });
      return unwrap(res) as ArbeitszeitRead[];
    },
  });

  const userMap = new Map(users?.map((u) => [u.id, u.display_name ?? u.email]) ?? []);
  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  const freigebeMutation = useMutation({
    mutationFn: async ({ id, row_version }: { id: string; row_version: number }) => {
      const res = await apiClient.PATCH("/api/arbeitszeit/{id}/freigabe", {
        params: { path: { id } },
        body: { row_version },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["arbeitszeit"] });
      toast.success("Freigegeben.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  // Summarise total hours for the current filter
  const totalMinutes = eintraege?.reduce((sum, e) => {
    if (!e.dauer) return sum;
    const parts = e.dauer.split(":");
    return sum + parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }, 0) ?? 0;
  const totalH = Math.floor(totalMinutes / 60);
  const totalM = totalMinutes % 60;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Arbeitszeit</h1>
          {eintraege && (
            <span className="text-sm text-muted-foreground">
              ({eintraege.length} Einträge
              {totalMinutes > 0 ? ` · ${totalH} h ${totalM} min` : ""})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Combobox
            className="w-40"
            options={[
              { value: "offen", label: "Offen" },
              { value: "freigegeben", label: "Freigegeben" },
            ]}
            value={freigabeFilter}
            onChange={(v) => setFreigabeFilter(v as "" | "offen" | "freigegeben")}
            placeholder="Alle Status"
            allowClear
          />
          <Combobox
            className="w-48"
            options={projekte?.map((p) => ({ value: p.id, label: p.name })) ?? []}
            value={projektFilter}
            onChange={(v) => setProjektFilter(v)}
            placeholder="Alle Projekte"
            allowClear
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neuer Eintrag
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !eintraege?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {freigabeFilter || projektFilter
              ? "Keine Einträge für diesen Filter."
              : "Noch keine Arbeitszeiteinträge."}
          </p>
          {!freigabeFilter && !projektFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Ersten Eintrag anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Datum</TableHead>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead>Projekt</TableHead>
                <TableHead className="w-16">Beginn</TableHead>
                <TableHead className="w-16">Ende</TableHead>
                <TableHead className="w-20">Dauer</TableHead>
                <TableHead className="w-28">Art</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {eintraege.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{fmtDate(e.start_zeit)}</TableCell>
                  <TableCell className="text-sm">{userMap.get(e.app_user_id) ?? e.app_user_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.projekt_id ? projMap.get(e.projekt_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{fmtTime(e.start_zeit)}</TableCell>
                  <TableCell className="text-sm font-mono">{fmtTime(e.end_zeit)}</TableCell>
                  <TableCell className="text-sm font-mono">{fmtDauer(e.dauer)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.art ?? "—"}</TableCell>
                  <TableCell><FreigabeBadge status={e.freigabe_status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {e.freigabe_status === "offen" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={freigebeMutation.isPending}
                          onClick={() => freigebeMutation.mutate({ id: e.id, row_version: e.row_version })}
                        >
                          Freigeben
                        </Button>
                      )}
                      {e.freigabe_status === "freigegeben" && !e.korrektur_von_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => setKorrekturEntry(e)}
                        >
                          Korrektur
                        </Button>
                      )}
                      {e.korrektur_von_id && (
                        <span className="text-[10px] text-muted-foreground italic">Korrektur</span>
                      )}
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
        users={users ?? []}
        projekte={projekte ?? []}
      />
      {korrekturEntry && (
        <KorrekturDialog
          entry={korrekturEntry}
          projekte={projekte ?? []}
          onClose={() => setKorrekturEntry(null)}
        />
      )}
    </div>
  );
}
