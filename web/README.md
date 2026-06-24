# web — React + TypeScript PWA

The browser UI (directive `10`), delivered as an installable, camera-capable,
offline-tolerant PWA because field capture happens on phones at the Baustelle
(`07`). It owns interaction, never calculation: every model output is a candidate
to confirm, never a number to trust.

## Stack

Vite + React + TypeScript, `vite-plugin-pwa` for the installable/offline shell.
The two genuinely interactive screens (Aufmaß crop verification, quote matching
review) are why this is a real client app rather than server-rendered pages.

## Layer contract

The frontend talks **only to the backend** — never to Postgres, the model
server, the validator, or M365 directly. TypeScript client types are generated
from the backend's OpenAPI schema so the two cannot drift:

```sh
npm run gen:api   # requires the api running at http://localhost:8000
```

This writes `src/api/schema.ts`. Run it after changing backend endpoint shapes.

## Dev

In the Compose stack the Vite dev server runs bound to `0.0.0.0:5173` with HMR;
source is bind-mounted and `node_modules` lives in an anonymous volume. Locally:
`npm install && npm run dev`. The API base URL comes from `VITE_API_URL`
(defaults to `http://localhost:8000`).
