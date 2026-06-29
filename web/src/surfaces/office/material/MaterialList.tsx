import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { components } from "@/api/schema";

type MaterialRead = components["schemas"]["MaterialRead"];
type LieferantRead = components["schemas"]["LieferantRead"];

function fmtPreis(p: string | number | null | undefined): string {
  if (p == null) return "—";
  return Number(p).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ── Shared form fields ────────────────────────────────────────────────────────

interface FieldProps {
  bezeichnung: string; setBezeichnung: (v: string) => void;
  einheit: string; setEinheit: (v: string) => void;
  lieferantId: string; setLieferantId: (v: string) => void;
  standardPreis: string; setStandardPreis: (v: string) => void;
  lieferanten: LieferantRead[];
}

function MaterialFields({ bezeichnung, setBezeichnung, einheit, setEinheit, lieferantId, setLieferantId, standardPreis, setStandardPreis, lieferanten }: FieldProps) {
  return (
    <div className="space-y-3 py-2">
      <div>
        <label htmlFor="mt-bez" className="text-sm font-medium">
          Bezeichnung <span className="text-destructive">*</span>
        </label>
        <Input id="mt-bez" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)}
          placeholder="Materialbezeichnung" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="mt-einheit" className="text-sm font-medium">
            Einheit <span className="text-destructive">*</span>
          </label>
          <Input id="mt-einheit" value={einheit} onChange={(e) => setEinheit(e.target.value)}
            placeholder="z.B. m², l, Stk" className="mt-1" />
        </div>
        <div>
          <label htmlFor="mt-preis" className="text-sm font-medium">Standardpreis (€)</label>
          <Input id="mt-preis" type="number" min={0} step={0.01} value={standardPreis}
            onChange={(e) => setStandardPreis(e.target.value)} placeholder="0,00" className="mt-1" />
        </div>
      </div>
      <div>
        <label htmlFor="mt-lf" className="text-sm font-medium">Standard-Lieferant</label>
        <Combobox
          className="mt-1"
          options={lieferanten.map((lf) => ({ value: lf.id, label: lf.name }))}
          value={lieferantId}
          onChange={(v) => setLieferantId(v)}
          placeholder="— kein —"
          allowClear
        />
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, lieferanten }: { open: boolean; onClose: () => void; lieferanten: LieferantRead[] }) {
  const qc = useQueryClient();
  const [bezeichnung, setBezeichnung] = useState("");
  const [einheit, setEinheit] = useState("");
  const [lieferantId, setLieferantId] = useState("");
  const [standardPreis, setStandardPreis] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/material", {
        body: {
          bezeichnung,
          einheit,
          standard_lieferant_id: lieferantId || null,
          standard_preis: (standardPreis ? standardPreis : null) as unknown as number | null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material"] });
      setBezeichnung(""); setEinheit(""); setLieferantId(""); setStandardPreis("");
      onClose();
      toast.success("Material angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Neues Material</DialogTitle></DialogHeader>
        <MaterialFields bezeichnung={bezeichnung} setBezeichnung={setBezeichnung}
          einheit={einheit} setEinheit={setEinheit}
          lieferantId={lieferantId} setLieferantId={setLieferantId}
          standardPreis={standardPreis} setStandardPreis={setStandardPreis}
          lieferanten={lieferanten} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung.trim() || !einheit.trim() || create.isPending} onClick={() => create.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditDialog({ material, lieferanten, onClose }: { material: MaterialRead; lieferanten: LieferantRead[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [bezeichnung, setBezeichnung] = useState(material.bezeichnung);
  const [einheit, setEinheit] = useState(material.einheit);
  const [lieferantId, setLieferantId] = useState(material.standard_lieferant_id ?? "");
  const [standardPreis, setStandardPreis] = useState(material.standard_preis != null ? String(material.standard_preis) : "");

  const update = useMutation({
    mutationFn: async () => {
      const res = await apiClient.PUT("/api/material/{id}", {
        params: { path: { id: material.id } },
        body: {
          row_version: material.row_version,
          bezeichnung,
          einheit,
          standard_lieferant_id: lieferantId || null,
          standard_preis: (standardPreis ? standardPreis : null) as unknown as number | null,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material"] });
      toast.success("Gespeichert.");
      onClose();
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Material bearbeiten</DialogTitle></DialogHeader>
        <MaterialFields bezeichnung={bezeichnung} setBezeichnung={setBezeichnung}
          einheit={einheit} setEinheit={setEinheit}
          lieferantId={lieferantId} setLieferantId={setLieferantId}
          standardPreis={standardPreis} setStandardPreis={setStandardPreis}
          lieferanten={lieferanten} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!bezeichnung.trim() || !einheit.trim() || update.isPending} onClick={() => update.mutate()}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MaterialList() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editMaterial, setEditMaterial] = useState<MaterialRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaterialRead | null>(null);

  const { data: lieferanten } = useQuery<LieferantRead[]>({
    queryKey: ["lieferant"],
    queryFn: async () => unwrap(await apiClient.GET("/api/lieferant")) as LieferantRead[],
  });

  const { data: materialien, isLoading } = useQuery<MaterialRead[]>({
    queryKey: ["material"],
    queryFn: async () => unwrap(await apiClient.GET("/api/material")) as MaterialRead[],
  });

  const lfMap = new Map(lieferanten?.map((lf) => [lf.id, lf.name]) ?? []);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.DELETE("/api/material/{id}", { params: { path: { id } } });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["material"] });
      setDeleteTarget(null);
      toast.success("Material entfernt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Materialkatalog</h1>
          {materialien && <span className="text-sm text-muted-foreground">({materialien.length})</span>}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />Neues Material
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !materialien?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch kein Material angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />Ersten Eintrag anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bezeichnung</TableHead>
                <TableHead className="w-20">Einheit</TableHead>
                <TableHead>Standard-Lieferant</TableHead>
                <TableHead className="w-28 text-right">Standardpreis</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {materialien.map((mt) => (
                <TableRow key={mt.id}>
                  <TableCell className="font-medium text-sm">{mt.bezeichnung}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{mt.einheit}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {mt.standard_lieferant_id ? lfMap.get(mt.standard_lieferant_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right">{fmtPreis(mt.standard_preis)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditMaterial(mt)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(mt)}>
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

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} lieferanten={lieferanten ?? []} />
      {editMaterial && <EditDialog material={editMaterial} lieferanten={lieferanten ?? []} onClose={() => setEditMaterial(null)} />}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Material entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{deleteTarget?.bezeichnung}</span> wird aus dem Katalog entfernt.
            Bestehende Bestellpositionen bleiben erhalten.
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
