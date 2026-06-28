/**
 * Route tree for the Aufmaß app.
 *
 * Three surfaces:
 *   office/* — quote review, invoices, clients (live in this phase)
 *   field/*  — Aufmaß capture (stub — no backend endpoints yet, see notes/ui/)
 *   /dashboard — owner overview (stub)
 *
 * The app shell handles the sidebar nav; each surface owns its layout within
 * the <Outlet />.
 */
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { AngebotList } from "@/surfaces/office/quotes/AngebotList";
import { AngebotReview } from "@/surfaces/office/quotes/AngebotReview";
import { FieldStub } from "@/surfaces/field";
import { DashboardStub } from "@/surfaces/dashboard";
import { useAuth, canAccessOffice, canAccessField } from "@/auth/AuthContext";

/** Simple stub for routes that are reserved but not yet built. */
function ComingSoon({ name }: { name: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-2xl">🚧</p>
        <p className="text-lg font-medium">{name}</p>
        <p className="text-sm text-muted-foreground">Kommt bald</p>
      </div>
    </div>
  );
}

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
          <Route
            path="rechnungen"
            element={<ComingSoon name="Rechnungen" />}
          />
          <Route
            path="auftraggeber"
            element={<ComingSoon name="Auftraggeber" />}
          />
        </Route>

        {/* Field surface (deferred) */}
        <Route path="field/*" element={<FieldStub />} />

        {/* Owner dashboard (deferred) */}
        <Route path="dashboard" element={<DashboardStub />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
