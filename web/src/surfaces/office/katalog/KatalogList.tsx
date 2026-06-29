import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen } from "lucide-react";
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
import type { components } from "@/api/schema";

type KatalogRead = components["schemas"]["LeistungskatalogRead"];

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/leistungskatalog", {
        body: { name, aktiv: true },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leistungskatalog"] });
      setName("");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Neuer Katalog</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="kat-name" className="text-sm font-medium">Name</label>
            <Input
              id="kat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Malerarbeiten Standardpreise"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && name && create.mutate()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Erstellen
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="text-sm text-destructive">
            {(create.error as Error)?.message ?? "Fehler beim Erstellen"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function KatalogList() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: kataloge, isLoading } = useQuery<KatalogRead[]>({
    queryKey: ["leistungskatalog"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/leistungskatalog", {});
      return unwrap(res);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leistungskatalog</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Neu
        </Button>
      </div>

      {!kataloge?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Noch kein Leistungskatalog. Neuen Katalog anlegen oder Leistungen aus
            bestehenden Angeboten importieren.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Katalog erstellen
          </Button>
        </div>
      ) : (
        <ul className="divide-y border rounded-md">
          {kataloge.map((k) => (
            <li key={k.id}>
              <Link
                to={`/office/katalog/${k.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {k.aktiv ? "Aktiv" : "Inaktiv"}
                  </p>
                </div>
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
