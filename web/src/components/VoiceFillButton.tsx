/**
 * Pure presenter for the tap-to-toggle voice fill mic button (directive 10).
 *
 * The caller owns the useVoiceFill hook state and passes down the relevant
 * slice. VoiceFillButton only renders and calls onToggle.
 *
 * Confirm-before-commit: this button never writes to form state. The parent
 * shows a confirmation strip; the worker taps Übernehmen to accept fills.
 */
import { Loader2, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  recording: boolean;
  busy: boolean;
  onToggle: () => void;
  className?: string;
}

export function VoiceFillButton({ recording, busy, onToggle, className }: Props) {
  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      size="sm"
      className={`h-8 w-8 p-0 shrink-0 ${className ?? ""}`}
      onClick={onToggle}
      disabled={busy}
      title={recording ? "Aufnahme beenden" : "Sprachaufnahme starten"}
      aria-label={recording ? "Aufnahme beenden" : "Sprachaufnahme starten"}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
