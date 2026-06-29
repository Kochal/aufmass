import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
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
import type { components } from "@/api/schema";

type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type AdresseRead = components["schemas"]["AdresseRead"];
type AuftraggeberTyp = "privat" | "gewerblich" | "oeffentlich";

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
      <label htmlFor={id} className="text-sm font-medium text-foreground">
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
          <DialogTitle>Auftraggeber löschen?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          <strong>{name}</strong> wird archiviert. Verknüpfte Angebote und Rechnungen bleiben
          erhalten.
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

export function AuftraggeberDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  // Stammdaten
  const [name, setName] = useState("");
  const [kundennummer, setKundennummer] = useState("");
  const [typ, setTyp] = useState<AuftraggeberTyp | "">("");
  const [ustIdnr, setUstIdnr] = useState("");

  // Adresse
  const [strasse, setStrasse] = useState("");
  const [adresszusatz, setAdresszusatz] = useState("");
  const [plz, setPlz] = useState("");
  const [ort, setOrt] = useState("");
  const [land, setLand] = useState("DE");

  // Rechnungsdaten
  const [leitwegId, setLeitwegId] = useState("");
  const [elektronischeAdresse, setElektronischeAdresse] = useState("");
  const [easScheme, setEasScheme] = useState("EM");

  const { data: ag, isLoading } = useQuery<AuftraggeberRead>({
    queryKey: ["auftraggeber", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber/{id}", {
        params: { path: { id: id! } },
      });
      return unwrap(res) as AuftraggeberRead;
    },
    enabled: !!id,
  });

  const { data: adresse } = useQuery<AdresseRead>({
    queryKey: ["adresse", ag?.adresse_id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/adresse/{id}", {
        params: { path: { id: ag!.adresse_id! } },
      });
      return unwrap(res) as AdresseRead;
    },
    enabled: !!ag?.adresse_id,
  });

  // Populate form when data arrives
  useEffect(() => {
    if (!ag) return;
    setName(ag.name);
    setKundennummer(ag.kundennummer ?? "");
    setTyp(ag.typ ?? "");
    setUstIdnr(ag.ust_idnr ?? "");
    setLeitwegId(ag.leitweg_id ?? "");
    setElektronischeAdresse(ag.elektronische_adresse ?? "");
    setEasScheme(ag.eas_scheme ?? "EM");
  }, [ag]);

  useEffect(() => {
    if (!adresse) return;
    setStrasse(adresse.strasse ?? "");
    setAdresszusatz(adresse.adresszusatz ?? "");
    setPlz(adresse.plz ?? "");
    setOrt(adresse.ort ?? "");
    setLand(adresse.land ?? "DE");
  }, [adresse]);

  const hasAddressContent = strasse || plz || ort;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!ag) throw new Error("not loaded");

      // Step 1: upsert address if there's content
      let newAdresseId: string | null = ag.adresse_id ?? null;

      if (hasAddressContent) {
        if (ag.adresse_id && adresse) {
          // Update existing address
          await apiClient.PUT("/api/adresse/{id}", {
            params: { path: { id: ag.adresse_id } },
            body: {
              row_version: adresse.row_version,
              strasse: strasse || null,
              adresszusatz: adresszusatz || null,
              plz: plz || null,
              ort: ort || null,
              land: land || "DE",
            },
          });
        } else if (!ag.adresse_id) {
          // Create new address
          const res = await apiClient.POST("/api/adresse", {
            body: {
              strasse: strasse || null,
              adresszusatz: adresszusatz || null,
              plz: plz || null,
              ort: ort || null,
              land: land || "DE",
            },
          });
          const created = unwrap(res) as AdresseRead;
          newAdresseId = created.id;
        }
      }

      // Step 2: update Auftraggeber
      const res = await apiClient.PUT("/api/auftraggeber/{id}", {
        params: { path: { id: id! } },
        body: {
          row_version: ag.row_version,
          name,
          kundennummer: kundennummer || null,
          typ: (typ as AuftraggeberTyp) || null,
          ust_idnr: ustIdnr || null,
          adresse_id: newAdresseId || null,
          leitweg_id: leitwegId || null,
          elektronische_adresse: elektronischeAdresse || null,
          eas_scheme: easScheme || "EM",
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      qc.invalidateQueries({ queryKey: ["adresse"] });
      toast.success("Gespeichert.");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.DELETE("/api/auftraggeber/{id}", {
        params: { path: { id: id! } },
      });
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      toast.success("Auftraggeber archiviert.");
      navigate("/office/auftraggeber");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!ag) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Auftraggeber nicht gefunden.</p>
        <Link to="/office/auftraggeber" className="text-sm text-primary hover:underline mt-2 block">
          ← Zurück zur Liste
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            to="/office/auftraggeber"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold">{ag.name}</h1>
          {ag.kundennummer && (
            <span className="text-sm font-mono text-muted-foreground">{ag.kundennummer}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setShowDelete(true)}
          title="Auftraggeber löschen"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        {/* Stammdaten */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Stammdaten
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="ag-name" label="Name" required>
                <Input
                  id="ag-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Firmenname oder Nachname"
                />
              </Field>
            </div>
            <Field id="ag-kundennr" label="Kundennummer">
              <Input
                id="ag-kundennr"
                value={kundennummer}
                onChange={(e) => setKundennummer(e.target.value)}
                placeholder="z.B. KD-0042"
              />
            </Field>
            <Field id="ag-typ" label="Typ">
              <select
                id="ag-typ"
                value={typ}
                onChange={(e) => setTyp(e.target.value as AuftraggeberTyp | "")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— kein —</option>
                <option value="gewerblich">Gewerblich</option>
                <option value="privat">Privat</option>
                <option value="oeffentlich">Öffentlich</option>
              </select>
            </Field>
            <div className="col-span-2">
              <Field id="ag-ust" label="USt-IdNr.">
                <Input
                  id="ag-ust"
                  value={ustIdnr}
                  onChange={(e) => setUstIdnr(e.target.value)}
                  placeholder="DE123456789"
                />
              </Field>
            </div>
          </div>
        </section>

        <Separator />

        {/* Adresse */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Adresse
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="ag-strasse" label="Straße und Hausnummer">
                <Input
                  id="ag-strasse"
                  value={strasse}
                  onChange={(e) => setStrasse(e.target.value)}
                  placeholder="Musterstraße 1"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field id="ag-zusatz" label="Adresszusatz">
                <Input
                  id="ag-zusatz"
                  value={adresszusatz}
                  onChange={(e) => setAdresszusatz(e.target.value)}
                  placeholder="c/o, Etage, …"
                />
              </Field>
            </div>
            <Field id="ag-plz" label="PLZ">
              <Input
                id="ag-plz"
                value={plz}
                onChange={(e) => setPlz(e.target.value)}
                placeholder="12345"
                maxLength={10}
              />
            </Field>
            <Field id="ag-ort" label="Ort">
              <Input
                id="ag-ort"
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                placeholder="Berlin"
              />
            </Field>
            <Field id="ag-land" label="Land (ISO)">
              <Input
                id="ag-land"
                value={land}
                onChange={(e) => setLand(e.target.value.toUpperCase())}
                placeholder="DE"
                maxLength={2}
              />
            </Field>
          </div>
        </section>

        <Separator />

        {/* Rechnungsdaten */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Rechnungsdaten
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pflichtfelder für XRechnung / B2G-Pflicht
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="ag-leitweg" label="Leitweg-ID (BT-10)">
                <Input
                  id="ag-leitweg"
                  value={leitwegId}
                  onChange={(e) => setLeitwegId(e.target.value)}
                  placeholder="04011000-1234512345-06"
                />
              </Field>
              <p className="text-xs text-muted-foreground mt-1">
                Pflicht für öffentliche Auftraggeber (B2G). Vergabestelle mitteilen lassen.
              </p>
            </div>
            <div className="col-span-2">
              <Field id="ag-eaddr" label="Elektronische Adresse (BT-49)">
                <Input
                  id="ag-eaddr"
                  value={elektronischeAdresse}
                  onChange={(e) => setElektronischeAdresse(e.target.value)}
                  placeholder="einkauf@auftraggeber.de"
                />
              </Field>
            </div>
            <Field id="ag-eas" label="EAS-Schema (BT-49-1)">
              <Input
                id="ag-eas"
                value={easScheme}
                onChange={(e) => setEasScheme(e.target.value)}
                placeholder="EM"
              />
            </Field>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button
            disabled={!name || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Speichern…" : "Speichern"}
          </Button>
        </div>
      </div>

      <DeleteConfirmDialog
        open={showDelete}
        name={ag.name}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setShowDelete(false)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
