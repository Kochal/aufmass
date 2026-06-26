# aufmass

AI-native operations tool for a German Maler- und Bodenbelagsbetrieb: project
management, Aufmaß capture, orders, quotations, working hours, mileage, and the
records a construction firm must keep. AI reads RfPs and handwritten Aufmaß;
deterministic code owns all money math and validation.

Start with [`CLAUDE.md`](CLAUDE.md) and [`00-overview.md`](00-overview.md). The
plan lives in the numbered directives (`00`–`10`); the reasoning in `notes/`.

## Repo map

| Path | What |
|------|------|
| `00`–`10`, `99` | Directives (the plan) and current status. |
| `migrations/` | Plain forward-only SQL. The full schema: foundation + every module. |
| `tests/` | Guarantee suites (plain psql, no framework). See `tests/README.md`. |
| `api/` | Python / FastAPI backend + deterministic engines + migration runner. |
| `web/` | React + TypeScript PWA. |
| `validator/` | The one Java instance: KoSIT e-invoice validator sidecar. |
| `stubs/` | Dev fakes for the model server (`03`) and M365 (`08`). |
| `notes/` | Why things are the way they are, dated by area. |

## Dev environment

One command brings up Postgres, the API, the validator (internal-only), the dev
stubs, and the web PWA (directive `10`):

```sh
docker compose up
```

- **API** → http://localhost:8000  (`/health`, `/docs`)
- **Web** → http://localhost:5173
- A one-shot `migrate` service applies the full migration set (including RLS and
  audit triggers) before the API serves traffic, then bootstraps the dev `app`
  DB role. The API connects as that **non-superuser** role so RLS is enforced in
  dev exactly as in production.

Dev uses stubs for the model server and M365 (no real credentials needed); the
KoSIT validator is real and runs locally. The GPU model server is not in Compose
— it lives on the EU/EEA host (`03`).

> The `validator/` image has not yet been built against the real KoSIT artifacts
> in this environment — see `validator/README.md` before first `up`.

## Running the guarantee suites

Against a fresh database (plain psql, no test framework):

```sh
PGHOST=... PGPORT=... PGUSER=... PGDATABASE=maler tests/run.sh
```

## Non-negotiables

See `CLAUDE.md`. In short: no money/measurement math in the model; row-level
tenant isolation via RLS; immutable, audited records; originals kept in original
format; egress defaults to deny.
