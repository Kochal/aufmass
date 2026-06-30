import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

export function AuftraggeberList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: auftraggeber, isLoading } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/auftraggeber");
      return unwrap(res) as AuftraggeberRead[];
    },
  });

  const createAndOpen = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/auftraggeber", {
        body: { name: "Neuer Auftraggeber", eas_scheme: "EM" },
      });
      return unwrap(res) as AuftraggeberRead;
    },
    onSuccess: (ag) => {
      qc.invalidateQueries({ queryKey: ["auftraggeber"] });
      navigate(`/office/auftraggeber/${ag.id}`);
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
        <Button size="sm" disabled={createAndOpen.isPending} onClick={() => createAndOpen.mutate()}>
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
          <Button variant="outline" size="sm" disabled={createAndOpen.isPending} onClick={() => createAndOpen.mutate()}>
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

    </div>
  );
}
