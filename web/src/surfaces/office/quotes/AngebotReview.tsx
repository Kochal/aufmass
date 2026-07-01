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
import { useState, useCallback, useMemo, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { MengeInput } from "./MengeInput";
import { ArrowLeft, Keyboard, Plus, ScanSearch, Search } from "lucide-react";

type LvPositionRead = components["schemas"]["LvPositionRead"];
type CheckResultRead = components["schemas"]["CheckResultRead"];
type LeistungRead = components["schemas"]["LeistungRead"];
type LvRead = components["schemas"]["LvRead"];
type LeistungskatalogRead = components["schemas"]["LeistungskatalogRead"];

// ── Edit position dialog ──────────────────────────────────────────────────────

function suggestCode(leistungen: LeistungRead[]): string {
  const nums = leistungen.map((l) => {
    const m = l.code.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return String(max + 1).padStart(3, "0");
}

function EditPositionDialog({
  angebotId,
  position,
  leistungen,
  katalogList,
  open,
  onClose,
}: {
  angebotId: string;
  position: LvPositionRead | null;
  leistungen: LeistungRead[];
  katalogList: LeistungskatalogRead[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ kurztext: "", langtext: "", menge: "", menge_formel: null as string | null, einheit: "", einheitspreis: "" });
  const [leistungSearch, setLeistungSearch] = useState("");
  const [selectedLeistungId, setSelectedLeistungId] = useState<string | null>(null);
  const [saveToKatalog, setSaveToKatalog] = useState(false);
  const [newKatalogId, setNewKatalogId] = useState("");
  const [newCode, setNewCode] = useState("");

  useEffect(() => {
    if (position && open) {
      setForm({
        kurztext: position.kurztext ?? "",
        langtext: position.langtext ?? "",
        menge: position.menge ?? "",
        menge_formel: position.menge_formel ?? null,
        einheit: position.einheit ?? "",
        einheitspreis: position.einheitspreis ?? "",
      });
      setLeistungSearch("");
      setSelectedLeistungId(position.matched_leistung_id ?? null);
      setSaveToKatalog(false);
      setNewCode("");
      setNewKatalogId(katalogList[0]?.id ?? "");
    }
  }, [position?.id, open]);

  // When save-to-catalog is toggled on, generate a suggested code
  useEffect(() => {
    if (saveToKatalog) {
      const kid = newKatalogId || katalogList[0]?.id || "";
      if (kid) {
        const catalogLeistungen = leistungen.filter((l) => l.leistungskatalog_id === kid);
        setNewCode(suggestCode(catalogLeistungen));
        if (!newKatalogId) setNewKatalogId(kid);
      }
    }
  }, [saveToKatalog, newKatalogId, katalogList]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Local-only autosuggest — no API call
  const suggestions = leistungSearch.length >= 2
    ? leistungen.filter((l) => {
        const q = leistungSearch.toLowerCase();
        return l.kurztext.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  function applyLeistung(l: LeistungRead) {
    setForm((f) => ({
      ...f,
      kurztext: l.kurztext,
      einheit: l.einheit,
      einheitspreis: l.einheitspreis ?? f.einheitspreis,
    }));
    setSelectedLeistungId(l.id);
    setLeistungSearch("");
    setSaveToKatalog(false);
  }

  // Fall back to first catalog when newKatalogId wasn't set (e.g. katalogList loaded after dialog opened)
  const effectiveKatalogId = newKatalogId || katalogList[0]?.id || "";

  const save = useMutation({
    mutationFn: async () => {
      if (!position) return;

      let matched_leistung_id = selectedLeistungId;

      if (saveToKatalog && effectiveKatalogId && newCode) {
        const res = await apiClient.POST("/api/leistung", {
          body: {
            leistungskatalog_id: effectiveKatalogId,
            code: newCode,
            kurztext: form.kurztext,
            langtext: form.langtext || undefined,
            einheit: form.einheit || "St",
            einheitspreis: form.einheitspreis || undefined,
            aktiv: true,
          },
        });
        matched_leistung_id = (unwrap(res) as LeistungRead).id;
      }

      const res = await apiClient.PUT("/api/lv-position/{id}", {
        params: { path: { id: position.id } },
        body: {
          row_version: position.row_version,
          oz: position.oz,
          kurztext: form.kurztext,
          langtext: form.langtext || undefined,
          menge: form.menge || undefined,
          menge_formel: form.menge_formel || undefined,
          einheit: form.einheit || undefined,
          einheitspreis: form.einheitspreis || undefined,
          matched_leistung_id,
          match_confidence: matched_leistung_id ? "1.00" : null,
          match_status:
            (matched_leistung_id && matched_leistung_id !== position.matched_leistung_id) || saveToKatalog
              ? "confirmed"
              : position.match_status,
          source: position.source,
          position_nr: position.position_nr,
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      qc.invalidateQueries({ queryKey: ["angebot", angebotId] });
      if (saveToKatalog) qc.invalidateQueries({ queryKey: ["leistung"] });
      onClose();
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const katalogOptions = katalogList.map((k) => ({ value: k.id, label: k.name }));
  const selectedLeistung = selectedLeistungId ? leistungen.find((l) => l.id === selectedLeistungId) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Position bearbeiten</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">

          {/* Leistung autosuggest */}
          <div className="relative">
            <label className="text-sm font-medium">Leistung suchen (optional)</label>
            {selectedLeistung ? (
              <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted px-2 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{selectedLeistung.code}</span>
                <span className="flex-1 truncate">{selectedLeistung.kurztext}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                  onClick={() => { setSelectedLeistungId(null); setLeistungSearch(""); }}
                >✕</button>
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={leistungSearch}
                    onChange={(e) => setLeistungSearch(e.target.value)}
                    placeholder="Bezeichnung oder Code eingeben…"
                    className="pl-8"
                    autoFocus
                  />
                </div>
                {suggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {suggestions.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => { e.preventDefault(); applyLeistung(l); }}
                      >
                        <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{l.code}</span>
                        <span className="flex-1 truncate">{l.kurztext}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{l.einheit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t pt-3 space-y-3">
            <div>
              <label htmlFor="edit-kurztext" className="text-sm font-medium">Kurztext</label>
              <Input id="edit-kurztext" value={form.kurztext} onChange={set("kurztext")} className="mt-1" />
            </div>
            <div>
              <label htmlFor="edit-langtext" className="text-sm font-medium">Langtext</label>
              <Input id="edit-langtext" value={form.langtext} onChange={set("langtext")} className="mt-1" />
            </div>
            <div>
              <label htmlFor="edit-menge" className="text-sm font-medium">Menge</label>
              <MengeInput
                key={position?.id ?? ""}
                id="edit-menge"
                value={form.menge}
                formula={form.menge_formel}
                onChange={(menge, formula) => setForm((f) => ({ ...f, menge, menge_formel: formula }))}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-einheit" className="text-sm font-medium">Einheit</label>
                <Input id="edit-einheit" value={form.einheit} onChange={set("einheit")} placeholder="m²" className="mt-1" />
              </div>
              <div>
                <label htmlFor="edit-ep" className="text-sm font-medium">EP (€)</label>
                <Input
                  id="edit-ep"
                  value={form.einheitspreis.replace(".", ",")}
                  onChange={(e) => setForm((f) => ({ ...f, einheitspreis: e.target.value.replace(",", ".") }))}
                  placeholder="12,50"
                  inputMode="decimal"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Save to catalog — only when not linked to an existing leistung */}
          {!selectedLeistungId && (
            <div className="border-t pt-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveToKatalog}
                  onChange={(e) => setSaveToKatalog(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Als neue Leistung in Katalog speichern</span>
              </label>
              {saveToKatalog && (
                <div className="grid grid-cols-2 gap-2 pl-6">
                  {katalogOptions.length > 1 && (
                    <div className="col-span-2">
                      <label className="text-xs text-muted-foreground">Katalog</label>
                      <Combobox
                        className="mt-1"
                        options={katalogOptions}
                        value={newKatalogId}
                        onChange={(v) => setNewKatalogId(v ?? "")}
                        placeholder="Katalog wählen…"
                        searchPlaceholder="Suchen…"
                      />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">Code (automatisch – änderbar)</label>
                    <Input
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      className="mt-1 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            disabled={!form.kurztext || save.isPending || (saveToKatalog && (!newCode || !effectiveKatalogId))}
            onClick={() => save.mutate()}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add position dialog ───────────────────────────────────────────────────────

function AddPositionDialog({
  angebotId,
  lvList,
  leistungen,
  open,
  onClose,
}: {
  angebotId: string;
  lvList: LvRead[];
  leistungen: LeistungRead[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    kurztext: "",
    langtext: "",
    menge: "",
    menge_formel: null as string | null,
    einheit: "",
    einheitspreis: "",
  });
  const [leistungSearch, setLeistungSearch] = useState("");
  const [selectedLeistungId, setSelectedLeistungId] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const suggestions = leistungSearch.length >= 2
    ? leistungen.filter((l) => {
        const q = leistungSearch.toLowerCase();
        return l.kurztext.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  function applyLeistung(l: LeistungRead) {
    setForm((f) => ({
      ...f,
      kurztext: l.kurztext,
      einheit: l.einheit,
      einheitspreis: l.einheitspreis ?? f.einheitspreis,
    }));
    setSelectedLeistungId(l.id);
    setLeistungSearch("");
  }

  const selectedLeistung = selectedLeistungId ? leistungen.find((l) => l.id === selectedLeistungId) : null;

  const add = useMutation({
    mutationFn: async () => {
      let lvId: string;
      if (lvList.length > 0) {
        lvId = lvList[0].id;
      } else {
        const lvRes = await apiClient.POST("/api/lv", {
          body: { angebot_id: angebotId, source: "manual" },
        });
        lvId = (unwrap(lvRes) as LvRead).id;
      }
      const res = await apiClient.POST("/api/lv-position", {
        body: {
          lv_id: lvId,
          kurztext: form.kurztext,
          langtext: form.langtext || undefined,
          menge: form.menge || undefined,
          menge_formel: form.menge_formel || undefined,
          einheit: form.einheit || undefined,
          einheitspreis: form.einheitspreis || undefined,
          matched_leistung_id: selectedLeistungId || undefined,
          match_confidence: selectedLeistungId ? "1.00" : undefined,
          source: "manual",
          match_status: "confirmed",
        },
      });
      return unwrap(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      qc.invalidateQueries({ queryKey: ["angebot", angebotId] });
      qc.invalidateQueries({ queryKey: ["lv", { angebot_id: angebotId }] });
      setForm({ kurztext: "", langtext: "", menge: "", menge_formel: null, einheit: "", einheitspreis: "" });
      setLeistungSearch("");
      setSelectedLeistungId(null);
      onClose();
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Position hinzufügen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">

          {/* Leistung autosuggest */}
          {leistungen.length > 0 && (
            <div className="relative">
              <label className="text-sm font-medium">Leistung aus Katalog (optional)</label>
              {selectedLeistung ? (
                <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted px-2 py-1.5 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{selectedLeistung.code}</span>
                  <span className="flex-1 truncate">{selectedLeistung.kurztext}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                    onClick={() => { setSelectedLeistungId(null); setLeistungSearch(""); }}
                  >✕</button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={leistungSearch}
                      onChange={(e) => setLeistungSearch(e.target.value)}
                      placeholder="Bezeichnung oder Code eingeben…"
                      className="pl-8"
                      autoFocus
                    />
                  </div>
                  {suggestions.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                      {suggestions.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent"
                          onMouseDown={(e) => { e.preventDefault(); applyLeistung(l); }}
                        >
                          <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{l.code}</span>
                          <span className="flex-1 truncate">{l.kurztext}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{l.einheit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="border-t pt-3 space-y-3">
            <div>
              <label htmlFor="pos-kurztext" className="text-sm font-medium">Kurztext *</label>
              <Input
                id="pos-kurztext"
                value={form.kurztext}
                onChange={set("kurztext")}
                placeholder="Wände streichen 2× Dispersionsfarbe"
                className="mt-1"
                autoFocus={leistungen.length === 0}
              />
            </div>
            <div>
              <label htmlFor="pos-langtext" className="text-sm font-medium">Positionstext</label>
              <Input
                id="pos-langtext"
                value={form.langtext}
                onChange={set("langtext")}
                placeholder="Detaillierte Beschreibung der Leistung…"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="pos-menge" className="text-sm font-medium">Menge</label>
              <MengeInput
                id="pos-menge"
                value={form.menge}
                formula={form.menge_formel}
                onChange={(menge, formula) => setForm((f) => ({ ...f, menge, menge_formel: formula }))}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pos-einheit" className="text-sm font-medium">Einheit</label>
                <Input
                  id="pos-einheit"
                  value={form.einheit}
                  onChange={set("einheit")}
                  placeholder="m²"
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="pos-ep" className="text-sm font-medium">EP (€)</label>
                <Input
                  id="pos-ep"
                  value={form.einheitspreis.replace(".", ",")}
                  onChange={(e) => setForm((f) => ({ ...f, einheitspreis: e.target.value.replace(",", ".") }))}
                  placeholder="12,50"
                  inputMode="decimal"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            disabled={!form.kurztext || add.isPending}
            onClick={() => add.mutate()}
          >
            Hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AngebotReview() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPositionId, setPickerPositionId] = useState<string | null>(null);
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [editPositionId, setEditPositionId] = useState<string | null>(null);

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
          menge_formel: position.menge_formel,
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
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      // Advance to next position
      setActiveIndex((i) => Math.min(i + 1, sortedPositions.length - 1));
    },
    onError: (err) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        qc.invalidateQueries({ queryKey: ["lv-position"] });
        qc.invalidateQueries({ queryKey: ["angebot", id] });
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
          menge_formel: position.menge_formel,
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
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      toast.success("Leistung zugewiesen und bestätigt.");
    },
    onError: (err) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        qc.invalidateQueries({ queryKey: ["lv-position"] });
        qc.invalidateQueries({ queryKey: ["angebot", id] });
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
      qc.invalidateQueries({ queryKey: ["lv-position"] });
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

  const deletePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      await apiClient.DELETE("/api/lv-position/{id}", {
        params: { path: { id: positionId } },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      qc.invalidateQueries({ queryKey: ["angebot", id] });
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const bulkAcceptMutation = useMutation({
    mutationFn: async () => {
      const confirmable = sortedPositions.filter(
        (p) =>
          p.match_status !== "confirmed" &&
          (p.matched_leistung_id !== null || p.source === "manual"),
      );
      await Promise.all(
        confirmable.map((pos) =>
          apiClient.PUT("/api/lv-position/{id}", {
            params: { path: { id: pos.id } },
            body: {
              row_version: pos.row_version,
              oz: pos.oz,
              kurztext: pos.kurztext,
              langtext: pos.langtext,
              menge: pos.menge,
              menge_formel: pos.menge_formel,
              einheit: pos.einheit,
              einheitspreis: pos.einheitspreis,
              matched_leistung_id: pos.matched_leistung_id,
              match_confidence: pos.match_confidence,
              match_status: "confirmed",
              source: pos.source,
              position_nr: pos.position_nr,
            },
          }),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lv-position"] });
      qc.invalidateQueries({ queryKey: ["angebot", id] });
      toast.success("Alle Positionen bestätigt.");
    },
    onError: (err) =>
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`),
  });

  const handleAccept = useCallback(
    (index: number) => {
      const pos = sortedPositions[index];
      if (!pos) return;
      // Manual positions without a catalog match can be confirmed directly
      if (!pos.matched_leistung_id && pos.source !== "manual") return;
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
        {sortedPositions.some(
          (p) =>
            p.match_status !== "confirmed" &&
            (p.matched_leistung_id !== null || p.source === "manual"),
        ) && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => bulkAcceptMutation.mutate()}
            disabled={bulkAcceptMutation.isPending}
          >
            {bulkAcceptMutation.isPending ? "…" : "Alle annehmen"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setShowAddPosition(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Position
        </Button>
        {/* Keyboard hint */}
        <div className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground/60">
          <Keyboard className="h-3 w-3" />
          <span>j/k navigieren · a annehmen · c korrigieren · x quittieren</span>
        </div>
      </div>

      {/* Position list */}
      {sortedPositions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-muted-foreground text-sm">
              Keine Positionen in diesem Angebot.
            </p>
            <Button size="sm" onClick={() => setShowAddPosition(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Position hinzufügen
            </Button>
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
                onEdit={() => setEditPositionId(position.id)}
                onDelete={() => deletePositionMutation.mutate(position.id)}
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

      {/* Edit position dialog — always looks up the live position from cache so row_version is never stale */}
      <EditPositionDialog
        angebotId={id!}
        position={editPositionId ? (sortedPositions.find((p) => p.id === editPositionId) ?? null) : null}
        leistungen={allLeistungen}
        katalogList={katalogList ?? []}
        open={editPositionId !== null}
        onClose={() => setEditPositionId(null)}
      />

      {/* Add position dialog */}
      <AddPositionDialog
        angebotId={id!}
        lvList={lvList ?? []}
        leistungen={allLeistungen}
        open={showAddPosition}
        onClose={() => setShowAddPosition(false)}
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
