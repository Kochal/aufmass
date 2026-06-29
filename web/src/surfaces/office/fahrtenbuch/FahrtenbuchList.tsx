import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
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

type FahrzeugRead = components["schemas"]["FahrzeugRead"];

// ── Vehicle form fields shared between Create and Edit ───────────────────────

interface FahrzeugFormProps {
  kennzeichen: string;
  setKennzeichen: (v: string) => void;
  typ: string;
  setTyp: (v: string) => void;
  privatGenutzt: boolean;
  setPrivatGenutzt: (v: boolean) => void;
}

function FahrzeugFields({
  kennzeichen, setKennzeichen, typ, setTyp, privatGenutzt, setPrivatGenutzt,
}: FahrzeugFormProps) {
  return (
    <div className="space-y-3 py-2">
      <div>
        <label htmlFor="fz-kz" className="text-sm font-medium">
          Kennzeichen <span className="text-destructive">*</span>
        </label>
        <Input
          id="fz-kz"
          value={kennzeichen}
          onChange={(e) => setKennzeichen(e.target.value.toUpperCase())}
          placeholder="z.B. B-MU 1234"
          className="mt-1 font-mono"
        />
      </div>
      <div>
        <label htmlFor="fz-typ" className="text-sm font-medium">Fahrzeugtyp</label>
        <Input
          id="fz-typ"
          value={typ}
          onChange={(e) => setTyp(e.target.value)}
          placeholder="z.B. VW Transporter T6"
          className="mt-1"
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={privatGenutzt}
          onChange={(e) => setPrivatGenutzt(e.target.checked)}
          className="rounded"
        />
        Privat genutzt (geldwerter Vorteil relevant)
      </label>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [kennzeichen, setKennzeichen] = useState("");
  const [typ, setTyp] = useState("");
  const [privatGenutzt, setPrivatGenutzt] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/fahrzeug", {
        body: { kennzeichen, typ: typ || null, privat_genutzt: privatGenutzt },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrzeug"] });
      setKennzeichen(""); setTyp(""); setPrivatGenutzt(false);
      onClose();
      toast.success("Fahrzeug angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neues Fahrzeug</DialogTitle></DialogHeader>
        <FahrzeugFields
          kennzeichen={kennzeichen} setKennzeichen={setKennzeichen}
          typ={typ} setTyp={setTyp}
          privatGenutzt={privatGenutzt} setPrivatGenutzt={setPrivatGenutzt}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!kennzeichen.trim() || create.isPending} onClick={() => create.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditDialog({
  fahrzeug,
  onClose,
}: {
  fahrzeug: FahrzeugRead;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kennzeichen, setKennzeichen] = useState(fahrzeug.kennzeichen);
  const [typ, setTyp] = useState(fahrzeug.typ ?? "");
  const [privatGenutzt, setPrivatGenutzt] = useState(fahrzeug.privat_genutzt);

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/fahrzeug/{id}", {
        params: { path: { id: fahrzeug.id } },
        body: {
          row_version: fahrzeug.row_version,
          kennzeichen,
          typ: typ || null,
          privat_genutzt: privatGenutzt,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrzeug"] });
      toast.success("Gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Fahrzeug bearbeiten</DialogTitle></DialogHeader>
        <FahrzeugFields
          kennzeichen={kennzeichen} setKennzeichen={setKennzeichen}
          typ={typ} setTyp={setTyp}
          privatGenutzt={privatGenutzt} setPrivatGenutzt={setPrivatGenutzt}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!kennzeichen.trim() || update.isPending} onClick={() => update.mutate()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FahrtenbuchList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editFahrzeug, setEditFahrzeug] = useState<FahrzeugRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FahrzeugRead | null>(null);

  const { data: fahrzeuge, isLoading } = useQuery<FahrzeugRead[]>({
    queryKey: ["fahrzeug"],
    queryFn: async () => unwrap(await apiClient.GET("/api/fahrzeug")) as FahrzeugRead[],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.DELETE("/api/fahrzeug/{id}", {
        params: { path: { id } },
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fahrzeug"] });
      setDeleteTarget(null);
      toast.success("Fahrzeug entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Fahrtenbuch — Fahrzeuge</h1>
          {fahrzeuge && (
            <span className="text-sm text-muted-foreground">({fahrzeuge.length})</span>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neues Fahrzeug
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !fahrzeuge?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Car className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch keine Fahrzeuge angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Erstes Fahrzeug anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Kennzeichen</TableHead>
                <TableHead>Fahrzeugtyp</TableHead>
                <TableHead className="w-28">Privatnutzung</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fahrzeuge.map((fz) => (
                <TableRow key={fz.id}>
                  <TableCell className="font-mono font-medium">{fz.kennzeichen}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fz.typ ?? "—"}
                  </TableCell>
                  <TableCell>
                    {fz.privat_genutzt ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                        Ja
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Nein</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditFahrzeug(fz)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(fz)}
                      >
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
      {editFahrzeug && (
        <EditDialog fahrzeug={editFahrzeug} onClose={() => setEditFahrzeug(null)} />
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fahrzeug entfernen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium">{deleteTarget?.kennzeichen}</span> wird
            entfernt. Bereits gespeicherte Fahrten bleiben erhalten.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Abbrechen</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Entfernen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
