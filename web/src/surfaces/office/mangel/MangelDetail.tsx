import { useState, useRef, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, ClipboardCheck, Camera, X, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap, getAuthHeaders } from "@/lib/api";
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

type MangelFotoRead = components["schemas"]["MangelFotoRead"];

type AbnahmeprotokollRead = components["schemas"]["AbnahmeprotokollRead"];
type MangelRead = components["schemas"]["MangelRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

// ── Constants ─────────────────────────────────────────────────────────────────

const ART_LABELS: Record<string, string> = {
  foermlich: "Förmlich",
  fiktiv: "Fiktiv (§ 640 BGB)",
  konkludent: "Konkludent",
  bgb: "BGB-Abnahme",
};

const SCHWERE_LABELS: Record<string, string> = {
  gering: "Gering",
  mittel: "Mittel",
  schwer: "Schwer",
};

const STATUS_LABELS: Record<string, string> = {
  offen: "Offen",
  behoben: "Behoben",
  abgelehnt: "Abgelehnt",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ── Status badges ─────────────────────────────────────────────────────────────

function SchwereBadge({ schwere }: { schwere: string | null | undefined }) {
  if (!schwere) return <span className="text-sm text-muted-foreground">—</span>;
  const colors: Record<string, string> = {
    gering: "bg-blue-100 text-blue-800",
    mittel: "bg-orange-100 text-orange-800",
    schwer: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[schwere] ?? "bg-muted text-muted-foreground"}`}>
      {SCHWERE_LABELS[schwere] ?? schwere}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    offen: "bg-yellow-100 text-yellow-800",
    behoben: "bg-green-100 text-green-800",
    abgelehnt: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Mangel form (shared by Create + Edit) ─────────────────────────────────────

interface MangelFormValues {
  beschreibung: string; setBeschreibung: (v: string) => void;
  ort: string; setOrt: (v: string) => void;
  schwere: string; setSchwere: (v: string) => void;
  frist: string; setFrist: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  behobenAm: string; setBehobenAm: (v: string) => void;
  showStatus?: boolean;
}

function MangelFormFields({
  beschreibung, setBeschreibung, ort, setOrt, schwere, setSchwere,
  frist, setFrist, status, setStatus, behobenAm, setBehobenAm,
  showStatus = false,
}: MangelFormValues) {
  return (
    <div className="space-y-3 py-2">
      <div>
        <label htmlFor="mg-beschr" className="text-sm font-medium">
          Beschreibung <span className="text-destructive">*</span>
        </label>
        <textarea
          id="mg-beschr"
          value={beschreibung}
          onChange={(e) => setBeschreibung(e.target.value)}
          placeholder="Mangelbeschreibung"
          rows={3}
          className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="mg-ort" className="text-sm font-medium">Ort / Raum</label>
          <Input id="mg-ort" value={ort} onChange={(e) => setOrt(e.target.value)}
            placeholder="z.B. EG Wohnzimmer" className="mt-1" />
        </div>
        <div>
          <label htmlFor="mg-schwere" className="text-sm font-medium">Schwere</label>
          <Combobox
            className="mt-1"
            options={[
              { value: "gering", label: "Gering" },
              { value: "mittel", label: "Mittel" },
              { value: "schwer", label: "Schwer" },
            ]}
            value={schwere}
            onChange={(v) => setSchwere(v)}
            placeholder="— keine —"
            allowClear
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="mg-frist" className="text-sm font-medium">Behebungsfrist</label>
          <Input id="mg-frist" type="date" value={frist}
            onChange={(e) => setFrist(e.target.value)} className="mt-1" />
        </div>
        {showStatus && (
          <div>
            <label htmlFor="mg-status" className="text-sm font-medium">Status</label>
            <Combobox
              className="mt-1"
              options={[
                { value: "offen", label: "Offen" },
                { value: "behoben", label: "Behoben" },
                { value: "abgelehnt", label: "Abgelehnt" },
              ]}
              value={status}
              onChange={(v) => setStatus(v)}
            />
          </div>
        )}
      </div>
      {showStatus && status === "behoben" && (
        <div>
          <label htmlFor="mg-behoben-am" className="text-sm font-medium">Behoben am</label>
          <Input id="mg-behoben-am" type="date" value={behobenAm}
            onChange={(e) => setBehobenAm(e.target.value)} className="mt-1" />
        </div>
      )}
    </div>
  );
}

// ── Create Mangel dialog ──────────────────────────────────────────────────────

function CreateMangelDialog({
  open, onClose, abnahmeprotokollId,
}: {
  open: boolean; onClose: () => void; abnahmeprotokollId: string;
}) {
  const qc = useQueryClient();
  const [beschreibung, setBeschreibung] = useState("");
  const [ort, setOrt] = useState("");
  const [schwere, setSchwere] = useState("");
  const [frist, setFrist] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/mangel", {
        body: {
          abnahmeprotokoll_id: abnahmeprotokollId,
          beschreibung,
          ort: ort || null,
          schwere: (schwere || null) as MangelRead["schwere"],
          frist: frist || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mangel", abnahmeprotokollId] });
      setBeschreibung(""); setOrt(""); setSchwere(""); setFrist("");
      onClose();
      toast.success("Mangel erfasst.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neuer Mangel</DialogTitle></DialogHeader>
        <MangelFormFields
          beschreibung={beschreibung} setBeschreibung={setBeschreibung}
          ort={ort} setOrt={setOrt}
          schwere={schwere} setSchwere={setSchwere}
          frist={frist} setFrist={setFrist}
          status="offen" setStatus={() => undefined}
          behobenAm="" setBehobenAm={() => undefined}
          showStatus={false}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!beschreibung.trim() || create.isPending} onClick={() => create.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Mangel dialog ────────────────────────────────────────────────────────

function EditMangelDialog({
  mangel, onClose,
}: {
  mangel: MangelRead; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [beschreibung, setBeschreibung] = useState(mangel.beschreibung);
  const [ort, setOrt] = useState(mangel.ort ?? "");
  const [schwere, setSchwere] = useState(mangel.schwere ?? "");
  const [frist, setFrist] = useState(mangel.frist ? String(mangel.frist) : "");
  const [status, setStatus] = useState<string>(mangel.status);
  const [behobenAm, setBehobenAm] = useState(mangel.behoben_am ? String(mangel.behoben_am) : "");

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/mangel/{id}", {
        params: { path: { id: mangel.id } },
        body: {
          row_version: mangel.row_version,
          beschreibung,
          ort: ort || null,
          schwere: (schwere || null) as MangelRead["schwere"],
          frist: frist || null,
          status: status as MangelRead["status"],
          behoben_am: (status === "behoben" && behobenAm) ? behobenAm : null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mangel", mangel.abnahmeprotokoll_id] });
      toast.success("Gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Mangel bearbeiten</DialogTitle></DialogHeader>
        <MangelFormFields
          beschreibung={beschreibung} setBeschreibung={setBeschreibung}
          ort={ort} setOrt={setOrt}
          schwere={schwere} setSchwere={setSchwere}
          frist={frist} setFrist={setFrist}
          status={status} setStatus={setStatus}
          behobenAm={behobenAm} setBehobenAm={setBehobenAm}
          showStatus={true}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!beschreibung.trim() || update.isPending} onClick={() => update.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Image objectURL hook ──────────────────────────────────────────────────────

function useImageObjectUrl(fotoId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!fotoId) return;
    let revoked = false;
    setError(false);
    fetch(`/api/mangel-foto/${fotoId}/image`, { headers: getAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (revoked) return;
        const objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [fotoId]);

  return { url, error };
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

function FotoThumbnail({ foto, onDelete }: { foto: MangelFotoRead; onDelete: () => void }) {
  const { url, error } = useImageObjectUrl(foto.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="relative group w-24 h-24 rounded-md overflow-hidden border bg-muted shrink-0">
      {url ? (
        <img src={url} alt={foto.beschriftung ?? "Foto"} className="w-full h-full object-cover" />
      ) : error ? (
        <div className="flex items-center justify-center w-full h-full text-muted-foreground">
          <ImageOff className="h-6 w-6" />
        </div>
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}
      {foto.beschriftung && (
        <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-1 py-0.5 truncate">
          {foto.beschriftung}
        </div>
      )}
      {!confirmDelete ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-0.5 text-white hover:bg-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1 p-1">
          <span className="text-white text-[10px] text-center">Löschen?</span>
          <div className="flex gap-1">
            <button type="button" onClick={onDelete}
              className="text-[10px] bg-destructive text-white rounded px-1.5 py-0.5">Ja</button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="text-[10px] bg-white text-black rounded px-1.5 py-0.5">Nein</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mangel foto dialog ────────────────────────────────────────────────────────

function MangelFotoDialog({ mangel, onClose }: { mangel: { id: string; beschreibung: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: fotos } = useQuery<MangelFotoRead[]>({
    queryKey: ["mangel-foto", mangel.id],
    queryFn: async () => unwrap(await apiClient.GET("/api/mangel/{mangel_id}/foto", {
      params: { path: { mangel_id: mangel.id } },
    })) as MangelFotoRead[],
  });

  const deleteFoto = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.DELETE("/api/mangel-foto/{id}", {
        params: { path: { id } },
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mangel-foto", mangel.id] }),
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const resp = await fetch(`/api/mangel/${mangel.id}/foto`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `HTTP ${resp.status}`);
      }
      qc.invalidateQueries({ queryKey: ["mangel-foto", mangel.id] });
      toast.success("Foto hochgeladen.");
    } catch (err) {
      toast.error(`Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="line-clamp-1">Fotos — {mangel.beschreibung}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {!fotos ? (
            <div className="flex gap-3">
              {[...Array(2)].map((_, i) => <Skeleton key={i} className="w-24 h-24 rounded-md" />)}
            </div>
          ) : fotos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Noch keine Fotos für diesen Mangel.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {fotos.map((f) => (
                <FotoThumbnail
                  key={f.id}
                  foto={f}
                  onDelete={() => deleteFoto.mutate(f.id)}
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="h-4 w-4 mr-1" />
            {uploading ? "Wird hochgeladen…" : "Foto hinzufügen"}
          </Button>
          <Button variant="outline" onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Abnahmeprotokoll section ─────────────────────────────────────────────

function AbnahmeHeader({
  protokoll, projektName,
}: {
  protokoll: AbnahmeprotokollRead; projektName: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [datum, setDatum] = useState(String(protokoll.abnahme_datum));
  const [art, setArt] = useState(protokoll.art);
  const [abnehmer, setAbnehmer] = useState(protokoll.abnehmer ?? "");
  const [vorbehalte, setVorbehalte] = useState(protokoll.vorbehalte ?? "");

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/abnahmeprotokoll/{id}", {
        params: { path: { id: protokoll.id } },
        body: {
          row_version: protokoll.row_version,
          abnahme_datum: datum,
          art,
          abnehmer: abnehmer || null,
          vorbehalte: vorbehalte || null,
          protokoll_document_id: protokoll.protokoll_document_id ?? null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abnahmeprotokoll", protokoll.id] });
      setEditing(false);
      toast.success("Protokoll aktualisiert.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  if (!editing) {
    return (
      <div className="rounded-md border p-4 mb-6 bg-card">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">{projektName}</div>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>{fmtDate(String(protokoll.abnahme_datum))}</span>
              <span>·</span>
              <span>{ART_LABELS[protokoll.art] ?? protokoll.art}</span>
              {protokoll.abnehmer && <><span>·</span><span>{protokoll.abnehmer}</span></>}
            </div>
            {protokoll.vorbehalte && (
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium">Vorbehalte:</span> {protokoll.vorbehalte}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />Bearbeiten
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4 mb-6 bg-card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ap-datum" className="text-sm font-medium">Abnahmedatum</label>
          <Input id="ap-datum" type="date" value={datum}
            onChange={(e) => setDatum(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label htmlFor="ap-art" className="text-sm font-medium">Art</label>
          <Combobox
            className="mt-1"
            options={Object.entries(ART_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            value={art}
            onChange={(v) => setArt(v as AbnahmeprotokollRead["art"])}
          />
        </div>
      </div>
      <div>
        <label htmlFor="ap-abnehmer" className="text-sm font-medium">Abnehmer</label>
        <Input id="ap-abnehmer" value={abnehmer} onChange={(e) => setAbnehmer(e.target.value)}
          className="mt-1" />
      </div>
      <div>
        <label htmlFor="ap-vorbehalte" className="text-sm font-medium">Vorbehalte</label>
        <textarea id="ap-vorbehalte" value={vorbehalte}
          onChange={(e) => setVorbehalte(e.target.value)} rows={2}
          className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Abbrechen</Button>
        <Button size="sm" disabled={update.isPending} onClick={() => update.mutate()}>Speichern</Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MangelDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editMangel, setEditMangel] = useState<MangelRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MangelRead | null>(null);
  const [fotoMangel, setFotoMangel] = useState<MangelRead | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: protokoll, isLoading: loadingProto } = useQuery<AbnahmeprotokollRead>({
    queryKey: ["abnahmeprotokoll", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/abnahmeprotokoll/{id}", {
      params: { path: { id: id! } },
    })) as AbnahmeprotokollRead,
    enabled: !!id,
  });

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: maengel, isLoading: loadingMaengel } = useQuery<MangelRead[]>({
    queryKey: ["mangel", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/mangel", {
      params: { query: { abnahmeprotokoll_id: id! } },
    })) as MangelRead[],
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (mangelId: string) => {
      const res = await apiClient.DELETE("/api/mangel/{id}", {
        params: { path: { id: mangelId } },
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mangel", id] });
      setDeleteTarget(null);
      toast.success("Mangel entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  const visibleMaengel = statusFilter
    ? (maengel ?? []).filter((m) => m.status === statusFilter)
    : (maengel ?? []);

  if (loadingProto) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!protokoll) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-muted-foreground">Protokoll nicht gefunden.</p>
        <Link to="/office/mangel" className="text-sm text-primary hover:underline mt-2 inline-block">
          ← Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const projektName = projMap.get(protokoll.projekt_id) ?? protokoll.projekt_id.slice(0, 8);

  // Counts for summary
  const counts = {
    offen: (maengel ?? []).filter((m) => m.status === "offen").length,
    behoben: (maengel ?? []).filter((m) => m.status === "behoben").length,
    abgelehnt: (maengel ?? []).filter((m) => m.status === "abgelehnt").length,
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to="/office/mangel"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Protokolle
      </Link>

      {/* Protocol header */}
      <AbnahmeHeader protokoll={protokoll} projektName={projektName} />

      {/* Mängel section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Mängel</h2>
          {maengel && (
            <span className="text-sm text-muted-foreground">
              ({counts.offen} offen · {counts.behoben} behoben
              {counts.abgelehnt > 0 ? ` · ${counts.abgelehnt} abgelehnt` : ""})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Combobox
            className="w-40"
            options={[
              { value: "offen", label: "Offen" },
              { value: "behoben", label: "Behoben" },
              { value: "abgelehnt", label: "Abgelehnt" },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            placeholder="Alle"
            allowClear
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Neuer Mangel
          </Button>
        </div>
      </div>

      {loadingMaengel ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !visibleMaengel.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border rounded-md">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">
            {statusFilter ? "Keine Mängel mit diesem Status." : "Noch keine Mängel erfasst."}
          </p>
          {!statusFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Ersten Mangel erfassen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Beschreibung</TableHead>
                <TableHead className="w-32">Ort / Raum</TableHead>
                <TableHead className="w-20">Schwere</TableHead>
                <TableHead className="w-24">Frist</TableHead>
                <TableHead className="w-24">Behoben am</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMaengel.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm max-w-xs">
                    <span className="line-clamp-2">{m.beschreibung}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.ort ?? "—"}</TableCell>
                  <TableCell><SchwereBadge schwere={m.schwere} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.frist ? (
                      <span className={
                        m.status === "offen" && m.frist && new Date(String(m.frist)) < new Date()
                          ? "text-red-600 font-medium"
                          : ""
                      }>
                        {fmtDate(String(m.frist))}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(m.behoben_am ? String(m.behoben_am) : null)}
                  </TableCell>
                  <TableCell><StatusBadge status={m.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        title="Fotos"
                        onClick={() => setFotoMangel(m)}>
                        <Camera className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setEditMangel(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {m.status === "offen" && (
                        <Button size="icon" variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(m)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showCreate && (
        <CreateMangelDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          abnahmeprotokollId={protokoll.id}
        />
      )}
      {editMangel && (
        <EditMangelDialog mangel={editMangel} onClose={() => setEditMangel(null)} />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mangel entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Dieser Mangel wird unwiderruflich entfernt. Nur offene Mängel können gelöscht werden.
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

      {fotoMangel && (
        <MangelFotoDialog mangel={fotoMangel} onClose={() => setFotoMangel(null)} />
      )}
    </div>
  );
}
