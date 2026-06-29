import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Plus, Pencil, Phone, Mail } from "lucide-react";
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
import {
  AddressFields,
  AddressState,
  emptyAddressState,
  addressFromRead,
  useAdresseUpsert,
  useAdresseLoad,
} from "@/surfaces/office/_shared/AddressFields";
import type { components } from "@/api/schema";

type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type AuftraggeberTyp = "privat" | "gewerblich" | "oeffentlich";
type KontaktRead = components["schemas"]["KontaktRead"];

const TYP_OPTIONS = [
  { value: "gewerblich", label: "Gewerblich" },
  { value: "privat", label: "Privat" },
  { value: "oeffentlich", label: "Öffentlich" },
];

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

// ── Kontakt dialog ─────────────────────────────────────────────────────────────

function KontaktDialog({
  open,
  auftraggeberId,
  existing,
  onClose,
}: {
  open: boolean;
  auftraggeberId: string;
  existing?: KontaktRead;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [rolle, setRolle] = useState(existing?.rolle ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [telefon, setTelefon] = useState(existing?.telefon ?? "");

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setRolle(existing.rolle ?? "");
      setEmail(existing.email ?? "");
      setTelefon(existing.telefon ?? "");
    } else {
      setName(""); setRolle(""); setEmail(""); setTelefon("");
    }
  }, [existing, open]);

  const save = useMutation({
    mutationFn: async () => {
      if (existing) {
        return unwrap(await apiClient.PUT("/api/kontakt/{id}", {
          params: { path: { id: existing.id } },
          body: { row_version: existing.row_version, name, rolle: rolle || null, email: email || null, telefon: telefon || null },
        }));
      }
      return unwrap(await apiClient.POST("/api/kontakt", {
        body: { auftraggeber_id: auftraggeberId, name, rolle: rolle || null, email: email || null, telefon: telefon || null },
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kontakt", auftraggeberId] });
      toast.success(existing ? "Kontakt aktualisiert." : "Kontakt angelegt.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{existing ? "Kontakt bearbeiten" : "Neuer Ansprechpartner"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Max Mustermann" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Rolle / Funktion</label>
            <Input value={rolle} onChange={(e) => setRolle(e.target.value)} placeholder="z.B. Einkauf, Bauleitung" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">E-Mail</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Telefon</label>
            <Input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+49 30 …" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!name || save.isPending} onClick={() => save.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DeleteConfirmDialog ────────────────────────────────────────────────────────

function DeleteConfirmDialog({
  open, name, onConfirm, onClose, isPending,
}: {
  open: boolean; name: string; onConfirm: () => void; onClose: () => void; isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Auftraggeber löschen?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          <strong>{name}</strong> wird archiviert. Verknüpfte Angebote und Rechnungen bleiben erhalten.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AuftraggeberDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const upsertAdresse = useAdresseUpsert();
  const [showDelete, setShowDelete] = useState(false);
  const [showKontaktDialog, setShowKontaktDialog] = useState(false);
  const [editKontakt, setEditKontakt] = useState<KontaktRead | undefined>();

  // Stammdaten
  const [name, setName] = useState("");
  const [kundennummer, setKundennummer] = useState("");
  const [typ, setTyp] = useState<AuftraggeberTyp | "">("");
  const [ustIdnr, setUstIdnr] = useState("");
  const [telefon, setTelefon] = useState("");

  // Adresse
  const [addressState, setAddressState] = useState<AddressState>(emptyAddressState());

  // Rechnungsdaten
  const [leitwegId, setLeitwegId] = useState("");
  const [elektronischeAdresse, setElektronischeAdresse] = useState("");
  const [easScheme, setEasScheme] = useState("EM");

  const { data: ag, isLoading } = useQuery<AuftraggeberRead>({
    queryKey: ["auftraggeber", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber/{id}", {
      params: { path: { id: id! } },
    })) as AuftraggeberRead,
    enabled: !!id,
  });

  const { data: adresse } = useAdresseLoad(ag?.adresse_id ?? null);

  const { data: kontakte } = useQuery<KontaktRead[]>({
    queryKey: ["kontakt", id],
    queryFn: async () => unwrap(await apiClient.GET("/api/kontakt", {
      params: { query: { auftraggeber_id: id } },
    })) as KontaktRead[],
    enabled: !!id,
  });

  useEffect(() => {
    if (!ag) return;
    setName(ag.name);
    setKundennummer(ag.kundennummer ?? "");
    setTyp(ag.typ ?? "");
    setUstIdnr(ag.ust_idnr ?? "");
    setTelefon(ag.telefon ?? "");
    setLeitwegId(ag.leitweg_id ?? "");
    setElektronischeAdresse(ag.elektronische_adresse ?? "");
    setEasScheme(ag.eas_scheme ?? "EM");
  }, [ag]);

  useEffect(() => {
    if (adresse) setAddressState(addressFromRead(adresse));
  }, [adresse]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!ag) throw new Error("not loaded");
      const newAdresseId = await upsertAdresse({
        adresseId: ag.adresse_id ?? null,
        state: addressState,
      });
      return unwrap(await apiClient.PUT("/api/auftraggeber/{id}", {
        params: { path: { id: id! } },
        body: {
          row_version: ag.row_version,
          name,
          kundennummer: kundennummer || null,
          typ: (typ as AuftraggeberTyp) || null,
          ust_idnr: ustIdnr || null,
          telefon: telefon || null,
          adresse_id: newAdresseId || null,
          leitweg_id: leitwegId || null,
          elektronische_adresse: elektronischeAdresse || null,
          eas_scheme: easScheme || "EM",
        },
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      qc.invalidateQueries({ queryKey: ["adresse"] });
      toast.success("Gespeichert.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiClient.DELETE("/api/auftraggeber/{id}", { params: { path: { id: id! } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      toast.success("Auftraggeber archiviert.");
      navigate("/office/auftraggeber");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const deleteKontakt = useMutation({
    mutationFn: async (kid: string) => apiClient.DELETE("/api/kontakt/{id}", { params: { path: { id: kid } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kontakt", id] });
      toast.success("Kontakt entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/office/auftraggeber" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold">{ag.name}</h1>
          {ag.kundennummer && (
            <span className="text-sm font-mono text-muted-foreground">{ag.kundennummer}</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"
          onClick={() => setShowDelete(true)} title="Auftraggeber löschen">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        {/* Stammdaten */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Stammdaten</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="ag-name" label="Name" required>
                <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Firmenname oder Nachname" />
              </Field>
            </div>
            <Field id="ag-kundennr" label="Kundennummer">
              <Input id="ag-kundennr" value={kundennummer} onChange={(e) => setKundennummer(e.target.value)} placeholder="z.B. KD-0042" />
            </Field>
            <Field id="ag-typ" label="Typ">
              <Combobox
                options={TYP_OPTIONS}
                value={typ}
                onChange={(v) => setTyp(v as AuftraggeberTyp | "")}
                placeholder="— kein —"
                allowClear
              />
            </Field>
            <Field id="ag-ust" label="USt-IdNr.">
              <Input id="ag-ust" value={ustIdnr} onChange={(e) => setUstIdnr(e.target.value)} placeholder="DE123456789" />
            </Field>
            <Field id="ag-tel" label="Telefon">
              <Input id="ag-tel" value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+49 30 …" type="tel" />
            </Field>
          </div>
        </section>

        <Separator />

        {/* Adresse */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Adresse</h2>
          <AddressFields state={addressState} onChange={setAddressState} idPrefix="ag" />
        </section>

        <Separator />

        {/* Rechnungsdaten */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Rechnungsdaten</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Pflichtfelder für XRechnung / B2G-Pflicht</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field id="ag-leitweg" label="Leitweg-ID (BT-10)">
                <Input id="ag-leitweg" value={leitwegId} onChange={(e) => setLeitwegId(e.target.value)} placeholder="04011000-1234512345-06" />
              </Field>
              <p className="text-xs text-muted-foreground mt-1">Pflicht für öffentliche Auftraggeber (B2G). Vergabestelle mitteilen lassen.</p>
            </div>
            <div className="col-span-2">
              <Field id="ag-eaddr" label="Elektronische Adresse (BT-49)">
                <Input id="ag-eaddr" value={elektronischeAdresse} onChange={(e) => setElektronischeAdresse(e.target.value)} placeholder="einkauf@auftraggeber.de" />
              </Field>
            </div>
            <Field id="ag-eas" label="EAS-Schema (BT-49-1)">
              <Input id="ag-eas" value={easScheme} onChange={(e) => setEasScheme(e.target.value)} placeholder="EM" />
            </Field>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button disabled={!name || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Speichern…" : "Speichern"}
          </Button>
        </div>

        <Separator />

        {/* Ansprechpartner */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Ansprechpartner</h2>
            <Button size="sm" variant="outline" onClick={() => { setEditKontakt(undefined); setShowKontaktDialog(true); }}>
              <Plus className="h-4 w-4 mr-1" />Hinzufügen
            </Button>
          </div>
          {!kontakte?.length ? (
            <p className="text-sm text-muted-foreground">Noch kein Ansprechpartner hinterlegt.</p>
          ) : (
            <div className="space-y-2">
              {kontakte.map((k) => (
                <div key={k.id} className="flex items-start justify-between rounded-md border p-3 bg-card">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{k.name}</p>
                    {k.rolle && <p className="text-xs text-muted-foreground">{k.rolle}</p>}
                    <div className="flex items-center gap-3 mt-1">
                      {k.email && (
                        <a href={`mailto:${k.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <Mail className="h-3 w-3" />{k.email}
                        </a>
                      )}
                      {k.telefon && (
                        <a href={`tel:${k.telefon}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          <Phone className="h-3 w-3" />{k.telefon}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => { setEditKontakt(k); setShowKontaktDialog(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteKontakt.mutate(k.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <DeleteConfirmDialog
        open={showDelete}
        name={ag.name}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setShowDelete(false)}
        isPending={deleteMutation.isPending}
      />

      {showKontaktDialog && (
        <KontaktDialog
          open={showKontaktDialog}
          auftraggeberId={id!}
          existing={editKontakt}
          onClose={() => { setShowKontaktDialog(false); setEditKontakt(undefined); }}
        />
      )}
    </div>
  );
}
