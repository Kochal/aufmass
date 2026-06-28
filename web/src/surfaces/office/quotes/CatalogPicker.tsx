/**
 * CatalogPicker — command-palette modal for selecting a Leistung.
 *
 * Opens via keyboard shortcut 'c' on the active position in the review screen.
 * The reviewer types to search catalog items by code, Kurztext, or Langtext;
 * pressing Enter (or clicking) confirms the selection.
 *
 * The UI shows each item's code, Kurztext, and Einheitspreis so the reviewer
 * can verify they're selecting the right catalog entry before committing. This
 * is the provenance point for the price: code → catalog entry → Einheitspreis.
 *
 * Note: ranked multi-candidate suggestions (directive 06 vector matching) are
 * deferred until the GPU extraction pipeline is live. The current picker is a
 * searchable full-catalog list. The swap-in point is here: replace the flat
 * list with a ranked candidate list when that feed exists.
 */
import type { components } from "@/api/schema";
import { formatEuro } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type LeistungRead = components["schemas"]["LeistungRead"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the reviewer confirms a catalog selection. */
  onSelect: (leistung: LeistungRead) => void;
  leistungen: LeistungRead[];
  /** Kurztext of the position being corrected — shown in the dialog title. */
  positionKurztext?: string | null;
}

export function CatalogPicker({
  open,
  onOpenChange,
  onSelect,
  leistungen,
  positionKurztext,
}: Props) {
  const active = leistungen.filter((l) => l.aktiv);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-sm font-medium">
            Leistung auswählen
            {positionKurztext && (
              <span className="font-normal text-muted-foreground ml-2 truncate max-w-xs inline-block align-bottom">
                — {positionKurztext}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <Command className="border-none">
          <CommandInput placeholder="Code, Kurztext oder Langtext …" autoFocus />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>Keine Leistung gefunden.</CommandEmpty>
            <CommandGroup>
              {active.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`${l.code} ${l.kurztext} ${l.langtext ?? ""}`}
                  onSelect={() => {
                    onSelect(l);
                    onOpenChange(false);
                  }}
                  className="py-2"
                >
                  <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">
                    {l.code}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{l.kurztext}</p>
                    {l.langtext && (
                      <p className="text-xs text-muted-foreground truncate">
                        {l.langtext}
                      </p>
                    )}
                  </div>
                  <div className="ml-4 text-right shrink-0">
                    {l.einheitspreis && (
                      <p className="text-sm font-mono">
                        {formatEuro(l.einheitspreis)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{l.einheit}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
