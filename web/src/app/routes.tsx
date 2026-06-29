/**
 * Route tree for the Aufmaß app.
 *
 * Three surfaces:
 *   office/* — quote review, invoices, clients
 *   field/*  — Aufmaß capture and entry review
 *   /dashboard — owner overview (stub)
 */
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { AngebotList } from "@/surfaces/office/quotes/AngebotList";
import { AngebotReview } from "@/surfaces/office/quotes/AngebotReview";
import { KatalogList, KatalogDetail } from "@/surfaces/office/katalog";
import { AuftraggeberList, AuftraggeberDetail } from "@/surfaces/office/auftraggeber";
import { ProjektList, ProjektDetail } from "@/surfaces/office/projekte";
import { RechnungList, RechnungDetail } from "@/surfaces/office/rechnungen";
import { ArbeitszeitList } from "@/surfaces/office/arbeitszeit";
import { FahrtenbuchList } from "@/surfaces/office/fahrtenbuch";
import { FahrtzeitenList } from "@/surfaces/office/fahrtzeiten";
import { MangelList, MangelDetail } from "@/surfaces/office/mangel";
import { GewaehrleistungList } from "@/surfaces/office/gewaehrleistung";
import { LieferantList } from "@/surfaces/office/lieferanten";
import { MaterialList } from "@/surfaces/office/material";
import { BestellungList, BestellungDetail } from "@/surfaces/office/bestellungen";
import { AufmassList, AufmassReview } from "@/surfaces/field";
import { DashboardStub } from "@/surfaces/dashboard";
import { useAuth, canAccessOffice, canAccessField } from "@/auth/AuthContext";

/** Redirect to the right landing page for the active role. */
function RoleRedirect() {
  const { principal } = useAuth();
  const role = principal?.role ?? "buero";
  if (canAccessOffice(role)) return <Navigate to="/office/angebote" replace />;
  if (canAccessField(role)) return <Navigate to="/field" replace />;
  return <Navigate to="/dashboard" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Root redirect */}
        <Route index element={<RoleRedirect />} />

        {/* Office surface */}
        <Route path="office">
          <Route path="angebote" element={<AngebotList />} />
          <Route path="angebote/:id/review" element={<AngebotReview />} />
          <Route path="rechnungen" element={<RechnungList />} />
          <Route path="rechnungen/:id" element={<RechnungDetail />} />
          <Route path="auftraggeber" element={<AuftraggeberList />} />
          <Route path="auftraggeber/:id" element={<AuftraggeberDetail />} />
          <Route path="projekte" element={<ProjektList />} />
          <Route path="projekte/:id" element={<ProjektDetail />} />
          <Route path="arbeitszeit" element={<ArbeitszeitList />} />
          <Route path="fahrtenbuch" element={<FahrtenbuchList />} />
          <Route path="fahrtzeiten" element={<FahrtzeitenList />} />
          <Route path="mangel" element={<MangelList />} />
          <Route path="mangel/:id" element={<MangelDetail />} />
          <Route path="gewaehrleistung" element={<GewaehrleistungList />} />
          <Route path="lieferanten" element={<LieferantList />} />
          <Route path="material" element={<MaterialList />} />
          <Route path="bestellungen" element={<BestellungList />} />
          <Route path="bestellungen/:id" element={<BestellungDetail />} />
          <Route path="katalog" element={<KatalogList />} />
          <Route path="katalog/:id" element={<KatalogDetail />} />
        </Route>

        {/* Field surface */}
        <Route path="field">
          <Route index element={<AufmassList />} />
          <Route path=":aufmassId" element={<AufmassReview />} />
        </Route>

        {/* Owner dashboard (deferred) */}
        <Route path="dashboard" element={<DashboardStub />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
