import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, ChevronRight } from "lucide-react";
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

type AbnahmeprotokollRead = components["schemas"]["AbnahmeprotokollRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

const ART_LABELS: Record<string, string> = {
  foermlich: "Förmlich",
  fiktiv: "Fiktiv (§ 640 BGB)",
  konkludent: "Konkludent",
  bgb: "BGB-Abnahme",
};

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open, onClose, projekte,
}: {
  open: boolean; onClose: (id?: string) => void; projekte: ProjektRead[];
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [projektId, setProjektId] = useState("");
  const [datum, setDatum] = useState(today);
  const [art, setArt] = useState<string>("foermlich");
  const [abnehmer, setAbnehmer] = useState("");
  const [vorbehalte, setVorbehalte] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/abnahmeprotokoll", {
        body: {
          projekt_id: projektId,
          abnahme_datum: datum,
          art: art as AbnahmeprotokollRead["art"],
          abnehmer: abnehmer || null,
          vorbehalte: vorbehalte || null,
          protokoll_document_id: null,
        },
      });
      return unwrap(res) as AbnahmeprotokollRead;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["abnahmeprotokoll"] });
      setProjektId(""); setDatum(today); setArt("foermlich");
      setAbnehmer(""); setVorbehalte("");
      onClose(data.id);
      toast.success("Abnahmeprotokoll angelegt.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neues Abnahmeprotokoll</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="ap-proj" className="text-sm font-medium">
              Projekt <span className="text-destructive">*</span>
            </label>
            <select
              id="ap-proj"
              value={projektId}
              onChange={(e) => setProjektId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— wählen —</option>
              {projekte.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ap-datum" className="text-sm font-medium">
                Abnahmedatum <span className="text-destructive">*</span>
              </label>
              <Input id="ap-datum" type="date" value={datum}
                onChange={(e) => setDatum(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label htmlFor="ap-art" className="text-sm font-medium">Art</label>
              <select
                id="ap-art"
                value={art}
                onChange={(e) => setArt(e.target.value)}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {Object.entries(ART_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ap-abnehmer" className="text-sm font-medium">Abnehmer</label>
            <Input id="ap-abnehmer" value={abnehmer} onChange={(e) => setAbnehmer(e.target.value)}
              placeholder="Name des Abnehmers" className="mt-1" />
          </div>
          <div>
            <label htmlFor="ap-vorbehalte" className="text-sm font-medium">Vorbehalte</label>
            <textarea
              id="ap-vorbehalte"
              value={vorbehalte}
              onChange={(e) => setVorbehalte(e.target.value)}
              placeholder="Freitext"
              rows={3}
              className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()}>Abbrechen</Button>
          <Button disabled={!projektId || !datum || create.isPending} onClick={() => create.mutate()}>
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function MangelList() {
  const [showCreate, setShowCreate] = useState(false);
  const [projektFilter, setProjektFilter] = useState("");

  const { data: projekte } = useQuery<ProjektRead[]>({
    queryKey: ["projekt", ""],
    queryFn: async () => unwrap(await apiClient.GET("/api/projekt", {})) as ProjektRead[],
  });

  const { data: protokolle, isLoading } = useQuery<AbnahmeprotokollRead[]>({
    queryKey: ["abnahmeprotokoll", projektFilter],
    queryFn: async () => {
      const res = await apiClient.GET("/api/abnahmeprotokoll", {
        params: projektFilter ? { query: { projekt_id: projektFilter } } : {},
      });
      return unwrap(res) as AbnahmeprotokollRead[];
    },
  });

  const projMap = new Map(projekte?.map((p) => [p.id, p.name]) ?? []);

  function handleCreated(id?: string) {
    setShowCreate(false);
    // Navigate to the detail page so user can add Mängel immediately
    if (id) window.location.href = `/office/mangel/${id}`;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Abnahme & Mängel</h1>
          {protokolle && (
            <span className="text-sm text-muted-foreground">({protokolle.length} Protokolle)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projektFilter}
            onChange={(e) => setProjektFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Alle Projekte</option>
            {projekte?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Neues Protokoll
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !protokolle?.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {projektFilter ? "Keine Protokolle für dieses Projekt." : "Noch keine Abnahmeprotokolle."}
          </p>
          {!projektFilter && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />Erstes Protokoll anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Datum</TableHead>
                <TableHead>Projekt</TableHead>
                <TableHead className="w-36">Abnahmeart</TableHead>
                <TableHead>Abnehmer</TableHead>
                <TableHead>Vorbehalte</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {protokolle.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="text-sm">{fmtDate(String(p.abnahme_datum))}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {projMap.get(p.projekt_id) ?? p.projekt_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {ART_LABELS[p.art] ?? p.art}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.abnehmer ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {p.vorbehalte ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/office/mangel/${p.id}`}
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Mängel
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showCreate && (
        <CreateDialog
          open={showCreate}
          onClose={handleCreated}
          projekte={projekte ?? []}
        />
      )}
    </div>
  );
}
