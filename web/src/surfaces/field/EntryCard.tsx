import { useState } from "react";
import type { components } from "@/api/schema";
import { cn, confidenceTier, formatMenge } from "@/lib/utils";
import { ConfidenceBand } from "@/surfaces/office/quotes/ConfidenceBand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCheck, Pencil, Trash2 } from "lucide-react";

type AufmassEntryRead = components["schemas"]["AufmassEntryRead"];

interface CorrectValues {
  written_result?: string;
  bauteil?: string;
  einheit?: string;
}

interface Props {
  entry: AufmassEntryRead;
  onConfirm: (entry: AufmassEntryRead) => void;
  onCorrect: (entry: AufmassEntryRead, values: CorrectValues) => void;
  onDelete: (entry: AufmassEntryRead) => void;
  confirming: boolean;
  correcting: boolean;
}

const STATUS_CFG: Record<string, { label: string; variant: string }> = {
  review:    { label: "Prüfen",     variant: "confidence-mid" },
  confirmed: { label: "Bestätigt",  variant: "confidence-high" },
  corrected: { label: "Korrigiert", variant: "default" },
};

export function EntryCard({
  entry,
  onConfirm,
  onCorrect,
  onDelete,
  confirming,
  correcting,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [writtenResult, setWrittenResult] = useState("");
  const [bauteil, setBauteil] = useState("");
  const [einheit, setEinheit] = useState("");

  const tier = confidenceTier(
    entry.confidence != null ? String(entry.confidence) : undefined,
    entry.review_status === "confirmed" ? "confirmed" : undefined,
  );
  const rawText = (entry.candidate_readings as Record<string, unknown> | null)
    ?.raw_text as string | undefined;
  const isConfirmed = entry.review_status === "confirmed";
  const statusCfg = STATUS_CFG[entry.review_status] ?? { label: entry.review_status, variant: "outline" };

  function startEdit() {
    setWrittenResult(entry.written_result != null ? String(entry.written_result) : "");
    setBauteil(entry.bauteil ?? "");
    setEinheit(entry.einheit ?? "");
    setEditing(true);
  }

  function handleSave() {
    const values: CorrectValues = {};
    if (writtenResult) values.written_result = writtenResult;
    if (bauteil) values.bauteil = bauteil;
    if (einheit) values.einheit = einheit;
    onCorrect(entry, values);
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "flex rounded-lg border overflow-hidden transition-shadow",
        isConfirmed
          ? "border-border opacity-70"
          : "border-border hover:border-muted-foreground/30",
      )}
    >
      <ConfidenceBand tier={tier} className="self-stretch rounded-none" />

      <div className="flex-1 p-3 space-y-2 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          {entry.bauteil && !editing && (
            <span className="text-sm font-medium">{entry.bauteil}</span>
          )}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Badge variant={statusCfg.variant as any} className="text-[10px] px-1.5 py-0 h-4">
            {statusCfg.label}
          </Badge>
          {entry.confidence != null && (
            <span className="text-xs text-muted-foreground font-mono ml-auto">
              {(parseFloat(String(entry.confidence)) * 100).toFixed(0)}%
            </span>
          )}
        </div>

        {/* Main value */}
        {!editing && (
          <p className="text-2xl font-mono font-semibold tabular-nums">
            {entry.written_result != null
              ? formatMenge(String(entry.written_result), entry.einheit)
              : <span className="text-muted-foreground text-base">—</span>}
          </p>
        )}

        {/* Raw OCR text */}
        {rawText && !editing && (
          <p className="text-xs text-muted-foreground font-mono">{rawText}</p>
        )}

        {/* Inline edit form */}
        {editing && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Bauteil</label>
                <Input
                  value={bauteil}
                  onChange={(e) => setBauteil(e.target.value)}
                  className="h-8 text-sm mt-0.5"
                  placeholder="z.B. Boden"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Einheit</label>
                <Input
                  value={einheit}
                  onChange={(e) => setEinheit(e.target.value)}
                  className="h-8 text-sm mt-0.5"
                  placeholder="m2"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Messwert</label>
              <Input
                value={writtenResult}
                onChange={(e) => setWrittenResult(e.target.value)}
                className="h-8 text-sm font-mono mt-0.5"
                placeholder="0.000"
              />
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={correcting}
              >
                {correcting ? "…" : "Speichern"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!editing && (
          <div className="flex items-center gap-1.5">
            {!isConfirmed && (
              <>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => onConfirm(entry)}
                  disabled={confirming}
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  {confirming ? "…" : "Bestätigen"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={startEdit}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Korrigieren
                </Button>
              </>
            )}
            {isConfirmed && (
              <div className="flex items-center gap-1 text-xs text-confidence-high-fg">
                <CheckCheck className="h-3 w-3" />
                Bestätigt
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground ml-1"
                  onClick={startEdit}
                >
                  Ändern
                </Button>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(entry)}
              title="Eintrag löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
