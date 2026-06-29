/**
 * AngebotReview — the office quote matching review screen.
 *
 * This is the screen that earns the product. The whole UX bet is that
 * verifying a match takes two seconds: source LV position on the left,
 * matched catalog item + confidence + price on the right, and a keyboard
 * shortcut to accept. If this screen is fast, the product feels magical.
 *
 * Data loading:
 *   • GET /api/angebot/{id}              → angebot header + totals
 *   • GET /api/lv?angebot_id={id}        → LV list (one per Angebot typically)
 *   • GET /api/lv-position?lv_id={lv}   → positions (per LV)
 *   • GET /api/check-result?target_table=lv_position → all position flags (tenant-scoped)
 *   • GET /api/check-result?target_table=angebot&target_id={id} → angebot-level flags
 *   • GET /api/leistungskatalog          → katalog list
 *   • GET /api/leistung?leistungskatalog_id={k} → leistungen for catalog picker
 *
 * Risk-first ordering (highest risk = top of list):
 *   0 unmatched
 *   1 review + confidence < 0.60
 *   2 has unresolved hard-fail flag
 *   3 review + confidence < 0.85
 *   4 has unresolved soft flag
 *   5 auto match
 *   6 confirmed (done)
 *
 * Keyboard shortcuts: j/k navigate, a/Enter accept, c open picker, x resolve flag.
 * See usePositionKeyboard.ts.
 */
import { useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, unwrap } from "@/lib/api";
import { parseDecimal } from "@/lib/utils";
import type { components } from "@/api/schema";
import { PositionCard } from "./PositionCard";
import { CatalogPicker } from "./CatalogPicker";
import { TotalsFooter } from "./TotalsFooter";
import { usePositionKeyboard } from "./usePositionKeyboard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Keyboard, ScanSearch } from "lucide-react";

type LvPositionRead = components["schemas"]["LvPositionRead"];
type CheckResultRead = components["schemas"]["CheckResultRead"];
type LeistungRead = components["schemas"]["LeistungRead"];

export function AngebotReview() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPositionId, setPickerPositionId] = useState<string | null>(null);
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────

  const { data: angebot, isLoading: angebotLoading } = useQuery({
    queryKey: ["angebot", id],
    queryFn: async () => {
      const res = await apiClient.GET("/api/angebot/{id}", {
        params: { path: { id: id! } },
      });
      return unwrap(res);
    },
    enabled: !!id,
  });

  const { data: lvList } = useQuery({
    queryKey: ["lv", { angebot_id: id }],
    queryFn: async () => {
      const res = await apiClient.GET("/api/lv", {
        params: { query: { angebot_id: id } },
      });
      return unwrap(res);
    },
    enabled: !!id,
  });

  // Load positions for each LV in parallel
  const positionResults = useQueries({
    queries: (lvList ?? []).map((lv) => ({
      queryKey: ["lv-position", { lv_id: lv.id }],
      queryFn: async () => {
        const res = await apiClient.GET("/api/lv-position", {
          params: { query: { lv_id: lv.id } },
        });
        return unwrap(res);
      },
    })),
  });

  const allPositions: LvPositionRead[] = positionResults.flatMap(
    (r) => r.data ?? [],
  );

  // Load check results for all lv_positions (tenant-scoped, all at once)
  const { data: positionChecks } = useQuery({
    queryKey: ["check-result", { target_table: "lv_position" }],
    queryFn: async () => {
      const res = await apiClient.GET("/api/check-result", {
        params: { query: { target_table: "lv_position" } },
      });
      return unwrap(res);
    },
    enabled: allPositions.length > 0,
  });

  const { data: angebotChecks } = useQuery({
    queryKey: ["check-result", { target_table: "angebot", target_id: id }],
    queryFn: async () => {
      const res = await apiClient.GET("/api/check-result", {
        params: { query: { target_table: "angebot", target_id: id } },
      });
      return unwrap(res);
    },
    enabled: !!id,
  });

  // Load catalog (leistungskatalog + leistungen for picker)
  const { data: katalogList } = useQuery({
    queryKey: ["leistungskatalog"],
    queryFn: async () => {
      const res = await apiClient.GET("/api/leistungskatalog", {});
      return unwrap(res);
    },
  });

  const leistungResults = useQueries({
    queries: (katalogList ?? []).map((k) => ({
      queryKey: ["leistung", { leistungskatalog_id: k.id }],
      queryFn: async () => {
        const res = await apiClient.GET("/api/leistung", {
          params: { query: { leistungskatalog_id: k.id } },
        });
        return unwrap(res);
      },
    })),
  });

  const allLeistungen: LeistungRead[] = leistungResults.flatMap(
    (r) => r.data ?? [],
  );

  const leistungMap = useMemo(
    () => new Map(allLeistungen.map((l) => [l.id, l])),
    [allLeistungen],
  );

  // ── Sorting ──────────────────────────────────────────────────────────────

  const checksByPosition = useMemo(() => {
    const m = new Map<string, CheckResultRead[]>();
    for (const c of positionChecks ?? []) {
      const existing = m.get(c.target_id) ?? [];
      m.set(c.target_id, [...existing, c]);
    }
    return m;
  }, [positionChecks]);

  const sortedPositions = useMemo(
    () => sortByRisk(allPositions, checksByPosition),
    [allPositions, checksByPosition],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const acceptMutation = useMutation({
    mutationFn: async (position: LvPositionRead) => {
      const res = await apiClient.PUT("/api/lv-position/{id}", {
        params: { path: { id: position.id } },
        body: {
          row_version: position.row_version,
          oz: position.oz,
          kurztext: position.kurztext,
          langtext: position.langtext,
          menge: position.menge,
          einheit: position.einheit,
          einheitspreis: position.einheitspreis,
          matched_leistung_id: position.matched_leistung_id,
          match_confidence: position.match_confidence,
          match_status: "confirmed",
          source: position.source,
          position_nr: position.position_nr,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      // Advance to next position
      setActiveIndex((i) => Math.min(i + 1, sortedPositions.length - 1));
    },
    onError: (err) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        qc.invalidateQueries({ queryKey: ["lv-position"] });
        toast.error("Wurde zwischenzeitlich geändert — Daten wurden neu geladen.");
      } else {
        toast.error(
          `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  const setMatchMutation = useMutation({
    mutationFn: async ({
      position,
      leistung,
    }: {
      position: LvPositionRead;
      leistung: LeistungRead;
    }) => {
      const res = await apiClient.PUT("/api/lv-position/{id}", {
        params: { path: { id: position.id } },
        body: {
          row_version: position.row_version,
          oz: position.oz,
          kurztext: position.kurztext,
          langtext: position.langtext,
          menge: position.menge,
          einheit: position.einheit,
          einheitspreis: leistung.einheitspreis ?? position.einheitspreis,
          matched_leistung_id: leistung.id,
          match_confidence: "1.00", // human-confirmed = full confidence
          match_status: "confirmed",
          source: position.source,
          position_nr: position.position_nr,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      toast.success("Leistung zugewiesen und bestätigt.");
    },
    onError: (err) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        qc.invalidateQueries({ queryKey: ["lv-position"] });
        toast.error("Wurde zwischenzeitlich geändert — Daten wurden neu geladen.");
      } else {
        toast.error(
          `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  const resolveFlagMutation = useMutation({
    mutationFn: async (check: CheckResultRead) => {
      setResolvingFlagId(check.id);
      const res = await apiClient.PATCH(
        "/api/check-result/{id}/resolve" as never,
        {
          params: {
            path: { id: check.id },
            query: { row_version: check.row_version },
          },
        } as never,
      );
      return unwrap(res as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["check-result"] });
      setResolvingFlagId(null);
    },
    onError: (err) => {
      setResolvingFlagId(null);
      toast.error(
        `Fehler beim Quittieren: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const catalogMatchMutation = useMutation({
    mutationFn: async (lvId: string) => {
      const res = await apiClient.POST("/api/lv/{id}/catalog-match" as never, {
        params: { path: { id: lvId } },
      } as never);
      return unwrap(res as never) as { auto: number; suggested: number; unmatched: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      const matched = data.auto + data.suggested;
      if (matched === 0) {
        toast("Kein Katalogeintrag gefunden — Positionen manuell zuweisen.");
      } else {
        toast.success(
          `${matched} Positionen abgeglichen (${data.auto} automatisch, ${data.suggested} zur Prüfung).`,
        );
      }
    },
    onError: (err) =>
      toast.error(`Katalog-Abgleich fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`),
  });

  const berechnenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/angebot/{id}/berechnen", {
        params: { path: { id: id! } },
        body: { row_version: angebot!.row_version },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      toast.success("Berechnet.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const pruefenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/angebot/{id}/pruefen", {
        params: { path: { id: id! } },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["check-result"] });
      toast.success("Prüfung abgeschlossen.");
    },
    onError: (err) => toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const ausstellenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST("/api/angebot/{id}/ausstellen", {
        params: { path: { id: id! } },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      qc.invalidateQueries({ queryKey: ["angebot"] });
      toast.success("Angebot ausgestellt.");
    },
    onError: (err) => {
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  // ── Keyboard handlers ─────────────────────────────────────────────────────

  const handleAccept = useCallback(
    (index: number) => {
      const pos = sortedPositions[index];
      if (!pos || !pos.matched_leistung_id) return;
      acceptMutation.mutate(pos);
    },
    [sortedPositions, acceptMutation],
  );

  const handleOpenPicker = useCallback(
    (index: number) => {
      const pos = sortedPositions[index];
      if (!pos) return;
      setPickerPositionId(pos.id);
      setPickerOpen(true);
    },
    [sortedPositions],
  );

  const handleResolveFlag = useCallback(
    (index: number) => {
      const pos = sortedPositions[index];
      if (!pos) return;
      const checks = checksByPosition.get(pos.id) ?? [];
      const firstSoft = checks.find(
        (c) => !c.resolved && !c.passed && c.severity !== "error",
      );
      if (firstSoft) resolveFlagMutation.mutate(firstSoft);
    },
    [sortedPositions, checksByPosition, resolveFlagMutation],
  );

  usePositionKeyboard({
    count: sortedPositions.length,
    activeIndex,
    setActiveIndex,
    onAccept: handleAccept,
    onOpenPicker: handleOpenPicker,
    onResolveFlag: handleResolveFlag,
    disabled: pickerOpen,
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  if (angebotLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!angebot) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Angebot nicht gefunden.</p>
        <Button variant="link" asChild className="mt-2">
          <Link to="/office/angebote">← Zurück</Link>
        </Button>
      </div>
    );
  }

  const pickerPosition = pickerPositionId
    ? sortedPositions.find((p) => p.id === pickerPositionId)
    : sortedPositions[activeIndex];

  const pendingCount = sortedPositions.filter(
    (p) => p.match_status !== "confirmed",
  ).length;
  const confirmedCount = sortedPositions.length - pendingCount;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-4 bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/office/angebote">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">
            {angebot.angebotsnummer
              ? `Angebot ${angebot.angebotsnummer}`
              : "Angebot (Entwurf)"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {sortedPositions.length} Positionen · {confirmedCount} bestätigt
            {pendingCount > 0 && ` · ${pendingCount} offen`}
          </p>
        </div>
        {/* Catalog match button — only when unmatched positions exist */}
        {lvList?.[0] && allPositions.some((p) => !p.matched_leistung_id) && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => catalogMatchMutation.mutate(lvList[0].id)}
            disabled={catalogMatchMutation.isPending}
          >
            <ScanSearch className="h-4 w-4 mr-1" />
            {catalogMatchMutation.isPending ? "Abgleich…" : "Katalog abgleichen"}
          </Button>
        )}
        {/* Keyboard hint */}
        <div className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground/60">
          <Keyboard className="h-3 w-3" />
          <span>j/k navigieren · a annehmen · c korrigieren · x quittieren</span>
        </div>
      </div>

      {/* Position list */}
      {sortedPositions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground text-sm">
              Keine Positionen in diesem Angebot.
            </p>
            <p className="text-xs text-muted-foreground/60">
              Positionen werden über GAEB-Import oder manuell angelegt.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-2">
            {sortedPositions.map((position, index) => (
              <PositionCard
                key={position.id}
                position={position}
                leistungMap={leistungMap}
                checks={checksByPosition.get(position.id) ?? []}
                isActive={index === activeIndex}
                onAccept={() => {
                  setActiveIndex(index);
                  handleAccept(index);
                }}
                onOpenPicker={() => {
                  setActiveIndex(index);
                  handleOpenPicker(index);
                }}
                onResolveFlag={(check) => resolveFlagMutation.mutate(check)}
                resolvingFlagId={resolvingFlagId}
                accepting={
                  acceptMutation.isPending &&
                  acceptMutation.variables?.id === position.id
                }
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Totals footer */}
      <TotalsFooter
        angebot={angebot}
        angebotChecks={angebotChecks ?? []}
        onBerechnen={() => berechnenMutation.mutate()}
        onPruefen={() => pruefenMutation.mutate()}
        onAusstellen={() => ausstellenMutation.mutate()}
        berechnenPending={berechnenMutation.isPending}
        pruefenPending={pruefenMutation.isPending}
        ausstellenPending={ausstellenMutation.isPending}
      />

      {/* Catalog picker */}
      <CatalogPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(leistung) => {
          const pos = pickerPosition;
          if (pos) setMatchMutation.mutate({ position: pos, leistung });
        }}
        leistungen={allLeistungen}
        positionKurztext={pickerPosition?.kurztext}
      />
    </div>
  );
}

// ── Risk sorting ────────────────────────────────────────────────────────────

function riskScore(
  p: LvPositionRead,
  checksByPosition: Map<string, CheckResultRead[]>,
): number {
  const checks = checksByPosition.get(p.id) ?? [];
  const hasHardFail = checks.some(
    (c) => !c.resolved && !c.passed && c.severity === "error",
  );
  const hasSoftFail = checks.some(
    (c) => !c.resolved && !c.passed && c.severity !== "error",
  );
  const confidence = parseDecimal(p.match_confidence);

  if (!p.matched_leistung_id) return 0;
  if (p.match_status === "review" && (confidence === null || confidence < 0.6))
    return 1;
  if (hasHardFail) return 2;
  if (p.match_status === "review") return 3;
  if (hasSoftFail) return 4;
  if (p.match_status === "auto") return 5;
  if (p.match_status === "confirmed") return 10;
  return 6;
}

function sortByRisk(
  positions: LvPositionRead[],
  checksByPosition: Map<string, CheckResultRead[]>,
): LvPositionRead[] {
  return [...positions].sort(
    (a, b) =>
      riskScore(a, checksByPosition) - riskScore(b, checksByPosition) ||
      (a.position_nr ?? 9999) - (b.position_nr ?? 9999),
  );
}
