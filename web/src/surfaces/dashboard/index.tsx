/**
 * Owner dashboard stub.
 *
 * The dashboard shows: what is in flight, what needs review, what warranties
 * expire soon, what is unbilled. Simple overview, not analytics theatre.
 *
 * Deferred to a follow-up phase so the office quote-review screen (the product
 * differentiator) ships first.
 */
export function DashboardStub() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center space-y-3 max-w-sm">
        <p className="text-4xl">📊</p>
        <h1 className="text-xl font-semibold">Übersicht</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Das Dashboard zeigt laufende Projekte, ausstehende Prüfungen,
          ablaufende Gewährleistungen und offene Rechnungen.
        </p>
        <p className="text-xs text-muted-foreground/60 font-mono">
          Folge-Phase
        </p>
      </div>
    </div>
  );
}
