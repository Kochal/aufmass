import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShoppingCart, Pencil, Trash2, Plus, PackageCheck,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { components } from "@/api/schema";

type BestellungRead = components["schemas"]["BestellungRead"];
type BestellpositionRead = components["schemas"]["BestellpositionRead"];
type LieferantRead = components["schemas"]["LieferantRead"];
type MaterialRead = components["schemas"]["MaterialRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

// ── Constants ─────────────────────────────────────────────────────────────────

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

// Next valid transitions per status (terminal states have none)
const NEXT_TRANSITIONS: Record<string, string[]> = {
  entwurf: ["bestellt"],
  bestellt: ["teilgeliefert", "geliefert"],
  teilgeliefert: ["geliefert"],
  geliefert: [],
  storniert: [],
};

const TERMINAL = new Set(["geliefert", "storniert"]);

// Positions editable only in draft/ordered
const EDITABLE_STATUSES = new Set(["entwurf", "bestellt"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtQty(menge: string | number, einheit: string): string {
  return `${Number(menge).toLocaleString("de-DE", { maximumFractionDigits: 3 })} ${einheit}`;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Stornieren dialog (needs reason) ─────────────────────────────────────────

function StornierenDialog({
  bestellung, onClose,
}: {
  bestellung: BestellungRead; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const stornieren = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PATCH("/api/bestellung/{id}/status", {
        params: { path: { id: bestellung.id } },
        body: { status: "storniert", row_version: bestellung.row_version, reason: reason || null },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bestellung", bestellung.id] });
      qc.invalidateQueries({ queryKey: ["bestellung"] });
      toast.success("Bestellung storniert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Bestellung stornieren?</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Die Stornierung wird im Audit-Log festgehalten.
          </p>
          <div>
            <label htmlFor="stor-reason" className="text-sm font-medium">Begründung</label>
            <textarea id="stor-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              rows={3} placeholder="Warum wird die Bestellung storniert?"
              className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button variant="destructive" disabled={stornieren.isPending} onClick={() => stornieren.mutate()}>
            Stornieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bestellung header (editable) ──────────────────────────────────────────────

function BestellungHeader({
  bestellung, lieferanten, projekte,
}: {
  bestellung: BestellungRead; lieferanten: LieferantRead[]; projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [lieferantId, setLieferantId] = useState(bestellung.lieferant_id);
  const [projektId, setProjektId] = useState(bestellung.projekt_id ?? "");
  const [bestelldatum, setBestelldatum] = useState(
    bestellung.bestelldatum ? String(bestellung.bestelldatum) : ""
  );
  const [summe, setSumme] = useState(bestellung.summe != null ? String(bestellung.summe) : "");
  const [showStornieren, setShowStornieren] = useState(false);

  const lfMap = new Map(lieferanten.map((lf) => [lf.id, lf.name]));
  const projMap = new Map(projekte.map((p) => [p.id, p.name]));

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/bestellung/{id}", {
        params: { path: { id: bestellung.id } },
        body: {
          row_version: bestellung.row_version,
          lieferant_id: lieferantId,
          projekt_id: projektId || null,
          bestelldatum: bestelldatum || null,
          summe: (summe ? summe : null) as unknown as number | null,
          auftragsbestaetigung_document_id: bestellung.auftragsbestaetigung_document_id ?? null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bestellung", bestellung.id] });
      qc.invalidateQueries({ queryKey: ["bestellung"] });
      setEditing(false);
      toast.success("Gespeichert.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: string) => {
      const res = await apiClient.PATCH("/api/bestellung/{id}/status", {
        params: { path: { id: bestellung.id } },
        body: { status: nextStatus as BestellungRead["status"], row_version: bestellung.row_version, reason: null },
      });
      return unwrap(res);
    },
    onSuccess: (_, nextStatus) => {
      qc.invalidateQueries({ queryKey: ["bestellung", bestellung.id] });
      qc.invalidateQueries({ queryKey: ["bestellung"] });
      toast.success(`Status: ${STATUS_LABELS[nextStatus] ?? nextStatus}`);
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const nextTransitions = NEXT_TRANSITIONS[bestellung.status] ?? [];
  const canEdit = !TERMINAL.has(bestellung.status);

  if (editing) {
    return (
      <div className="rounded-md border p-4 mb-6 bg-card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bh-lf" className="text-sm font-medium">Lieferant <span className="text-destructive">*</span></label>
            <Combobox
              className="mt-1"
              options={lieferanten.map((lf) => ({ value: lf.id, label: lf.name }))}
              value={lieferantId}
              onChange={(v) => setLieferantId(v)}
              placeholder="— wählen —"
            />
          </div>
          <div>
            <label htmlFor="bh-proj" className="text-sm font-medium">Projekt</label>
            <Combobox
              className="mt-1"
              options={projekte.map((p) => ({ value: p.id, label: p.name }))}
              value={projektId}
              onChange={(v) => setProjektId(v)}
              placeholder="— kein —"
              allowClear
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bh-datum" className="text-sm font-medium">Bestelldatum</label>
            <Input id="bh-datum" type="date" value={bestelldatum}
              onChange={(e) => setBestelldatum(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label htmlFor="bh-summe" className="text-sm font-medium">Summe (€)</label>
            <Input id="bh-summe" type="number" min={0} step={0.01} value={summe}
              onChange={(e) => setSumme(e.target.value)} placeholder="0,00" className="mt-1" />
          </div>
        </div>
        {bestellung.auftragsbestaetigung_document_id && (
          <p className="text-xs text-muted-foreground">
            Auftragsbestätigung: <code className="font-mono">{bestellung.auftragsbestaetigung_document_id}</code>
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Abbrechen</Button>
          <Button size="sm" disabled={!lieferantId || update.isPending} onClick={() => update.mutate()}>Speichern</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4 mb-6 bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{lfMap.get(bestellung.lieferant_id) ?? bestellung.lieferant_id.slice(0, 8)}</span>
            {bestellung.projekt_id && (
              <><span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{projMap.get(bestellung.projekt_id) ?? "—"}</span></>
            )}
            {bestellung.bestelldatum && (
              <><span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{fmtDate(String(bestellung.bestelldatum))}</span></>
            )}
            {bestellung.summe != null && (
              <><span className="text-muted-foreground">·</span>
              <span className="font-mono">{fmtMoney(bestellung.summe)}</span></>
            )}
          </div>

          {/* Status + lifecycle */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusBadge status={bestellung.status} />
            {nextTransitions.map((ns) => (
              <Button key={ns} size="sm" variant="outline" className="h-7 text-xs"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(ns)}>
                <PackageCheck className="h-3 w-3 mr-1" />
                → {STATUS_LABELS[ns]}
              </Button>
            ))}
            {!TERMINAL.has(bestellung.status) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => setShowStornieren(true)}>
                Stornieren
              </Button>
            )}
          </div>

          {bestellung.auftragsbestaetigung_document_id && (
            <p className="text-xs text-muted-foreground pt-1">
              AB-Dokument: <code className="font-mono">{bestellung.auftragsbestaetigung_document_id.slice(0, 8)}…</code>
            </p>
          )}
        </div>

        {canEdit && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />Bearbeiten
          </Button>
        )}
      </div>

      {showStornieren && (
        <StornierenDialog bestellung={bestellung} onClose={() => setShowStornieren(false)} />
      )}
    </div>
  );
}

// ── Add / Edit position dialogs ───────────────────────────────────────────────

interface PosFormProps {
  bezeichnung: string; setBezeichnung: (v: string) => void;
  menge: string; setMenge: (v: string) => void;
  einheit: string; setEinheit: (v: string) => void;
  einzelpreis: string; setEinzelpreis: (v: string) => void;
  posNr: string; setPosNr: (v: string) => void;
  materialId: string; setMaterialId: (v: string) => void;
  materialien: MaterialRead[];
}

function PositionFields({
  bezeichnung, setBezeichnung, menge, setMenge, einheit, setEinheit,
  einzelpreis, setEinzelpreis, posNr, setPosNr, materialId, setMaterialId,
  materialien,
}: PosFormProps) {
  function handleMaterialSelect(id: string) {
    setMaterialId(id);
    if (!id) return;
    const mat = materialien.find((m) => m.id === id);
    if (!mat) return;
    setBezeichnung(mat.bezeichnung);
    setEinheit(mat.einheit);
    if (mat.standard_preis != null) setEinzelpreis(String(mat.standard_preis));
  }

  return (
    <div className="space-y-3 py-2">
      <div>
        <label htmlFor="pos-mat" className="text-sm font-medium">Material (optional)</label>
        <Combobox
          className="mt-1"
          options={materialien.map((m) => ({ value: m.id, label: `${m.bezeichnung} (${m.einheit})` }))}
          value={materialId}
          onChange={(v) => handleMaterialSelect(v)}
          placeholder="— kein / freie Eingabe —"
          allowClear
        />
        {materialId && <p className="text-[10px] text-muted-foreground mt-0.5">Felder vorausgefüllt — können überschrieben werden.</p>}
      </div>
      <div>
        <label htmlFor="pos-bez" className="text-sm font-medium">
          Bezeichnung <span className="text-destructive">*</span>
        </label>
        <Input id="pos-bez" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)}
          placeholder="Positionsbeschreibung" className="mt-1" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="pos-menge" className="text-sm font-medium">
            Menge <span className="text-destructive">*</span>
          </label>
          <Input id="pos-menge" type="number" min={0} step={0.001} value={menge}
            onChange={(e) => setMenge(e.target.value)} placeholder="0" className="mt-1" />
        </div>
        <div>
          <label htmlFor="pos-einheit" className="text-sm font-medium">
            Einheit <span className="text-destructive">*</span>
          </label>
          <Input id="pos-einheit" value={einheit} onChange={(e) => setEinheit(e.target.value)}
            placeholder="Stk" className="mt-1" />
        </div>
        <div>
          <label htmlFor="pos-ep" className="text-sm font-medium">EP (€)</label>
          <Input id="pos-ep" type="number" min={0} step={0.01} value={einzelpreis}
            onChange={(e) => setEinzelpreis(e.target.value)} placeholder="0,00" className="mt-1" />
        </div>
      </div>
      <div className="w-1/3">
        <label htmlFor="pos-nr" className="text-sm font-medium">Pos.-Nr.</label>
        <Input id="pos-nr" type="number" min={1} value={posNr}
          onChange={(e) => setPosNr(e.target.value)} placeholder="1" className="mt-1" />
      </div>
    </div>
  );
}

function AddPositionDialog({
  open, onClose, bestellungId, materialien,
}: {
  open: boolean; onClose: () => void; bestellungId: string; materialien: MaterialRead[];
}) {
  const qc = useQueryClient();
  const [materialId, setMaterialId] = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const [menge, setMenge] = useState("");
  const [einheit, setEinheit] = useState("");
  const [einzelpreis, setEinzelpreis] = useState("");
  const [posNr, setPosNr] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/bestellposition", {
        body: {
          bestellung_id: bestellungId,
          material_id: materialId || null,
          bezeichnung,
          menge: menge as unknown as number,
          einheit,
          einzelpreis: (einzelpreis ? einzelpreis : null) as unknown as number | null,
          position_nr: posNr ? parseInt(posNr, 10) : null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bestellposition", bestellungId] });
      setMaterialId(""); setBezeichnung(""); setMenge(""); setEinheit("");
      setEinzelpreis(""); setPosNr("");
      onClose();
      toast.success("Position hinzugefügt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Position hinzufügen</DialogTitle></DialogHeader>
        <PositionFields
          bezeichnung={bezeichnung} setBezeichnung={setBezeichnung}
          menge={menge} setMenge={setMenge}
          einheit={einheit} setEinheit={setEinheit}
          einzelpreis={einzelpreis} setEinzelpreis={setEinzelpreis}
          posNr={posNr} setPosNr={setPosNr}
          materialId={materialId} setMaterialId={setMaterialId}
          materialien={materialien}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung.trim() || !menge || !einheit.trim() || create.isPending}
            onClick={() => create.mutate()}>
            Hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPositionDialog({
  position, materialien, onClose,
}: {
  position: BestellpositionRead; materialien: MaterialRead[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [materialId, setMaterialId] = useState(position.material_id ?? "");
  const [bezeichnung, setBezeichnung] = useState(position.bezeichnung);
  const [menge, setMenge] = useState(String(position.menge));
  const [einheit, setEinheit] = useState(position.einheit);
  const [einzelpreis, setEinzelpreis] = useState(position.einzelpreis != null ? String(position.einzelpreis) : "");
  const [posNr, setPosNr] = useState(position.position_nr != null ? String(position.position_nr) : "");

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/bestellposition/{id}", {
        params: { path: { id: position.id } },
        body: {
          row_version: position.row_version,
          material_id: materialId || null,
          bezeichnung,
          menge: menge as unknown as number,
          einheit,
          einzelpreis: (einzelpreis ? einzelpreis : null) as unknown as number | null,
          position_nr: posNr ? parseInt(posNr, 10) : null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bestellposition", position.bestellung_id] });
      toast.success("Position gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Position bearbeiten</DialogTitle></DialogHeader>
        <PositionFields
          bezeichnung={bezeichnung} setBezeichnung={setBezeichnung}
          menge={menge} setMenge={setMenge}
          einheit={einheit} setEinheit={setEinheit}
          einzelpreis={einzelpreis} setEinzelpreis={setEinzelpreis}
          posNr={posNr} setPosNr={setPosNr}
          materialId={materialId} setMaterialId={setMaterialId}
          materialien={materialien}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung.trim() || !menge || !einheit.trim() || update.isPending}
            onClick={() => update.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BestellungDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showAddPos, setShowAddPos] = useState(false);
  const [editPos, setEditPos] = useState<BestellpositionRead | null>(null);
  const [deletePos, setDeletePos] = useState<BestellpositionRead | null>(null);

  const { data: bestellung, isLoading: loadingBs } = useQuery<BestellungRead>({
    queryKey: ["bestellung", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/bestellung/{id}", {
      params: { path: { id: id! } },
    })) as BestellungRead,
    enabled: !!id,
  });

  const { data: positionen, isLoading: loadingPos } = useQuery<BestellpositionRead[]>({
    queryKey: ["bestellposition", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/bestellposition", {
      params: { query: { bestellung_id: id! } },
    })) as BestellpositionRead[],
    enabled: !!id,
  });

  const { data: lieferanten } = useQuery<LieferantRead[]>({
    queryKey: ["lieferant"],
    queryFn: async () => unwrap(await apiClient.GET("/api/lieferant")) as LieferantRead[],
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: materialien } = useQuery<MaterialRead[]>({
    queryKey: ["material"],
    queryFn: async () => unwrap(await apiClient.GET("/api/material")) as MaterialRead[],
  });

  const deletePosMutation = useMutation({
    mutationFn: async (posId: string) => {
      const res = await apiClient.DELETE("/api/bestellposition/{id}", { params: { path: { id: posId } } });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bestellposition", id] });
      setDeletePos(null);
      toast.success("Position entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  // Client-side position total (display only — server owns no money math for orders)
  const posTotal = (positionen ?? []).reduce((sum, p) => {
    if (p.einzelpreis == null) return sum;
    return sum + Number(p.menge) * Number(p.einzelpreis);
  }, 0);

  const canEditPositionen = bestellung ? EDITABLE_STATUSES.has(bestellung.status) : false;

  if (loadingBs) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <Skeleton className="h-8 w-40" /><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!bestellung) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-muted-foreground">Bestellung nicht gefunden.</p>
        <Link to="/office/bestellungen" className="text-sm text-primary hover:underline mt-2 inline-block">← Zurück</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/office/bestellungen"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Alle Bestellungen
      </Link>

      <BestellungHeader
        bestellung={bestellung}
        lieferanten={lieferanten ?? []}
        projekte={projekte ?? []}
      />

      {/* Positionen section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Bestellpositionen</h2>
          {positionen && (
            <span className="text-sm text-muted-foreground">
              ({positionen.length} Pos.
              {posTotal > 0 && ` · ${posTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € Summe`})
            </span>
          )}
        </div>
        {canEditPositionen && (
          <Button size="sm" onClick={() => setShowAddPos(true)}>
            <Plus className="h-4 w-4 mr-1" />Position hinzufügen
          </Button>
        )}
      </div>

      {loadingPos ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !positionen?.length ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border rounded-md">
          <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Noch keine Positionen.</p>
          {canEditPositionen && (
            <Button variant="outline" size="sm" onClick={() => setShowAddPos(true)}>
              <Plus className="h-4 w-4 mr-1" />Erste Position
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Pos.</TableHead>
                <TableHead>Bezeichnung</TableHead>
                <TableHead className="w-32 text-right">Menge</TableHead>
                <TableHead className="w-24 text-right">EP (€)</TableHead>
                <TableHead className="w-28 text-right">Gesamt (€)</TableHead>
                {canEditPositionen && <TableHead className="w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {positionen.map((pos) => {
                const gesamt = pos.einzelpreis != null
                  ? Number(pos.menge) * Number(pos.einzelpreis)
                  : null;
                return (
                  <TableRow key={pos.id}>
                    <TableCell className="text-sm text-muted-foreground text-center">
                      {pos.position_nr ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{pos.bezeichnung}</TableCell>
                    <TableCell className="text-sm font-mono text-right">{fmtQty(pos.menge, pos.einheit)}</TableCell>
                    <TableCell className="text-sm font-mono text-right">{fmtMoney(pos.einzelpreis)}</TableCell>
                    <TableCell className="text-sm font-mono text-right">{fmtMoney(gesamt)}</TableCell>
                    {canEditPositionen && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditPos(pos)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeletePos(pos)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {positionen.length > 0 && (
                <TableRow className="border-t-2">
                  <TableCell colSpan={canEditPositionen ? 4 : 3} />
                  <TableCell className="text-sm font-semibold font-mono text-right">
                    {posTotal > 0 ? posTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—"}
                  </TableCell>
                  {canEditPositionen && <TableCell />}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!canEditPositionen && bestellung.status !== "storniert" && (
        <p className="text-xs text-muted-foreground mt-2">
          Positionen können nur im Status Entwurf oder Bestellt bearbeitet werden.
        </p>
      )}

      {showAddPos && (
        <AddPositionDialog open={showAddPos} onClose={() => setShowAddPos(false)}
          bestellungId={bestellung.id} materialien={materialien ?? []} />
      )}
      {editPos && (
        <EditPositionDialog position={editPos} materialien={materialien ?? []} onClose={() => setEditPos(null)} />
      )}

      <Dialog open={!!deletePos} onOpenChange={(o) => !o && setDeletePos(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Position entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{deletePos?.bezeichnung}</span> wird entfernt.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePos(null)}>Abbrechen</Button>
            <Button variant="destructive" disabled={deletePosMutation.isPending}
              onClick={() => deletePos && deletePosMutation.mutate(deletePos.id)}>
              Entfernen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
