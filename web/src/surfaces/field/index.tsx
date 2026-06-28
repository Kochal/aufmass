/**
 * Field surface stub — Aufmaß capture for Monteur / Geselle.
 *
 * This surface is reserved but NOT built in this phase. The Aufmaß
 * DB tables (migration 0020) and vision client exist; the backend HTTP
 * endpoints and reconciliation engine do not yet. Building UI against a
 * guessed API shape would be premature — see notes/ui/ for the decision.
 *
 * When the extraction API lands, this becomes the camera-first, one-hand
 * PWA surface: very large tap targets, photo-first capture, card-by-card
 * crop verification. See the UX brief in notes/ui/ for the interaction model.
 */
export function FieldStub() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center space-y-3 max-w-sm">
        <p className="text-4xl">📐</p>
        <h1 className="text-xl font-semibold">Aufmaß</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Die Aufmaß-Erfassung wird freigeschaltet, sobald der
          Extraktions-Endpunkt bereit ist.
        </p>
        <p className="text-xs text-muted-foreground/60 font-mono">
          Geplant: Direktive 07
        </p>
      </div>
    </div>
  );
}
