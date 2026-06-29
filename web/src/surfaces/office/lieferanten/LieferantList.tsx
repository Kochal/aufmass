import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AddressFields,
  AddressState,
  emptyAddressState,
  addressFromRead,
  useAdresseUpsert,
  useAdresseLoad,
} from "@/surfaces/office/_shared/AddressFields";
import type { components } from "@/api/schema";

type LieferantRead = components["schemas"]["LieferantRead"];

// ── Shared form fields ────────────────────────────────────────────────────────

interface BaseFieldsProps {
  name: string; setName: (v: string) => void;
  ustIdnr: string; setUstIdnr: (v: string) => void;
  zahlungszielTage: string; setZahlungszielTage: (v: string) => void;
  addressState: AddressState; setAddressState: (s: AddressState) => void;
  idPrefix: string;
}

function LieferantFormFields({
  name, setName, ustIdnr, setUstIdnr, zahlungszielTage, setZahlungszielTage,
  addressState, setAddressState, idPrefix,
}: BaseFieldsProps) {
  return (
    <div className="space-y-4 py-2">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium">
          Name <span className="text-destructive">*</span>
        </label>
        <Input id={`${idPrefix}-name`} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Firmenname" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-ust`} className="text-sm font-medium">USt-IdNr.</label>
          <Input id={`${idPrefix}-ust`} value={ustIdnr} onChange={(e) => setUstIdnr(e.target.value)}
            placeholder="DE123456789" className="mt-1 font-mono" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-zz`} className="text-sm font-medium">Zahlungsziel (Tage)</label>
          <Input id={`${idPrefix}-zz`} type="number" min={0} value={zahlungszielTage}
            onChange={(e) => setZahlungszielTage(e.target.value)}
            placeholder="30" className="mt-1" />
        </div>
      </div>
      <Separator />
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-3">Adresse</p>
        <AddressFields state={addressState} onChange={setAddressState} idPrefix={idPrefix} />
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const upsertAdresse = useAdresseUpsert();
  const [name, setName] = useState("");
  const [ustIdnr, setUstIdnr] = useState("");
  const [zahlungszielTage, setZahlungszielTage] = useState("");
  const [addressState, setAddressState] = useState<AddressState>(emptyAddressState());

  function reset() {
    setName(""); setUstIdnr(""); setZahlungszielTage("");
    setAddressState(emptyAddressState());
  }

  const create = useMutation({
    mutationFn: async () => {
      const adresseId = await upsertAdresse({ adresseId: null, state: addressState });
      return unwrap(await apiClient.POST("/api/lieferant", {
        body: {
          name,
          ust_idnr: ustIdnr || null,
          zahlungsziel_tage: zahlungszielTage ? parseInt(zahlungszielTage, 10) : null,
          adresse_id: adresseId || null,
        },
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lieferant"] });
      reset();
      onClose();
      toast.success("Lieferant angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Neuer Lieferant</DialogTitle></DialogHeader>
        <LieferantFormFields
          name={name} setName={setName}
          ustIdnr={ustIdnr} setUstIdnr={setUstIdnr}
          zahlungszielTage={zahlungszielTage} setZahlungszielTage={setZahlungszielTage}
          addressState={addressState} setAddressState={setAddressState}
          idPrefix="lf-new"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Abbrechen</Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditDialog({ lieferant, onClose }: { lieferant: LieferantRead; onClose: () => void }) {
  const qc = useQueryClient();
  const upsertAdresse = useAdresseUpsert();
  const [name, setName] = useState(lieferant.name);
  const [ustIdnr, setUstIdnr] = useState(lieferant.ust_idnr ?? "");
  const [zahlungszielTage, setZahlungszielTage] = useState(
    lieferant.zahlungsziel_tage != null ? String(lieferant.zahlungsziel_tage) : ""
  );
  const [addressState, setAddressState] = useState<AddressState>(emptyAddressState());

  const { data: adresse } = useAdresseLoad(lieferant.adresse_id ?? null);

  useEffect(() => {
    if (adresse) setAddressState(addressFromRead(adresse));
  }, [adresse]);

  const update = useMutation({
    mutationFn: async () => {
      const adresseId = await upsertAdresse({
        adresseId: lieferant.adresse_id ?? null,
        state: addressState,
      });
      return unwrap(await apiClient.PUT("/api/lieferant/{id}", {
        params: { path: { id: lieferant.id } },
        body: {
          row_version: lieferant.row_version,
          name,
          ust_idnr: ustIdnr || null,
          zahlungsziel_tage: zahlungszielTage ? parseInt(zahlungszielTage, 10) : null,
          adresse_id: adresseId || null,
        },
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lieferant"] });
      qc.invalidateQueries({ queryKey: ["adresse"] });
      toast.success("Gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lieferant bearbeiten</DialogTitle></DialogHeader>
        <LieferantFormFields
          name={name} setName={setName}
          ustIdnr={ustIdnr} setUstIdnr={setUstIdnr}
          zahlungszielTage={zahlungszielTage} setZahlungszielTage={setZahlungszielTage}
          addressState={addressState} setAddressState={setAddressState}
          idPrefix="lf-edit"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!name.trim() || update.isPending} onClick={() => update.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function LieferantList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editLieferant, setEditLieferant] = useState<LieferantRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LieferantRead | null>(null);

  const { data: lieferanten, isLoading } = useQuery<LieferantRead[]>({
    queryKey: ["lieferant"],
    queryFn: async () => unwrap(await apiClient.GET("/api/lieferant")) as LieferantRead[],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.DELETE("/api/lieferant/{id}", { params: { path: { id } } });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lieferant"] });
      setDeleteTarget(null);
      toast.success("Lieferant entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Lieferanten</h1>
          {lieferanten && <span className="text-sm text-muted-foreground">({lieferanten.length})</span>}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />Neuer Lieferant
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !lieferanten?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch keine Lieferanten angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Ersten Lieferanten anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-36">USt-IdNr.</TableHead>
                <TableHead className="w-36">Zahlungsziel</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lieferanten.map((lf) => (
                <TableRow key={lf.id}>
                  <TableCell className="font-medium text-sm">{lf.name}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{lf.ust_idnr ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lf.zahlungsziel_tage != null ? `${lf.zahlungsziel_tage} Tage` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditLieferant(lf)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(lf)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
      {editLieferant && <EditDialog lieferant={editLieferant} onClose={() => setEditLieferant(null)} />}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Lieferant entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{deleteTarget?.name}</span> wird entfernt. Bestehende Bestellungen bleiben erhalten.
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
    </div>
  );
}
