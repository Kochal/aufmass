import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, unwrap, getAuthHeaders } from "@/lib/api";
import type { components } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, Plus, ArrowRight, HardHat } from "lucide-react";
import { cn } from "@/lib/utils";

type AufmassRead = components["schemas"]["AufmassRead"];
type ProjektRead = components["schemas"]["ProjektRead"];

export function AufmassList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [projektId, setProjektId] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: projekte, isLoading: projektLoading } = useQuery({
    queryKey: ["projekt"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/projekt", {});
      return unwrap(res);
    },
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["aufmass-list", projektId],
    queryFn: async () => {
      const res = await apiClient.GET("/api/aufmass", {
        params: { query: { projekt_id: projektId } },
      });
      return unwrap(res);
    },
    enabled: !!projektId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/aufmass", {
        body: { projekt_id: projektId },
      });
      return unwrap(res);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["aufmass-list", projektId] });
      navigate(`/field/${data.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !projektId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("projekt_id", projektId);
      formData.append("image", file);
      const baseUrl = import.meta.env.VITE_API_URL ?? "";
      const resp = await fetch(`${baseUrl}/api/aufmass/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as AufmassRead;
      qc.invalidateQueries({ queryKey: ["aufmass-list", projektId] });
      toast.success(`${data.entries?.length ?? 0} Einträge extrahiert`);
      navigate(`/field/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const sorted = [...(sessions ?? [])].sort(
    (a, b) => new Date(b.erfasst_am).getTime() - new Date(a.erfasst_am).getTime(),
  );

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <HardHat className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Aufmaß</h1>
        {sessions && (
          <span className="text-sm text-muted-foreground">({sorted.length})</span>
        )}
      </div>

      {/* Project picker */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium" htmlFor="projekt-select">
          Projekt
        </label>
        {projektLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <select
            id="projekt-select"
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1",
              "text-sm shadow-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            value={projektId}
            onChange={(e) => setProjektId(e.target.value)}
          >
            <option value="">Projekt wählen…</option>
            {(projekte ?? []).map((p: ProjektRead) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Actions — only shown when a project is selected */}
      {projektId && (
        <div className="flex gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            <Camera className="h-4 w-4" />
            {uploading ? "Wird extrahiert…" : "Foto hochladen"}
          </Button>
          <Button
            variant="outline"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Manuell erfassen
          </Button>
        </div>
      )}

      {/* Sessions list */}
      {projektId && (
        <div className="space-y-2">
          {sessionsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          ) : sorted.length === 0 ? (
            <div className="border rounded-lg p-10 text-center">
              <p className="text-muted-foreground text-sm">
                Noch keine Aufmaßsitzungen für dieses Projekt.
              </p>
            </div>
          ) : (
            sorted.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onClick={() => navigate(`/field/${s.id}`)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  onClick,
}: {
  session: AufmassRead;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 border rounded-lg px-4 py-3 text-left",
        "hover:border-muted-foreground/30 hover:bg-accent/30 transition-colors",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {new Date(session.erfasst_am).toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
            {session.quelle === "foto" ? "Foto" : "Manuell"}
          </Badge>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}
