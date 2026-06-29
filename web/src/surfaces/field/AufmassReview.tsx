import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import type { components } from "@/api/schema";
import { EntryCard } from "./EntryCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

type AufmassEntryRead = components["schemas"]["AufmassEntryRead"];

/** Sort order: review first, corrected second, confirmed last. */
const REVIEW_ORDER: Record<string, number> = { review: 0, corrected: 1, confirmed: 2 };

export function AufmassReview() {
  const { aufmassId } = useParams<{ aufmassId: string }>();
  const qc = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);

  const { data: session, isLoading, error } = useQuery({
    queryKey: ["aufmass", aufmassId],
    queryFn: async () => {
      const res = await apiClient.GET("/api/aufmass/{id}", {
        params: { path: { id: aufmassId! } },
      });
      return unwrap(res);
    },
    enabled: !!aufmassId,
  });

  const confirmMutation = useMutation({
    mutationFn: async (entry: AufmassEntryRead) => {
      const res = await apiClient.PATCH("/api/aufmass-entry/{id}/confirm", {
        params: { path: { id: entry.id } },
        body: { row_version: entry.row_version },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aufmass", aufmassId] });
      toast.success("Eintrag bestätigt");
    },
    onError: (e: Error) => {
      if ((e as Error & { status?: number }).status === 409) {
        qc.invalidateQueries({ queryKey: ["aufmass", aufmassId] });
        toast.error("Daten veraltet – bitte erneut versuchen");
      } else {
        toast.error(e.message);
      }
    },
    onSettled: () => setConfirmingId(null),
  });

  const correctMutation = useMutation({
    mutationFn: async ({
      entry,
      values,
    }: {
      entry: AufmassEntryRead;
      values: { written_result?: string; bauteil?: string; einheit?: string };
    }) => {
      const res = await apiClient.PATCH("/api/aufmass-entry/{id}/correct", {
        params: { path: { id: entry.id } },
        body: { row_version: entry.row_version, ...values },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aufmass", aufmassId] });
      toast.success("Eintrag korrigiert");
    },
    onError: (e: Error) => {
      if ((e as Error & { status?: number }).status === 409) {
        qc.invalidateQueries({ queryKey: ["aufmass", aufmassId] });
        toast.error("Daten veraltet – bitte erneut versuchen");
      } else {
        toast.error(e.message);
      }
    },
    onSettled: () => setCorrectingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: async (entry: AufmassEntryRead) => {
      const res = await apiClient.DELETE("/api/aufmass-entry/{id}", {
        params: { path: { id: entry.id } },
      });
      if (!res.response.ok) throw new Error(`HTTP ${res.response.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aufmass", aufmassId] });
      toast.success("Eintrag gelöscht");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/field">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Zurück
          </Link>
        </Button>
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Aufmaß nicht gefunden"}
        </p>
      </div>
    );
  }

  const entries: AufmassEntryRead[] = (session.entries as AufmassEntryRead[]) ?? [];
  const sorted = [...entries].sort((a, b) => {
    const ao = REVIEW_ORDER[a.review_status] ?? 99;
    const bo = REVIEW_ORDER[b.review_status] ?? 99;
    return ao - bo;
  });

  const doneCount = sorted.filter(
    (e) => e.review_status === "confirmed" || e.review_status === "corrected",
  ).length;
  const pendingCount = sorted.filter((e) => e.review_status === "review").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/field">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold truncate">
              Aufmaß{" "}
              {new Date(session.erfasst_am).toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </h1>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
              {session.quelle === "foto" ? "Foto" : "Manuell"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {doneCount}/{sorted.length} geprüft
            {pendingCount > 0 && (
              <span className="ml-2 text-confidence-mid-fg font-medium">
                · {pendingCount} ausstehend
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Entry list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2 max-w-2xl">
          {sorted.length === 0 ? (
            <div className="border rounded-lg p-10 text-center space-y-2">
              <p className="text-muted-foreground text-sm">
                Noch keine Einträge in diesem Aufmaß.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Einträge werden nach einem Foto-Upload automatisch extrahiert
                oder können manuell über POST /api/aufmass-entry hinzugefügt
                werden.
              </p>
            </div>
          ) : (
            sorted.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onConfirm={(e) => {
                  setConfirmingId(e.id);
                  confirmMutation.mutate(e);
                }}
                onCorrect={(e, values) => {
                  setCorrectingId(e.id);
                  correctMutation.mutate({ entry: e, values });
                }}
                onDelete={(e) => deleteMutation.mutate(e)}
                confirming={confirmingId === entry.id && confirmMutation.isPending}
                correcting={correctingId === entry.id && correctMutation.isPending}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
