import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigation, Plus, CheckCircle2, AlertCircle } from "lucide-react";
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

type FahrtRead = components["schemas"]["FahrtRead"];
type FahrzeugRead = components["schemas"]["FahrzeugRead"];
type AppUserRead = components["schemas"]["AppUserRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dt: string): string {
  return new Date(dt).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function fmtKm(km: string | number): string {
  return `${Number(km).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} km`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

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

// ── Shared form fields ────────────────────────────────────────────────────────

interface FahrtFormProps {
  users: AppUserRead[];
  fahrzeuge: FahrzeugRead[];
  projekte: ProjektRead[];
  userId: string; setUserId: (v: string) => void;
  fahrzeugId: string; setFahrzeugId: (v: string) => void;
  projektId: string; setProjektId: (v: string) => void;
  datum: string; setDatum: (v: string) => void;
  von: string; setVon: (v: string) => void;
  nach: string; setNach: (v: string) => void;
  km: string; setKm: (v: string) => void;
  zweck: string; setZweck: (v: string) => void;
  showUser?: boolean;
}

function FahrtFields({
  users, fahrzeuge, projekte,
  userId, setUserId, fahrzeugId, setFahrzeugId, projektId, setProjektId,
  datum, setDatum, von, setVon, nach, setNach, km, setKm, zweck, setZweck,
  showUser = true,
}: FahrtFormProps) {
  return (
    <div className="space-y-3 py-2">
      {showUser && (
        <div>
          <label htmlFor="ft-user" className="text-sm font-medium">
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
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ft-fz" className="text-sm font-medium">Fahrzeug</label>
          <Combobox
            className="mt-1"
            options={fahrzeuge.map((fz) => ({ value: fz.id, label: fz.kennzeichen }))}
            value={fahrzeugId}
            onChange={(v) => setFahrzeugId(v)}
            placeholder="— kein —"
            allowClear
          />
        </div>
        <div>
          <label htmlFor="ft-datum" className="text-sm font-medium">
            Datum <span className="text-destructive">*</span>
          </label>
          <Input
            id="ft-datum"
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label htmlFor="ft-proj" className="text-sm font-medium">Projekt</label>
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
          <label htmlFor="ft-von" className="text-sm font-medium">Von</label>
          <Input id="ft-von" value={von} onChange={(e) => setVon(e.target.value)}
            placeholder="Abfahrtsort" className="mt-1" />
        </div>
        <div>
          <label htmlFor="ft-nach" className="text-sm font-medium">Nach</label>
          <Input id="ft-nach" value={nach} onChange={(e) => setNach(e.target.value)}
            placeholder="Zielort" className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ft-km" className="text-sm font-medium">
            Kilometer <span className="text-destructive">*</span>
          </label>
          <Input id="ft-km" type="number" min={0} step={0.1} value={km}
            onChange={(e) => setKm(e.target.value)} placeholder="0.0" className="mt-1" />
        </div>
        <div>
          <label htmlFor="ft-zweck" className="text-sm font-medium">Zweck</label>
          <Input id="ft-zweck" value={zweck} onChange={(e) => setZweck(e.target.value)}
            placeholder="z.B. Baustelle X" className="mt-1" />
        </div>
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open, onClose, users, fahrzeuge, projekte,
}: {
  open: boolean; onClose: () => void;
  users: AppUserRead[]; fahrzeuge: FahrzeugRead[]; projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [userId, setUserId] = useState("");
  const [fahrzeugId, setFahrzeugId] = useState("");
  const [projektId, setProjektId] = useState("");
  const [datum, setDatum] = useState(today);
  const [von, setVon] = useState("");
  const [nach, setNach] = useState("");
  const [km, setKm] = useState("");
  const [zweck, setZweck] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/fahrt", {
        body: {
          app_user_id: userId,
          fahrzeug_id: fahrzeugId || null,
          projekt_id: projektId || null,
          datum,
          von: von || null,
          nach: nach || null,
          km: km as unknown as number,
          zweck: zweck || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrt"] });
      setUserId(""); setFahrzeugId(""); setProjektId(""); setDatum(today);
      setVon(""); setNach(""); setKm(""); setZweck("");
      onClose();
      toast.success("Fahrt gespeichert.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neue Fahrt</DialogTitle></DialogHeader>
        <FahrtFields
          users={users} fahrzeuge={fahrzeuge} projekte={projekte}
          userId={userId} setUserId={setUserId}
          fahrzeugId={fahrzeugId} setFahrzeugId={setFahrzeugId}
          projektId={projektId} setProjektId={setProjektId}
          datum={datum} setDatum={setDatum}
          von={von} setVon={setVon}
          nach={nach} setNach={setNach}
          km={km} setKm={setKm}
          zweck={zweck} setZweck={setZweck}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            disabled={!userId || !datum || !km || create.isPending}
            onClick={() => create.mutate()}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Korrektur dialog ──────────────────────────────────────────────────────────

function KorrekturDialog({
  fahrt, fahrzeuge, projekte, onClose,
}: {
  fahrt: FahrtRead; fahrzeuge: FahrzeugRead[]; projekte: ProjektRead[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [fahrzeugId, setFahrzeugId] = useState(fahrt.fahrzeug_id ?? "");
  const [projektId, setProjektId] = useState(fahrt.projekt_id ?? "");
  const [datum, setDatum] = useState(String(fahrt.datum));
  const [von, setVon] = useState(fahrt.von ?? "");
  const [nach, setNach] = useState(fahrt.nach ?? "");
  const [km, setKm] = useState(String(fahrt.km));
  const [zweck, setZweck] = useState(fahrt.zweck ?? "");

  const korrektur = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/fahrt/{id}/korrektur", {
        params: { path: { id: fahrt.id } },
        body: {
          fahrzeug_id: fahrzeugId || null,
          projekt_id: projektId || null,
          datum,
          von: von || null,
          nach: nach || null,
          km: km as unknown as number,
          zweck: zweck || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrt"] });
      toast.success("Korrektur gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Korrektur zu {fmtDate(String(fahrt.datum))}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2 pb-1">
          Erzeugt einen neuen Eintrag, der den freigegebenen ersetzt.
        </p>
        <FahrtFields
          users={[]} fahrzeuge={fahrzeuge} projekte={projekte}
          userId="" setUserId={() => undefined}
          fahrzeugId={fahrzeugId} setFahrzeugId={setFahrzeugId}
          projektId={projektId} setProjektId={setProjektId}
          datum={datum} setDatum={setDatum}
          von={von} setVon={setVon}
          nach={nach} setNach={setNach}
          km={km} setKm={setKm}
          zweck={zweck} setZweck={setZweck}
          showUser={false}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!datum || !km || korrektur.isPending} onClick={() => korrektur.mutate()}>
            Korrektur speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FahrtzeitenList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [korrekturFahrt, setKorrekturFahrt] = useState<FahrtRead | null>(null);
  const [freigabeFilter, setFreigabeFilter] = useState<"" | "offen" | "freigegeben">("");
  const [projektFilter, setProjektFilter] = useState("");

  const { data: users } = useQuery<AppUserRead[]>({
    queryKey: ["app-user"],
    queryFn: async () => unwrap(await apiClient.GET("/api/app-user")) as AppUserRead[],
  });

  const { data: fahrzeuge } = useQuery<FahrzeugRead[]>({
    queryKey: ["fahrzeug"],
    queryFn: async () => unwrap(await apiClient.GET("/api/fahrzeug")) as FahrzeugRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: fahrten, isLoading } = useQuery<FahrtRead[]>({
    queryKey: ["fahrt", freigabeFilter, projektFilter],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (freigabeFilter) query.freigabe_status = freigabeFilter;
      if (projektFilter) query.projekt_id = projektFilter;
      const res = await apiClient.GET("/api/fahrt", {
        params: Object.keys(query).length ? { query } : {},
      });
      return unwrap(res) as FahrtRead[];
    },
  });

  const userMap = new Map(users?.map((u) => [u.id, u.display_name ?? u.email]) ?? []);
  const fzMap = new Map(fahrzeuge?.map((fz) => [fz.id, fz.kennzeichen]) ?? []);
  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  const freigebeMutation = useMutation({
    mutationFn: async ({ id, row_version }: { id: string; row_version: number }) => {
      const res = await apiClient.PATCH("/api/fahrt/{id}/freigabe", {
        params: { path: { id } },
        body: { row_version },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrt"] });
      toast.success("Freigegeben.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const totalKm = fahrten?.reduce((sum, f) => sum + Number(f.km), 0) ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Fahrtzeiten</h1>
          {fahrten && (
            <span className="text-sm text-muted-foreground">
              ({fahrten.length} Einträge
              {totalKm > 0 ? ` · ${totalKm.toLocaleString("de-DE", { maximumFractionDigits: 0 })} km` : ""})
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
            Neue Fahrt
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !fahrten?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Navigation className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {freigabeFilter || projektFilter
              ? "Keine Fahrten für diesen Filter."
              : "Noch keine Fahrten eingetragen."}
          </p>
          {!freigabeFilter && !projektFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Erste Fahrt eintragen
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
                <TableHead className="w-28">Fahrzeug</TableHead>
                <TableHead>Projekt</TableHead>
                <TableHead>Von → Nach</TableHead>
                <TableHead className="w-20 text-right">km</TableHead>
                <TableHead className="w-28">Zweck</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fahrten.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-sm">{fmtDate(String(f.datum))}</TableCell>
                  <TableCell className="text-sm">
                    {userMap.get(f.app_user_id) ?? f.app_user_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {f.fahrzeug_id ? fzMap.get(f.fahrzeug_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.projekt_id ? projMap.get(f.projekt_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.von && f.nach ? `${f.von} → ${f.nach}` : f.von ?? f.nach ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right">
                    {fmtKm(f.km)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.zweck ?? "—"}
                  </TableCell>
                  <TableCell><FreigabeBadge status={f.freigabe_status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {f.freigabe_status === "offen" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={freigebeMutation.isPending}
                          onClick={() =>
                            freigebeMutation.mutate({ id: f.id, row_version: f.row_version })
                          }
                        >
                          Freigeben
                        </Button>
                      )}
                      {f.freigabe_status === "freigegeben" && !f.korrektur_von_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => setKorrekturFahrt(f)}
                        >
                          Korrektur
                        </Button>
                      )}
                      {f.korrektur_von_id && (
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
        fahrzeuge={fahrzeuge ?? []}
        projekte={projekte ?? []}
      />
      {korrekturFahrt && (
        <KorrekturDialog
          fahrt={korrekturFahrt}
          fahrzeuge={fahrzeuge ?? []}
          projekte={projekte ?? []}
          onClose={() => setKorrekturFahrt(null)}
        />
      )}
    </div>
  );
}
