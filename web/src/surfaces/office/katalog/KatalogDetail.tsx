import { useRef, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Upload,
  Sparkles,
  Plus,
  Search,
  Pencil,
  Check,
  X,
} from "lucide-react";
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

type Leistung = components["schemas"]["LeistungRead"];

// ── Manual add dialog ─────────────────────────────────────────────────────────

function suggestCode(leistungen: Leistung[]): string {
  const nums = leistungen.map((l) => {
    const m = l.code.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return String(max + 1).padStart(3, "0");
}

function AddLeistungDialog({
  katalogId,
  leistungen,
  open,
  onClose,
}: {
  katalogId: string;
  leistungen: Leistung[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    kurztext: "",
    langtext: "",
    einheit: "",
    einheitspreis: "",
  });

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, code: suggestCode(leistungen) }));
  }, [open]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/leistung", {
        body: {
          leistungskatalog_id: katalogId,
          code: form.code,
          kurztext: form.kurztext,
          langtext: form.langtext || undefined,
          einheit: form.einheit,
          einheitspreis: form.einheitspreis || undefined,
          aktiv: true,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leistung", katalogId] });
      setForm({ code: "", kurztext: "", langtext: "", einheit: "", einheitspreis: "" });
      onClose();
    },
  });

  const valid = form.code && form.kurztext && form.einheit;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Leistung hinzufügen</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <label htmlFor="l-code" className="text-sm font-medium">Code *</label>
            <Input id="l-code" value={form.code} onChange={set("code")} placeholder="STR-01" />
          </div>
          <div>
            <label htmlFor="l-einheit" className="text-sm font-medium">Einheit *</label>
            <Input id="l-einheit" value={form.einheit} onChange={set("einheit")} placeholder="m²" />
          </div>
          <div className="col-span-2">
            <label htmlFor="l-kurztext" className="text-sm font-medium">Kurztext *</label>
            <Input
              id="l-kurztext"
              value={form.kurztext}
              onChange={set("kurztext")}
              placeholder="Wände streichen 2× Dispersionsfarbe"
              autoFocus
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="l-langtext" className="text-sm font-medium">Langtext</label>
            <Input id="l-langtext" value={form.langtext} onChange={set("langtext")} />
          </div>
          <div className="col-span-2">
            <label htmlFor="l-ep" className="text-sm font-medium">Einheitspreis (€)</label>
            <Input
              id="l-ep"
              value={form.einheitspreis}
              onChange={set("einheitspreis")}
              placeholder="12.50"
              type="number"
              step="0.01"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            Hinzufügen
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-1">
            {(create.error as Error)?.message ?? "Fehler beim Speichern"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Spreadsheet import dialog ─────────────────────────────────────────────────

function SpreadsheetImportDialog({
  katalogId,
  open,
  onClose,
}: {
  katalogId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped_empty: number;
    skipped_duplicate: number;
    errors: string[];
  } | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/leistungskatalog/${katalogId}/import-spreadsheet`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["leistung", katalogId] });
      setResult(data);
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
  }

  function handleClose() {
    setResult(null);
    upload.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kalkulationstabelle importieren</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Unterstützte Formate: <strong>xlsx</strong>, <strong>csv</strong>.
              Erkannte Spalten: Code / Pos, Kurztext / Bezeichnung, Einheit / ME,
              Einheitspreis / EP. Trennzeichen und Kodierung werden automatisch
              erkannt.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="hidden"
              onChange={handleFile}
            />
            <Button
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="h-4 w-4 mr-2" />
              {upload.isPending ? "Wird importiert…" : "Datei auswählen"}
            </Button>
            {upload.isError && (
              <p className="text-sm text-destructive">
                {(upload.error as Error)?.message}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p className="font-medium">Import abgeschlossen</p>
              <p>✓ {result.imported} importiert</p>
              {result.skipped_empty > 0 && (
                <p className="text-muted-foreground">– {result.skipped_empty} leer übersprungen</p>
              )}
              {result.skipped_duplicate > 0 && (
                <p className="text-muted-foreground">
                  – {result.skipped_duplicate} bereits vorhanden
                </p>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm space-y-1">
                <p className="font-medium text-destructive">Warnungen</p>
                {result.errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-destructive/80 text-xs">
                    {e}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result ? "Schließen" : "Abbrechen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Extract-from-Angebote ─────────────────────────────────────────────────────

function ExtractDialog({
  katalogId,
  open,
  onClose,
}: {
  katalogId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{
    imported: number;
    skipped_already_in_catalog: number;
    candidates_found: number;
  } | null>(null);

  const extract = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST(
        "/api/leistungskatalog/{id}/extract-from-angebote" as never,
        { params: { path: { id: katalogId } } } as never,
      );
      return unwrap(res as never) as typeof result;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["leistung", katalogId] });
      setResult(data);
    },
  });

  function handleClose() {
    setResult(null);
    extract.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Aus Angeboten extrahieren</DialogTitle>
        </DialogHeader>
        {!result ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Durchsucht alle bestätigten LV-Positionen ohne Katalogzuordnung und
              fügt neue Leistungen mit dem zuletzt verwendeten Preis hinzu.
            </p>
            <Button
              className="w-full"
              onClick={() => extract.mutate()}
              disabled={extract.isPending}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {extract.isPending ? "Wird extrahiert…" : "Jetzt extrahieren"}
            </Button>
            {extract.isError && (
              <p className="text-sm text-destructive">
                {(extract.error as Error)?.message}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <p className="font-medium">Extraktion abgeschlossen</p>
            <p>✓ {result.imported} neue Leistungen hinzugefügt</p>
            <p className="text-muted-foreground">
              {result.candidates_found} Kandidaten gefunden,{" "}
              {result.skipped_already_in_catalog} bereits im Katalog
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result ? "Schließen" : "Abbrechen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function LeistungRow({ l }: { l: Leistung }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [ep, setEp] = useState(l.einheitspreis ?? "");

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/leistung/{id}", {
        params: { path: { id: l.id } },
        body: {
          code: l.code,
          kurztext: l.kurztext,
          langtext: l.langtext ?? undefined,
          einheit: l.einheit,
          einheitspreis: ep || undefined,
          aktiv: l.aktiv,
          row_version: l.row_version,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leistung", l.leistungskatalog_id] });
      setEditing(false);
    },
  });

  return (
    <TableRow className="group">
      <TableCell className="font-mono text-xs text-muted-foreground w-24">{l.code}</TableCell>
      <TableCell>
        <p className="font-medium text-sm">{l.kurztext}</p>
        {l.langtext && (
          <p className="text-xs text-muted-foreground truncate max-w-xs">{l.langtext}</p>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground w-16">{l.einheit}</TableCell>
      <TableCell className="w-36 text-right">
        {editing ? (
          <div className="flex items-center gap-1 justify-end">
            <Input
              className="h-7 w-24 text-right text-sm"
              value={ep}
              onChange={(e) => setEp(e.target.value)}
              type="number"
              step="0.01"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") update.mutate();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => update.mutate()}
              disabled={update.isPending}
            >
              <Check className="h-3.5 w-3.5 text-green-600" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setEp(l.einheitspreis ?? "");
                setEditing(false);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <span className="text-sm tabular-nums">
              {l.einheitspreis ? `${Number(l.einheitspreis).toFixed(2)} €` : "—"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditing(true)}
              aria-label="Preis bearbeiten"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function KatalogDetail() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExtract, setShowExtract] = useState(false);

  const { data: katalog, isLoading: katLoading } = useQuery({
    queryKey: ["leistungskatalog", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/leistungskatalog/{id}", {
        params: { path: { id: id! } },
      });
      return unwrap(res);
    },
    enabled: !!id,
  });

  const { data: leistungen, isLoading: lLoading } = useQuery<Leistung[]>({
    queryKey: ["leistung", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/leistung", {
        params: { query: { leistungskatalog_id: id! } },
      });
      return unwrap(res);
    },
    enabled: !!id,
  });

  const filtered = (leistungen ?? []).filter(
    (l) =>
      !search ||
      l.kurztext.toLowerCase().includes(search.toLowerCase()) ||
      l.code.toLowerCase().includes(search.toLowerCase()),
  );

  if (katLoading || lLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-6 w-64" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Link
            to="/office/katalog"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Kataloge
          </Link>
          <h1 className="text-xl font-semibold">{katalog?.name ?? "Katalog"}</h1>
          <p className="text-xs text-muted-foreground">
            {leistungen?.length ?? 0} Leistungen
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setShowExtract(true)}>
            <Sparkles className="h-4 w-4 mr-1" />
            Aus Angeboten
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-1" />
            Tabelle importieren
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Manuell
          </Button>
        </div>
      </div>

      {/* Search */}
      {(leistungen?.length ?? 0) > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Suche nach Code oder Bezeichnung…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {search
            ? "Kein Treffer für diese Suche."
            : "Noch keine Leistungen. Leistungen manuell hinzufügen, aus einer Tabelle importieren oder aus bestehenden Angeboten extrahieren."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Bezeichnung</TableHead>
              <TableHead className="w-16">Einheit</TableHead>
              <TableHead className="w-36 text-right">EP (netto)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((l) => (
              <LeistungRow key={l.id} l={l} />
            ))}
          </TableBody>
        </Table>
      )}

      {/* Dialogs */}
      {id && (
        <>
          <AddLeistungDialog
            katalogId={id}
            leistungen={leistungen ?? []}
            open={showAdd}
            onClose={() => setShowAdd(false)}
          />
          <SpreadsheetImportDialog
            katalogId={id}
            open={showImport}
            onClose={() => setShowImport(false)}
          />
          <ExtractDialog
            katalogId={id}
            open={showExtract}
            onClose={() => setShowExtract(false)}
          />
        </>
      )}
    </div>
  );
}
