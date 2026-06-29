import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { components } from "@/api/schema";

type ProjektRead = components["schemas"]["ProjektRead"];
type ProjektStatus = ProjektRead["status"];
type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type AngebotRead = components["schemas"]["AngebotRead"];

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


function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function DeleteConfirmDialog({
  open,
  name,
  onConfirm,
  onClose,
  isPending,
}: {
  open: boolean;
  name: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Projekt löschen?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          <strong>{name}</strong> wird archiviert. Verknüpfte Angebote bleiben erhalten.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ANGEBOT_STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  calculated: "Berechnet",
  checked: "Geprüft",
  issued: "Ausgestellt",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  expired: "Abgelaufen",
};

export function ProjektDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [auftraggeberId, setAuftraggeberId] = useState("");
  const [siteAdresse, setSiteAdresse] = useState("");
  const [regime, setRegime] = useState<"bgb" | "vob" | "">("");
  const [abrechnungsart, setAbrechnungsart] = useState<"einheitspreis" | "pauschal" | "">("");
  const [startDatum, setStartDatum] = useState("");
  const [endDatum, setEndDatum] = useState("");
  const [abnahmeDatum, setAbnahmeDatum] = useState("");

  const { data: projekt, isLoading } = useQuery<ProjektRead>({
    queryKey: ["projekt", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/projekt/{id}", {
        params: { path: { id: id! } },
      });
      return unwrap(res) as ProjektRead;
    },
    enabled: !!id,
  });

  const { data: auftraggeber } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber");
      return unwrap(res) as AuftraggeberRead[];
    },
  });

  const { data: angebote } = useQuery<AngebotRead[]>({
    queryKey: ["angebot", "projekt", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/angebot", {
        params: { query: { projekt_id: id } },
      });
      return unwrap(res) as AngebotRead[];
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!projekt) return;
    setName(projekt.name);
    setAuftraggeberId(projekt.auftraggeber_id);
    setSiteAdresse(projekt.site_adresse ?? "");
    setRegime(projekt.regime ?? "");
    setAbrechnungsart(projekt.abrechnungsart ?? "");
    setStartDatum(projekt.start_datum ?? "");
    setEndDatum(projekt.end_datum ?? "");
    setAbnahmeDatum(projekt.abnahme_datum ?? "");
  }, [projekt]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projekt) throw new Error("not loaded");
      const res = await apiClient.PUT("/api/projekt/{id}", {
        params: { path: { id: id! } },
        body: {
          row_version: projekt.row_version,
          name,
          auftraggeber_id: auftraggeberId,
          site_adresse: siteAdresse || null,
          regime: (regime as "bgb" | "vob") || null,
          abrechnungsart: (abrechnungsart as "einheitspreis" | "pauschal") || null,
          start_datum: startDatum || null,
          end_datum: endDatum || null,
          abnahme_datum: abnahmeDatum || null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projekt"] });
      toast.success("Gespeichert.");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: ProjektStatus) => {
      if (!projekt) throw new Error("not loaded");
      const res = await apiClient.PATCH("/api/projekt/{id}/status", {
        params: { path: { id: id! } },
        body: { status: newStatus, row_version: projekt.row_version },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projekt"] });
      toast.success("Status aktualisiert.");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiClient.DELETE("/api/projekt/{id}", {
        params: { path: { id: id! } },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projekt"] });
      toast.success("Projekt archiviert.");
      navigate("/office/projekte");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!projekt) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Projekt nicht gefunden.</p>
        <Link to="/office/projekte" className="text-sm text-primary hover:underline mt-2 block">
          ← Zurück zur Liste
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/office/projekte"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold truncate">{projekt.name}</h1>
          {projekt.nummer && (
            <span className="text-sm font-mono text-muted-foreground shrink-0">
              {projekt.nummer}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => setShowDelete(true)}
          title="Projekt löschen"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        {/* Status */}
        <section className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground w-16">Status</span>
          <Combobox
            className="w-44"
            options={(Object.keys(STATUS_LABELS) as ProjektStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            value={projekt.status}
            onChange={(v) => v && statusMutation.mutate(v as ProjektStatus)}
            disabled={statusMutation.isPending}
          />
        </section>

        <Separator />

        {/* Projektdaten */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Projektdaten
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="p-name" label="Projektname" required>
                <Input
                  id="p-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z.B. Fassade Musterstraße 12"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field id="p-ag" label="Auftraggeber" required>
                <Combobox
                  options={auftraggeber?.map((ag) => ({
                    value: ag.id,
                    label: ag.kundennummer ? `${ag.name} (${ag.kundennummer})` : ag.name,
                  })) ?? []}
                  value={auftraggeberId}
                  onChange={(v) => setAuftraggeberId(v)}
                  placeholder="— wählen —"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field id="p-site" label="Ausführungsort / Baustelle">
                <Input
                  id="p-site"
                  value={siteAdresse}
                  onChange={(e) => setSiteAdresse(e.target.value)}
                  placeholder="Musterstraße 12, 10115 Berlin"
                />
              </Field>
            </div>
            <Field id="p-regime" label="Rechtsrahmen">
              <Combobox
                options={[
                  { value: "bgb", label: "BGB" },
                  { value: "vob", label: "VOB" },
                ]}
                value={regime}
                onChange={(v) => setRegime(v as "bgb" | "vob" | "")}
                placeholder="— kein —"
                allowClear
              />
            </Field>
            <Field id="p-abr" label="Abrechnungsart">
              <Combobox
                options={[
                  { value: "einheitspreis", label: "Einheitspreis" },
                  { value: "pauschal", label: "Pauschal" },
                ]}
                value={abrechnungsart}
                onChange={(v) => setAbrechnungsart(v as "einheitspreis" | "pauschal" | "")}
                placeholder="— kein —"
                allowClear
              />
            </Field>
          </div>
        </section>

        <Separator />

        {/* Termine */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Termine
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <Field id="p-start" label="Beginn">
              <Input
                id="p-start"
                type="date"
                value={startDatum}
                onChange={(e) => setStartDatum(e.target.value)}
              />
            </Field>
            <Field id="p-end" label="Fertigstellung">
              <Input
                id="p-end"
                type="date"
                value={endDatum}
                onChange={(e) => setEndDatum(e.target.value)}
              />
            </Field>
            <Field id="p-abnahme" label="Abnahme">
              <Input
                id="p-abnahme"
                type="date"
                value={abnahmeDatum}
                onChange={(e) => setAbnahmeDatum(e.target.value)}
              />
            </Field>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button
            disabled={!name || !auftraggeberId || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Speichern…" : "Speichern"}
          </Button>
        </div>

        <Separator />

        {/* Linked Angebote */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Angebote
          </h2>
          {!angebote?.length ? (
            <p className="text-sm text-muted-foreground">Noch kein Angebot für dieses Projekt.</p>
          ) : (
            <div className="divide-y border rounded-md">
              {angebote.map((a) => (
                <Link
                  key={a.id}
                  to={`/office/angebote/${a.id}/review`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium flex-1">
                    {a.angebotsnummer ?? a.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ANGEBOT_STATUS_LABELS[a.status] ?? a.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <DeleteConfirmDialog
        open={showDelete}
        name={projekt.name}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setShowDelete(false)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
