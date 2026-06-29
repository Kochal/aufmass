import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Clock, Euro, FolderOpen,
  Navigation, PackageCheck, ShieldAlert, ShieldCheck, TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, unwrap } from "@/lib/api";
import type { components } from "@/api/schema";

type DashboardSummary = components["schemas"]["DashboardSummary"];

// ── Stat card ─────────────────────────────────────────────────────────────────

type Urgency = "normal" | "warn" | "danger" | "muted";

function StatCard({
  value, label, to, urgency = "normal", icon: Icon,
}: {
  value: number | string; label: string; to?: string; urgency?: Urgency;
  icon?: React.ElementType;
}) {
  const colorMap: Record<Urgency, string> = {
    normal: "text-foreground",
    warn:   "text-orange-600",
    danger: "text-red-600",
    muted:  "text-muted-foreground",
  };
  const bgMap: Record<Urgency, string> = {
    normal: "bg-card border",
    warn:   "bg-orange-50 border border-orange-200",
    danger: "bg-red-50 border border-red-200",
    muted:  "bg-muted/40 border",
  };

  const inner = (
    <div className={`rounded-lg p-4 ${bgMap[urgency]} flex flex-col gap-1`}>
      <div className={`text-2xl font-semibold tabular-nums ${colorMap[urgency]}`}>
        {value}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        <span>{label}</span>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block hover:opacity-80 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ── Section header ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {children}
      </div>
    </div>
  );
}

// ── Money formatter ────────────────────────────────────────────────────────────

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard"],
    queryFn: async () => unwrap(await apiClient.GET("/api/dashboard")) as DashboardSummary,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <Skeleton className="h-4 w-32 mb-3" />
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-20" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const hasActionNeeded =
    data.maengel_ueberfaellig > 0 ||
    data.gewaehrleistung_ueberfaellig > 0 ||
    data.rechnungen_entwurf > 0 ||
    data.arbeitszeit_offen > 0 ||
    data.fahrt_offen > 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Übersicht</h1>
        {hasActionNeeded && (
          <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Es gibt offene Punkte, die Ihre Aufmerksamkeit erfordern.
          </p>
        )}
      </div>

      {/* Projekte */}
      <Section title="Projekte">
        <StatCard
          value={data.projekte_in_ausfuehrung} label="In Ausführung"
          to="/office/projekte" icon={FolderOpen}
          urgency={data.projekte_in_ausfuehrung > 0 ? "normal" : "muted"}
        />
        <StatCard
          value={data.projekte_beauftragt} label="Beauftragt"
          to="/office/projekte"
          urgency={data.projekte_beauftragt > 0 ? "normal" : "muted"}
        />
        <StatCard
          value={data.projekte_kalkulation} label="In Kalkulation"
          to="/office/projekte"
          urgency={data.projekte_kalkulation > 0 ? "normal" : "muted"}
        />
        <StatCard
          value={data.projekte_gewaehrleistung} label="In Gewährleistung"
          to="/office/projekte"
          urgency={data.projekte_gewaehrleistung > 0 ? "normal" : "muted"}
        />
      </Section>

      {/* Handlungsbedarf */}
      <Section title="Handlungsbedarf">
        <StatCard
          value={data.maengel_ueberfaellig} label="Mängel überfällig"
          to="/office/mangel" icon={AlertTriangle}
          urgency={data.maengel_ueberfaellig > 0 ? "danger" : "muted"}
        />
        <StatCard
          value={data.maengel_offen_schwer} label="Mängel schwer (offen)"
          to="/office/mangel" icon={AlertTriangle}
          urgency={data.maengel_offen_schwer > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.rechnungen_entwurf} label="Rechnungen Entwurf"
          to="/office/rechnungen"
          urgency={data.rechnungen_entwurf > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.angebote_entwurf} label="Angebote Entwurf"
          to="/office/angebote"
          urgency={data.angebote_entwurf > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.arbeitszeit_offen} label="Arbeitszeit zur Freigabe"
          to="/office/arbeitszeit" icon={Clock}
          urgency={data.arbeitszeit_offen > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.fahrt_offen} label="Fahrten zur Freigabe"
          to="/office/fahrtzeiten" icon={Navigation}
          urgency={data.fahrt_offen > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.bestellungen_offen} label="Bestellungen offen"
          to="/office/bestellungen" icon={PackageCheck}
          urgency={data.bestellungen_offen > 0 ? "normal" : "muted"}
        />
      </Section>

      {/* Gewährleistung */}
      <Section title="Gewährleistung">
        <StatCard
          value={data.gewaehrleistung_ueberfaellig} label="Überfällig"
          to="/office/gewaehrleistung" icon={ShieldAlert}
          urgency={data.gewaehrleistung_ueberfaellig > 0 ? "danger" : "muted"}
        />
        <StatCard
          value={data.gewaehrleistung_expiring_soon} label="Läuft ab (90 Tage)"
          to="/office/gewaehrleistung" icon={ShieldAlert}
          urgency={data.gewaehrleistung_expiring_soon > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.gewaehrleistung_laufend} label="Laufend gesamt"
          to="/office/gewaehrleistung" icon={ShieldCheck}
        />
        <StatCard
          value={data.maengel_offen} label="Mängel offen gesamt"
          to="/office/mangel" icon={AlertTriangle}
          urgency={data.maengel_offen > 0 ? "normal" : "muted"}
        />
      </Section>

      {/* Finanzen */}
      <Section title="Finanzen">
        <StatCard
          value={data.rechnungen_ausgestellt} label="Rechnungen ausgestellt"
          to="/office/rechnungen" icon={TrendingUp}
        />
        <StatCard
          value={fmtMoney(data.rechnungen_summe_brutto)} label="Summe ausgestellt (brutto)"
          to="/office/rechnungen" icon={Euro}
        />
        <StatCard
          value={data.rechnungen_entwurf} label="Noch nicht ausgestellt"
          to="/office/rechnungen"
          urgency={data.rechnungen_entwurf > 0 ? "warn" : "muted"}
        />
        <StatCard
          value={data.angebote_entwurf} label="Angebote noch offen"
          to="/office/angebote"
          urgency="muted"
        />
      </Section>
    </div>
  );
}
