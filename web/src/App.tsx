/**
 * App root — gates the whole application on auth.
 *
 * If there is no principal (not signed in), the DevLogin screen is shown.
 * Once signed in, AppRoutes renders the role-appropriate surface.
 *
 * The auth check here is the single gate. The swap-in point for real Entra
 * ID SSO (directive 09) is AuthContext.tsx + DevLogin.tsx — not this file.
 */
import { useAuth } from "@/auth/AuthContext";
import { DevLogin } from "@/auth/DevLogin";
import { AppRoutes } from "@/app/routes";

export function App() {
  const { principal } = useAuth();

  if (!principal) {
    return <DevLogin />;
  }

  return <AppRoutes />;
}
