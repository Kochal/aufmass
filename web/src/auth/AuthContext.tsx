/**
 * Authentication context for the Aufmaß app.
 *
 * Currently implements the dev header stub that the backend expects:
 * X-Tenant-Id and X-User-Id are sent on every request. Real Entra ID SSO
 * (directive 09) replaces the persistAuth/clearAuth calls here — the rest
 * of the app sees only `principal` and the login/logout actions.
 */
import React, { createContext, useContext, useState, useEffect } from "react";
import { persistAuth, clearAuth } from "@/lib/api";

export type Role = "admin" | "buero" | "buchhaltung" | "monteur";

export interface Principal {
  tenantId: string;
  userId: string;
  role: Role;
  /** Display name for the user switcher badge */
  displayName?: string;
}

interface AuthContextValue {
  principal: Principal | null;
  login: (principal: Principal) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "dev-auth-principal";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as Principal) : null;
    } catch {
      return null;
    }
  });

  // Keep the api.ts auth headers in sync with the principal
  useEffect(() => {
    if (principal) {
      persistAuth(principal.tenantId, principal.userId);
    } else {
      clearAuth();
    }
  }, [principal]);

  const login = (p: Principal) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    setPrincipal(p);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    clearAuth();
    setPrincipal(null);
  };

  return (
    <AuthContext.Provider value={{ principal, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Role capability helpers — used by the nav to filter items. */
export function canAccessOffice(role: Role): boolean {
  return role === "admin" || role === "buero" || role === "buchhaltung";
}

export function canAccessField(role: Role): boolean {
  return role === "admin" || role === "monteur";
}

export function canAccessDashboard(role: Role): boolean {
  return role === "admin";
}
