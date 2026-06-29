import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { components } from "@/api/schema";

type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type AuftraggeberTyp = "privat" | "gewerblich" | "oeffentlich";

const TYP_LABELS: Record<AuftraggeberTyp, string> = {
  privat: "Privat",
  gewerblich: "Gewerblich",
  oeffentlich: "Öffentlich",
};

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [typ, setTyp] = useState<AuftraggeberTyp>("gewerblich");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/auftraggeber", {
        body: { name, typ, eas_scheme: "EM" },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      setName("");
      setTyp("gewerblich");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Neuer Auftraggeber</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="ag-name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="ag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Mustermann GmbH"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && name && create.mutate()}
            />
          </div>
          <div>
            <label htmlFor="ag-typ" className="text-sm font-medium">
              Typ
            </label>
            <select
              id="ag-typ"
              value={typ}
              onChange={(e) => setTyp(e.target.value as AuftraggeberTyp)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="gewerblich">Gewerblich</option>
              <option value="privat">Privat</option>
              <option value="oeffentlich">Öffentlich</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Anlegen
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive mt-2">
            {(create.error as Error)?.message ?? "Fehler beim Anlegen"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AuftraggeberList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  const { data: auftraggeber, isLoading } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber");
      return unwrap(res) as AuftraggeberRead[];
    },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Auftraggeber</h1>
          {auftraggeber && (
            <span className="text-sm text-muted-foreground">({auftraggeber.length})</span>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neu anlegen
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !auftraggeber?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">Noch keine Auftraggeber angelegt.</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Ersten Auftraggeber anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Kd.-Nr.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Typ</TableHead>
                <TableHead>Leitweg-ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auftraggeber.map((ag) => (
                <TableRow key={ag.id} className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/auftraggeber/${ag.id}`)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ag.kundennummer ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{ag.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {ag.typ ? TYP_LABELS[ag.typ] : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ag.leitweg_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
