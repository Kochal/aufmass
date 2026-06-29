import { useCallback, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { apiClient, unwrap } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import type { components } from "@/api/schema";

type AdresseRead = components["schemas"]["AdresseRead"];
type GeocodeResult = components["schemas"]["GeocodeResult"];

// ── Address state ─────────────────────────────────────────────────────────────

export interface AddressState {
  strasse: string;
  hausnummer: string;
  adresszusatz: string;
  plz: string;
  ort: string;
  land: string;
}

export function emptyAddressState(): AddressState {
  return { strasse: "", hausnummer: "", adresszusatz: "", plz: "", ort: "", land: "DE" };
}

export function addressFromRead(a: AdresseRead): AddressState {
  return {
    strasse: a.strasse ?? "",
    hausnummer: a.hausnummer ?? "",
    adresszusatz: a.adresszusatz ?? "",
    plz: a.plz ?? "",
    ort: a.ort ?? "",
    land: a.land ?? "DE",
  };
}

// ── useAdresseUpsert ──────────────────────────────────────────────────────────

interface UpsertOptions {
  adresseId: string | null;
  state: AddressState;
}

export function useAdresseUpsert() {
  return useCallback(async ({ adresseId, state }: UpsertOptions): Promise<string | null> => {
    const isBlank = !state.strasse && !state.hausnummer && !state.plz && !state.ort;

    if (adresseId) {
      const current = await apiClient.GET("/api/adresse/{id}", {
        params: { path: { id: adresseId } },
      });
      const cur = unwrap(current) as AdresseRead;
      await apiClient.PUT("/api/adresse/{id}", {
        params: { path: { id: adresseId } },
        body: {
          row_version: cur.row_version,
          strasse: state.strasse || null,
          hausnummer: state.hausnummer || null,
          adresszusatz: state.adresszusatz || null,
          plz: state.plz || null,
          ort: state.ort || null,
          land: state.land || "DE",
        },
      });
      return adresseId;
    }

    if (isBlank) return null;

    const res = await apiClient.POST("/api/adresse", {
      body: {
        strasse: state.strasse || null,
        hausnummer: state.hausnummer || null,
        adresszusatz: state.adresszusatz || null,
        plz: state.plz || null,
        ort: state.ort || null,
        land: state.land || "DE",
      },
    });
    const created = unwrap(res) as AdresseRead;
    return created.id;
  }, []);
}

// ── useAdresseLoad ────────────────────────────────────────────────────────────

export function useAdresseLoad(adresseId: string | null | undefined) {
  return useQuery<AdresseRead>({
    queryKey: ["adresse", adresseId],
    queryFn: async () =>
      unwrap(await apiClient.GET("/api/adresse/{id}", {
        params: { path: { id: adresseId! } },
      })) as AdresseRead,
    enabled: !!adresseId,
  });
}

// ── AddressFields component ───────────────────────────────────────────────────

interface AddressFieldsProps {
  state: AddressState;
  onChange: (s: AddressState) => void;
  idPrefix?: string;
}

export function AddressFields({ state, onChange, idPrefix = "addr" }: AddressFieldsProps) {
  // Geocode search: only fires on explicit button press (Nominatim policy
  // prohibits autocomplete / per-keystroke requests).
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  function set(key: keyof AddressState, value: string) {
    onChange({ ...state, [key]: value });
  }

  async function handleSearch() {
    const q = searchQuery.trim() || state.strasse.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSuggestions(null);
    try {
      const cached = qc.getQueryData<GeocodeResult[]>(["geocode", q]);
      if (cached) {
        setSuggestions(cached);
      } else {
        const res = unwrap(await apiClient.GET("/api/geocode", {
          params: { query: { q } },
        })) as GeocodeResult[];
        qc.setQueryData(["geocode", q], res);
        setSuggestions(res);
      }
    } finally {
      setSearching(false);
    }
  }

  function applySuggestion(hit: GeocodeResult) {
    onChange({
      ...state,
      strasse: hit.strasse ?? state.strasse,
      hausnummer: hit.hausnummer ?? state.hausnummer,
      plz: hit.plz ?? state.plz,
      ort: hit.ort ?? state.ort,
      land: hit.land ?? state.land,
    });
    setSuggestions(null);
    setSearchQuery("");
  }

  return (
    <div className="space-y-3">
      {/* Address search (explicit button — no per-keystroke requests per Nominatim policy) */}
      <div ref={containerRef} className="relative">
        <label className="text-sm font-medium">Adresse suchen</label>
        <div className="flex gap-2 mt-1">
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value.trim()) setSuggestions(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
            placeholder="z.B. Musterstraße 12 Berlin"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={searching || (searchQuery.trim().length < 3 && state.strasse.trim().length < 3)}
            onClick={handleSearch}
            title="Adresse suchen"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {suggestions !== null && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
            {suggestions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Keine Ergebnisse gefunden.</p>
            ) : (
              suggestions.map((hit, i) => (
                <button
                  key={i}
                  type="button"
                  className="flex items-start gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => { e.preventDefault(); applySuggestion(hit); }}
                >
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2 text-xs leading-snug">{hit.label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Manual address fields */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label htmlFor={`${idPrefix}-strasse`} className="text-sm font-medium">Straße</label>
          <Input
            id={`${idPrefix}-strasse`}
            value={state.strasse}
            onChange={(e) => set("strasse", e.target.value)}
            placeholder="Musterstraße"
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-hn`} className="text-sm font-medium">Hausnr.</label>
          <Input
            id={`${idPrefix}-hn`}
            value={state.hausnummer}
            onChange={(e) => set("hausnummer", e.target.value)}
            placeholder="12a"
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-zusatz`} className="text-sm font-medium">Adresszusatz</label>
        <Input
          id={`${idPrefix}-zusatz`}
          value={state.adresszusatz}
          onChange={(e) => set("adresszusatz", e.target.value)}
          placeholder="c/o, Hinterhaus, …"
          className="mt-1"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-plz`} className="text-sm font-medium">PLZ</label>
          <Input
            id={`${idPrefix}-plz`}
            value={state.plz}
            onChange={(e) => set("plz", e.target.value)}
            placeholder="10115"
            className="mt-1"
          />
        </div>
        <div className="col-span-2">
          <label htmlFor={`${idPrefix}-ort`} className="text-sm font-medium">Ort</label>
          <Input
            id={`${idPrefix}-ort`}
            value={state.ort}
            onChange={(e) => set("ort", e.target.value)}
            placeholder="Berlin"
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-land`} className="text-sm font-medium">Land</label>
        <Combobox
          className="mt-1"
          options={COUNTRY_OPTIONS}
          value={state.land}
          onChange={(v) => set("land", v || "DE")}
          placeholder="Land wählen…"
          searchPlaceholder="Land suchen…"
        />
      </div>
    </div>
  );
}
