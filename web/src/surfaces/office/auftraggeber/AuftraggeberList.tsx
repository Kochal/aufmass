import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Search } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortHead } from "@/components/ui/sort-head";
import type { components } from "@/api/schema";
import { useState } from "react";

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
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

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

  let displayed = [...(auftraggeber ?? [])];
  if (search.trim()) {
    const q = search.toLowerCase();
    displayed = displayed.filter(
      (ag) =>
        ag.name.toLowerCase().includes(q) ||
        (ag.kundennummer ?? "").toLowerCase().includes(q) ||
        (ag.leitweg_id ?? "").toLowerCase().includes(q),
    );
  }
  displayed.sort((a, b) => {
    let av = "";
    let bv = "";
    if (sortCol === "kundennummer") { av = a.kundennummer ?? ""; bv = b.kundennummer ?? ""; }
    else if (sortCol === "typ") { av = a.typ ?? ""; bv = b.typ ?? ""; }
    else if (sortCol === "leitweg_id") { av = a.leitweg_id ?? ""; bv = b.leitweg_id ?? ""; }
    else { av = a.name; bv = b.name; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const total = auftraggeber?.length ?? 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Auftraggeber</h1>
          <span className="text-sm text-muted-foreground">
            ({search ? `${displayed.length} / ${total}` : total})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-48 text-sm"
            />
          </div>
          <Button size="sm" disabled={createAndOpen.isPending} onClick={() => createAndOpen.mutate()}>
            <Plus className="h-4 w-4 mr-1" />
            Neu anlegen
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
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
      ) : displayed.length === 0 ? (
        <div className="border rounded-md p-12 text-center">
          <p className="text-muted-foreground text-sm">Keine Auftraggeber gefunden.</p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead col="kundennummer" label="Kd.-Nr." sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-32" />
                <SortHead col="name" label="Name" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHead col="typ" label="Typ" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                <SortHead col="leitweg_id" label="Leitweg-ID" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((ag) => (
                <TableRow
                  key={ag.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/office/auftraggeber/${ag.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ag.kundennummer ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">{ag.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {ag.typ ? TYP_LABELS[ag.typ as AuftraggeberTyp] : "—"}
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
