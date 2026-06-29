/**
 * Dev sign-in screen — sets the X-Tenant-Id / X-User-Id header stub.
 *
 * This is the seam where real Entra ID SSO (directive 09) plugs in. The rest
 * of the app sees only `principal` from AuthContext. Replace this component
 * with an Entra redirect / MSAL flow; the Principal shape stays the same.
 *
 * Clearly badged as dev-only to avoid confusion in screenshots / demos.
 */
import { useState } from "react";
import { useAuth, type Role } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Inhaber / Admin",
  buero: "Büro",
  buchhaltung: "Buchhaltung",
  monteur: "Monteur / Geselle",
};

/** Quick-access presets — seeded demo tenant (seed.py T1_ID / T1_USER_ID). */
const PRESETS: Array<{ label: string; tenantId: string; userId: string; role: Role }> = [
  {
    label: "Büro (Demo)",
    tenantId: "11111111-0000-0000-0000-000000000001",
    userId: "11111111-0000-0000-0000-000000000002",
    role: "buero",
  },
  {
    label: "Admin (Demo)",
    tenantId: "11111111-0000-0000-0000-000000000001",
    userId: "11111111-0000-0000-0000-000000000002",
    role: "admin",
  },
  {
    label: "Monteur (Demo)",
    tenantId: "11111111-0000-0000-0000-000000000001",
    userId: "11111111-0000-0000-0000-000000000002",
    role: "monteur",
  },
];

export function DevLogin() {
  const { login } = useAuth();
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("buero");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!UUID_RE.test(tenantId)) {
      setError("Tenant-ID muss eine gültige UUID sein.");
      return;
    }
    if (!UUID_RE.test(userId)) {
      setError("Benutzer-ID muss eine gültige UUID sein.");
      return;
    }
    login({ tenantId, userId, role, displayName: displayName || role });
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setTenantId(p.tenantId);
    setUserId(p.userId);
    setRole(p.role);
    setDisplayName(p.label);
  }

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Aufmaß</CardTitle>
            <span className="text-xs font-mono bg-destructive/10 text-destructive px-2 py-0.5 rounded">
              Dev-Login
            </span>
          </div>
          <CardDescription>
            Setzt X-Tenant-Id / X-User-Id Header (Backend-Stub). Wird durch
            Entra ID SSO ersetzt wenn Direktive 09 implementiert ist.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick presets */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Schnellzugriff
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="tenantId">
                Tenant-ID (UUID)
              </label>
              <Input
                id="tenantId"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="userId">
                Benutzer-ID (UUID)
              </label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="role">
                Rolle
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.entries(ROLE_LABELS) as [Role, string][]).map(
                  ([r, label]) => (
                    <option key={r} value={r}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="displayName">
                Anzeigename (optional)
              </label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Max Mustermann"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full">
              Anmelden
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
