/**
 * App shell — sidebar nav + main content area.
 *
 * Three surfaces, one shell:
 *   • office/* — Büro/Admin/Buchhaltung (desktop dense)
 *   • field/*  — Monteur/Admin (deferred, reserved in nav)
 *   • /dashboard — Admin overview (deferred, reserved in nav)
 *
 * Nav items are filtered by the active role so each persona sees their
 * surface and no more (directive 09 RBAC). The sidebar is hidden on very
 * small screens since office is desktop-only in this phase.
 */
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Clock,
  FileText,
  FolderOpen,
  HardHat,
  LayoutDashboard,
  LogOut,
  Receipt,
  Users,
} from "lucide-react";
import { useAuth, canAccessOffice, canAccessField, canAccessDashboard } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  /** true = this screen is a stub ("Kommt bald") */
  stub?: boolean;
}

export function AppShell() {
  const { principal, logout } = useAuth();
  const navigate = useNavigate();

  const role = principal?.role ?? "buero";

  const navItems: NavItem[] = [
    ...(canAccessDashboard(role)
      ? [{ to: "/dashboard", icon: LayoutDashboard, label: "Übersicht", stub: true }]
      : []),
    ...(canAccessOffice(role)
      ? [
          { to: "/office/angebote", icon: FileText, label: "Angebote" },
          // Rechnungen, Auftraggeber, Projekte — reserved, stub
          { to: "/office/katalog", icon: BookOpen, label: "Katalog" },
          { to: "/office/rechnungen", icon: Receipt, label: "Rechnungen" },
          { to: "/office/auftraggeber", icon: Users, label: "Auftraggeber" },
          { to: "/office/projekte", icon: FolderOpen, label: "Projekte" },
          { to: "/office/arbeitszeit", icon: Clock, label: "Arbeitszeit" },
        ]
      : []),
    ...(canAccessField(role)
      ? [{ to: "/field", icon: HardHat, label: "Aufmaß" }]
      : []),
  ];

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Sidebar */}
        <aside className="hidden md:flex w-56 flex-col border-r border-border bg-card">
          {/* Logo / app name */}
          <div className="flex h-14 items-center px-4 border-b border-border">
            <span className="font-semibold text-sm text-foreground">Aufmaß</span>
          </div>

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground",
                    item.stub && "opacity-50 pointer-events-none",
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {item.stub && (
                  <span className="ml-auto text-[10px] bg-muted text-muted-foreground px-1 rounded">
                    bald
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* User / logout */}
          <Separator />
          <div className="p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground">
                  <span className="flex-1 truncate">
                    {principal?.displayName ?? principal?.role}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={handleLogout}
                    aria-label="Abmelden"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Abmelden</p>
              </TooltipContent>
            </Tooltip>
            {/* Dev indicator */}
            <p className="px-3 py-1 text-[10px] font-mono text-muted-foreground/60 truncate">
              {principal?.tenantId.slice(0, 8)}…
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
