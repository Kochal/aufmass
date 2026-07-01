import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle, Plus, Trash2, FileDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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

type RechnungRead = components["schemas"]["RechnungRead"];
type RechnungPositionRead = components["schemas"]["RechnungPositionRead"];
type CheckResultRead = components["schemas"]["CheckResultRead"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type ProjektRead = components["schemas"]["ProjektRead"];
type AngebotRead = components["schemas"]["AngebotRead"];

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(val: string | null | undefined): string {
  if (!val) return "—";
  return parseFloat(val).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    issued: "bg-green-100 text-green-800",
  };
  const labels: Record<string, string> = { draft: "Entwurf", issued: "Ausgestellt" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Add-position dialog ───────────────────────────────────────────────────────

function AddPositionDialog({
  rechnungId,
  open,
  onClose,
}: {
  rechnungId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [bezeichnung, setBezeichnung] = useState("");
  const [einheit, setEinheit] = useState("");
  const [menge, setMenge] = useState("");
  const [ep, setEp] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/rechnung-position", {
        body: {
          rechnung_id: rechnungId,
          bezeichnung,
          einheit: einheit || null,
          menge: menge ? menge : null,
          einheitspreis: ep ? ep : null,
          vob_2_3_flag: false,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rechnung-position", rechnungId] });
      setBezeichnung(""); setEinheit(""); setMenge(""); setEp("");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Position hinzufügen</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="pos-bez" className="text-sm font-medium">
              Bezeichnung <span className="text-destructive">*</span>
            </label>
            <Input id="pos-bez" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)}
              placeholder="z.B. Wände streichen 2× Dispersionsfarbe" autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="pos-einh" className="text-sm font-medium">Einheit</label>
              <Input id="pos-einh" value={einheit} onChange={(e) => setEinheit(e.target.value)} placeholder="m²" />
            </div>
            <div>
              <label htmlFor="pos-menge" className="text-sm font-medium">Menge</label>
              <Input id="pos-menge" value={menge} onChange={(e) => setMenge(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label htmlFor="pos-ep" className="text-sm font-medium">EP (netto)</label>
              <Input id="pos-ep" value={ep} onChange={(e) => setEp(e.target.value)} placeholder="0,00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung || create.isPending} onClick={() => create.mutate()}>
            Hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit-position dialog ──────────────────────────────────────────────────────

function EditPositionDialog({
  position,
  open,
  onClose,
}: {
  position: RechnungPositionRead;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [bezeichnung, setBezeichnung] = useState(position.bezeichnung ?? "");
  const [einheit, setEinheit] = useState(position.einheit ?? "");
  const [menge, setMenge] = useState(position.menge ?? "");
  const [ep, setEp] = useState(position.einheitspreis ?? "");

  useEffect(() => {
    if (open) {
      setBezeichnung(position.bezeichnung ?? "");
      setEinheit(position.einheit ?? "");
      setMenge(position.menge ?? "");
      setEp(position.einheitspreis ?? "");
    }
  }, [open, position]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/rechnung-position/{id}", {
        params: { path: { id: position.id } },
        body: {
          row_version: position.row_version,
          bezeichnung,
          einheit: einheit || null,
          menge: menge || null,
          einheitspreis: ep || null,
          menge_tender: position.menge_tender ?? null,
          menge_aufmass: position.menge_aufmass ?? null,
          vob_2_3_flag: position.vob_2_3_flag ?? false,
          position_nr: position.position_nr ?? null,
          lv_position_id: position.lv_position_id ?? null,
          leistung_id: position.leistung_id ?? null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rechnung-position", position.rechnung_id] });
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Position bearbeiten</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="edit-bez" className="text-sm font-medium">Bezeichnung</label>
            <Input id="edit-bez" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="edit-einh" className="text-sm font-medium">Einheit</label>
              <Input id="edit-einh" value={einheit} onChange={(e) => setEinheit(e.target.value)} placeholder="m²" />
            </div>
            <div>
              <label htmlFor="edit-menge" className="text-sm font-medium">Menge</label>
              <Input id="edit-menge" value={menge} onChange={(e) => setMenge(e.target.value)} placeholder="0,000" />
              {position.menge_tender && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Angebot: {parseFloat(position.menge_tender).toLocaleString("de-DE", { minimumFractionDigits: 3 })}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="edit-ep" className="text-sm font-medium">EP (netto)</label>
              <Input id="edit-ep" value={ep} onChange={(e) => setEp(e.target.value)} placeholder="0,00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung || save.isPending} onClick={() => save.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Check result row ──────────────────────────────────────────────────────────

const RULE_LABELS: Record<string, string> = {
  summe_netto_check: "Netto-Summe",
  summe_brutto_check: "Brutto-Summe",
  mwst_check: "MwSt-Berechnung",
  positions_priced: "Alle Positionen bepreist",
  einvoice_master_data: "XRechnung Stammdaten",
  einvoice_en16931: "XRechnung EN 16931",
};

function CheckRow({ check }: { check: CheckResultRead }) {
  const detail = check.detail as Record<string, unknown> | null;
  const missing = detail?.missing as string[] | undefined;
  const messages = detail?.messages as string[] | undefined;
  const errMsg = detail?.error as string | undefined;
  const note = detail?.note as string | undefined;

  return (
    <div className={`flex gap-3 py-2.5 px-3 rounded-md ${check.passed ? "bg-green-50" : "bg-red-50"}`}>
      {check.passed
        ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
        : <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {RULE_LABELS[check.rule] ?? check.rule}
          </span>
          {check.severity === "hard" && (
            <span className="text-[10px] font-medium uppercase text-muted-foreground bg-muted px-1 rounded">
              Pflicht
            </span>
          )}
        </div>
        {missing && missing.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {missing.map((m, i) => (
              <li key={i} className="text-xs text-red-700">• {m}</li>
            ))}
          </ul>
        )}
        {messages && messages.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {messages.map((m, i) => (
              <li key={i} className="text-xs text-red-700 font-mono break-all">• {m}</li>
            ))}
          </ul>
        )}
        {errMsg && <p className="text-xs text-amber-700 mt-1">{errMsg}</p>}
        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RechnungDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [showAddPos, setShowAddPos] = useState(false);
  const [editingPos, setEditingPos] = useState<RechnungPositionRead | null>(null);
  const [nachlassBetrag, setNachlassBetrag] = useState("");
  const [zuschlagBetrag, setZuschlagBetrag] = useState("");
  const [checkResults, setCheckResults] = useState<CheckResultRead[] | null>(null);

  const { data: rechnung, isLoading } = useQuery<RechnungRead>({
    queryKey: ["rechnung", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/rechnung/{id}", { params: { path: { id: id! } } })) as RechnungRead,
    enabled: !!id,
  });

  const { data: positions } = useQuery<RechnungPositionRead[]>({
    queryKey: ["rechnung-position", id],
    queryFn: async () =>
      unwrap(await apiClient.GET("/api/rechnung-position", { params: { query: { rechnung_id: id } } })) as RechnungPositionRead[],
    enabled: !!id,
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
  });
  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt"],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });
  const { data: linkedAngebot } = useQuery<AngebotRead>({
    queryKey: ["angebot", rechnung?.angebot_id],
    queryFn: async () =>
      unwrap(await apiClient.GET("/api/angebot/{id}", { params: { path: { id: rechnung!.angebot_id! } } })) as AngebotRead,
    enabled: !!rechnung?.angebot_id,
  });

  const agMap = new Map(auftraggeber?.map((ag) => [ag.id, ag]) ?? []);
  const projMap = new Map(projekte?.map((p) => [p.id, p]) ?? []);

  // Sync nachlass/zuschlag from loaded rechnung
  useEffect(() => {
    if (!rechnung) return;
    setNachlassBetrag(rechnung.nachlass_betrag ?? "");
    setZuschlagBetrag(rechnung.zuschlag_betrag ?? "");
  }, [rechnung]);

  const isDraft = rechnung?.status === "draft";

  // ── Delete position ─────────────────────────────────────────────────────────
  const deletePosMutation = useMutation({
    mutationFn: async (posId: string) => {
      await apiClient.DELETE("/api/rechnung-position/{id}", { params: { path: { id: posId } } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rechnung-position", id] }),
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Berechnen ───────────────────────────────────────────────────────────────
  const berechnenMutation = useMutation({
    mutationFn: async () => {
      if (!rechnung) throw new Error("not loaded");
      const res = await apiClient.POST("/api/rechnung/{id}/berechnen", {
        params: { path: { id: id! } },
        body: {
          row_version: rechnung.row_version,
          nachlass_betrag: nachlassBetrag || null,
          zuschlag_betrag: zuschlagBetrag || null,
        },
      });
      return unwrap(res) as RechnungRead;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rechnung", id] });
      toast.success("Berechnet.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Prüfen ──────────────────────────────────────────────────────────────────
  const pruefenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/rechnung/{id}/pruefen", {
        params: { path: { id: id! } },
      });
      return unwrap(res) as CheckResultRead[];
    },
    onSuccess: (data) => {
      setCheckResults(data);
      const failed = data.filter((c) => !c.passed && c.severity === "hard");
      if (failed.length === 0) toast.success("Alle Pflichtprüfungen bestanden.");
      else toast.error(`${failed.length} Pflichtprüfung${failed.length > 1 ? "en" : ""} nicht bestanden.`);
    },
    onError: (err) => toast.error(`Prüfen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Ausstellen ──────────────────────────────────────────────────────────────
  const ausstellenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/rechnung/{id}/ausstellen", {
        params: { path: { id: id! } },
      });
      return unwrap(res) as RechnungRead;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rechnung", id] });
      qc.invalidateQueries({ queryKey: ["rechnung"] });
      setCheckResults(null);
      toast.success(`Rechnung ${data.rechnungsnummer} ausgestellt.`);
    },
    onError: (err) => toast.error(`Ausstellen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`),
  });

  const hardChecksPassed = checkResults
    ? checkResults.filter((c) => c.severity === "hard").every((c) => c.passed)
    : false;

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!rechnung) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-muted-foreground">Rechnung nicht gefunden.</p>
        <Link to="/office/rechnungen" className="text-sm text-primary hover:underline mt-2 block">
          ← Zurück
        </Link>
      </div>
    );
  }

  const ag = rechnung.auftraggeber_id ? agMap.get(rechnung.auftraggeber_id) : undefined;
  const proj = rechnung.projekt_id ? projMap.get(rechnung.projekt_id) : undefined;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/office/rechnungen" className="text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold font-mono">
              {rechnung.rechnungsnummer ?? "Entwurf"}
            </h1>
            <StatusBadge status={rechnung.status} />
            {rechnung.einvoice_format && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {rechnung.einvoice_format}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {ag?.name ?? "Kein Auftraggeber"}
            {proj ? ` · ${proj.name}` : ""}
            {rechnung.rechnungsdatum ? ` · ${rechnung.rechnungsdatum}` : ""}
          </p>
          {linkedAngebot && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Aus Angebot{" "}
              <Link
                to={`/office/angebote/${linkedAngebot.id}/review`}
                className="underline hover:text-foreground"
              >
                {linkedAngebot.angebotsnummer ?? linkedAngebot.id.slice(0, 8) + "…"}
              </Link>
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* ── Positionen ──────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Positionen
            </h2>
            {isDraft && (
              <Button size="sm" variant="outline" onClick={() => setShowAddPos(true)}>
                <Plus className="h-4 w-4 mr-1" />Position
              </Button>
            )}
          </div>
          {!positions?.length ? (
            <p className="text-sm text-muted-foreground">Noch keine Positionen.</p>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead className="w-16">Einheit</TableHead>
                    <TableHead className="w-24 text-right">Menge</TableHead>
                    <TableHead className="w-24 text-right">EP netto</TableHead>
                    <TableHead className="w-24 text-right">Gesamt</TableHead>
                    {isDraft && <TableHead className="w-14" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => {
                    const mengeChanged =
                      p.menge_tender &&
                      p.menge &&
                      parseFloat(p.menge) !== parseFloat(p.menge_tender);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.position_nr ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{p.bezeichnung}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.einheit ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          <span className={mengeChanged ? "text-amber-700" : ""}>
                            {p.menge ? parseFloat(p.menge).toLocaleString("de-DE", { minimumFractionDigits: 3 }) : "—"}
                          </span>
                          {mengeChanged && (
                            <span className="block text-[10px] text-muted-foreground/60 font-sans">
                              Angebot: {parseFloat(p.menge_tender!).toLocaleString("de-DE", { minimumFractionDigits: 3 })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {p.einheitspreis ? `${fmt(p.einheitspreis)} €` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {p.gesamtpreis ? `${fmt(p.gesamtpreis)} €` : "—"}
                        </TableCell>
                        {isDraft && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setEditingPos(p)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => deletePosMutation.mutate(p.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <Separator />

        {/* ── Berechnen ────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Kalkulation
          </h2>
          {isDraft && (
            <div className="flex items-end gap-3">
              <div>
                <label htmlFor="nachlass" className="text-sm font-medium">Nachlass (€)</label>
                <Input
                  id="nachlass"
                  value={nachlassBetrag}
                  onChange={(e) => setNachlassBetrag(e.target.value)}
                  placeholder="0.00"
                  className="w-28 mt-1"
                />
              </div>
              <div>
                <label htmlFor="zuschlag" className="text-sm font-medium">Zuschlag (€)</label>
                <Input
                  id="zuschlag"
                  value={zuschlagBetrag}
                  onChange={(e) => setZuschlagBetrag(e.target.value)}
                  placeholder="0.00"
                  className="w-28 mt-1"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => berechnenMutation.mutate()}
                disabled={berechnenMutation.isPending}
              >
                {berechnenMutation.isPending ? "Berechne…" : "Berechnen"}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 max-w-xs text-sm mt-2">
            <span className="text-muted-foreground">Summe netto</span>
            <span className="text-right font-mono">{fmt(rechnung.summe_netto)} €</span>
            {rechnung.nachlass_betrag && parseFloat(rechnung.nachlass_betrag) !== 0 && (
              <>
                <span className="text-muted-foreground">Nachlass</span>
                <span className="text-right font-mono">− {fmt(rechnung.nachlass_betrag)} €</span>
              </>
            )}
            {rechnung.zuschlag_betrag && parseFloat(rechnung.zuschlag_betrag) !== 0 && (
              <>
                <span className="text-muted-foreground">Zuschlag</span>
                <span className="text-right font-mono">+ {fmt(rechnung.zuschlag_betrag)} €</span>
              </>
            )}
            {rechnung.ust_satz && (
              <><span className="text-muted-foreground">MwSt {rechnung.ust_satz} %</span>
              <span className="text-right font-mono">
                {rechnung.summe_brutto && rechnung.summe_netto
                  ? `${fmt(String(parseFloat(rechnung.summe_brutto) - parseFloat(rechnung.summe_netto)))} €`
                  : "—"}
              </span></>
            )}
            <span className="font-medium border-t pt-1">Summe brutto</span>
            <span className="text-right font-mono font-semibold border-t pt-1">
              {fmt(rechnung.summe_brutto)} €
            </span>
          </div>
        </section>

        {/* ── Prüfen + check results ────────────────────────────────────────────── */}
        {isDraft && (
          <>
            <Separator />
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Prüfung
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pruefenMutation.mutate()}
                  disabled={pruefenMutation.isPending}
                >
                  {pruefenMutation.isPending ? "Prüfe…" : "Prüfen"}
                </Button>
              </div>
              {checkResults && (
                <div className="space-y-2">
                  {checkResults.map((c) => <CheckRow key={c.id} check={c} />)}
                </div>
              )}
              {!checkResults && (
                <p className="text-sm text-muted-foreground">
                  Prüfung läuft XRechnung-Validierung via KoSIT durch. Erst nach bestandener
                  Prüfung kann ausgestellt werden.
                </p>
              )}
            </section>

            <Separator />

            {/* ── Ausstellen ──────────────────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Ausstellen
                  </h2>
                  {checkResults && !hardChecksPassed && (
                    <p className="text-sm text-destructive">
                      Nicht alle Pflichtprüfungen bestanden — Rechnung kann nicht ausgestellt werden.
                    </p>
                  )}
                  {!checkResults && (
                    <p className="text-sm text-muted-foreground">
                      Erst prüfen, dann ausstellen.
                    </p>
                  )}
                  {checkResults && hardChecksPassed && (
                    <p className="text-sm text-muted-foreground">
                      Alle Pflichtprüfungen bestanden. XRechnung wird beim Ausstellen generiert
                      und via KoSIT final validiert.
                    </p>
                  )}
                </div>
                <Button
                  disabled={!checkResults || !hardChecksPassed || ausstellenMutation.isPending}
                  onClick={() => ausstellenMutation.mutate()}
                >
                  {ausstellenMutation.isPending ? "Stelle aus…" : "Ausstellen"}
                </Button>
              </div>
            </section>
          </>
        )}

        {/* ── Issued: summary card ─────────────────────────────────────────────── */}
        {!isDraft && (
          <>
            <Separator />
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Rechnungsdetails
              </h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm max-w-sm">
                <span className="text-muted-foreground">Rechnungsdatum</span>
                <span>{rechnung.rechnungsdatum ?? "—"}</span>
                <span className="text-muted-foreground">Fälligkeitsdatum</span>
                <span>{rechnung.faelligkeitsdatum ?? "—"}</span>
                <span className="text-muted-foreground">Leistungsdatum</span>
                <span>{rechnung.leistungsdatum ?? "—"}</span>
                <span className="text-muted-foreground">Währung</span>
                <span>{rechnung.waehrung}</span>
                <span className="text-muted-foreground">USt-Behandlung</span>
                <span>{rechnung.steuer_behandlung ?? "—"}</span>
              </div>
              {rechnung.einvoice_artifact_id && (
                <div className="mt-3 flex items-center gap-2 text-sm text-blue-700">
                  <FileDown className="h-4 w-4" />
                  <span>XRechnung archiviert (Artifact {rechnung.einvoice_artifact_id.slice(0, 8)}…)</span>
                </div>
              )}
              {rechnung.version_no > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Version {rechnung.version_no}
                  {rechnung.supersedes_id ? ` · ersetzt ${rechnung.supersedes_id.slice(0, 8)}…` : ""}
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <AddPositionDialog
        rechnungId={id!}
        open={showAddPos}
        onClose={() => setShowAddPos(false)}
      />
      {editingPos && (
        <EditPositionDialog
          key={editingPos.id}
          position={editingPos}
          open={!!editingPos}
          onClose={() => setEditingPos(null)}
        />
      )}
    </div>
  );
}
