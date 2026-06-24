import { useEffect, useState } from "react";

// Minimal scaffold screen: confirms the frontend can reach the backend (and only
// the backend — directive 10 layer contract). The two real interactive screens
// (Aufmaß crop verification, quote matching review) are built on top of this.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type Health = { status: string; db: boolean; env: string };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Aufmaß</h1>
      <p>Dev scaffold. The frontend talks only to the backend.</p>
      <h2>Backend health</h2>
      {error && <pre style={{ color: "crimson" }}>API unreachable: {error}</pre>}
      {health ? (
        <pre>{JSON.stringify(health, null, 2)}</pre>
      ) : (
        !error && <p>checking…</p>
      )}
    </main>
  );
}
