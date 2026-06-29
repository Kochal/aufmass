import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, unwrap } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import type { components } from "@/api/schema";

type AdresseRead = components["schemas"]["AdresseRead"];

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
  function set(key: keyof AddressState, value: string) {
    onChange({ ...state, [key]: value });
  }

  return (
    <div className="space-y-3">
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
