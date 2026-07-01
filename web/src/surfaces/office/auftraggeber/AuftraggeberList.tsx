import { useState } from "react";
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
import { SortHead } from "@/components/ui/sort-head";
import { ColFilter, ColSelect } from "@/components/ui/table-filters";
import type { components } from "@/api/schema";

type AuftraggeberRead = components["schemas"]["AuftraggeberRead"];
type AuftraggeberTyp = "privat" | "gewerblich" | "oeffentlich";

const TYP_LABELS: Record<AuftraggeberTyp, string> = {
  privat: "Privat",
  gewerblich: "Gewerblich",
  oeffentlich: "Öffentlich",
};

const TYP_OPTIONS = (Object.entries(TYP_LABELS) as [AuftraggeberTyp, string][]).map(
  ([v, label]) => ({ value: v, label }),
);

export function AuftraggeberList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function setFilter(col: string, val: string) {
    setFilters((f) => ({ ...f, [col]: val }));
  }
  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const { data: auftraggeber, isLoading } = useQuery<AuftraggeberRead[]>({
    queryKey: ["auftraggeber"],
    queryFn: async () => unwrap(await apiClient.GET("/api/auftraggeber")) as AuftraggeberRead[],
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
  if (filters.kundennummer) {
    const q = filters.kundennummer.toLowerCase();
    displayed = displayed.filter((ag) => (ag.kundennummer ?? "").toLowerCase().includes(q));
  }
  if (filters.name) {
    const q = filters.name.toLowerCase();
    displayed = displayed.filter((ag) => ag.name.toLowerCase().includes(q));
  }
  if (filters.typ) {
    displayed = displayed.filter((ag) => ag.typ === filters.typ);
  }
  if (filters.leitweg_id) {
    const q = filters.leitweg_id.toLowerCase();
    displayed = displayed.filter((ag) => (ag.leitweg_id ?? "").toLowerCase().includes(q));
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
  const hasFilter = Object.values(filters).some((v) => !!v);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Auftraggeber</h1>
          <span className="text-sm text-muted-foreground">
            ({hasFilter ? `${displayed.length} / ${total}` : total})
          </span>
          {hasFilter && (
            <button type="button" onClick={() => setFilters({})} className="text-xs text-muted-foreground hover:text-foreground underline">
              Filter zurücksetzen
            </button>
          )}
        </div>
        <Button size="sm" disabled={createAndOpen.isPending} onClick={() => createAndOpen.mutate()}>
          <Plus className="h-4 w-4 mr-1" />
          Neu anlegen
        </Button>
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
            <Plus className="h-4 w-4 mr-1" />Ersten Auftraggeber anlegen
          </Button>
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
              <TableRow className="hover:bg-transparent">
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.kundennummer ?? ""} onChange={(v) => setFilter("kundennummer", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.name ?? ""} onChange={(v) => setFilter("name", v)} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColSelect value={filters.typ ?? ""} onChange={(v) => setFilter("typ", v)} options={TYP_OPTIONS} />
                </TableHead>
                <TableHead className="py-1.5 px-3 font-normal">
                  <ColFilter value={filters.leitweg_id ?? ""} onChange={(v) => setFilter("leitweg_id", v)} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                    Keine Auftraggeber gefunden.
                  </TableCell>
                </TableRow>
              ) : displayed.map((ag) => (
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
