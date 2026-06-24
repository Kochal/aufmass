# 10 - Application Stack and Dev Environment

The stack the directives deliberately left open, now fixed: a polyglot set
with each language in its lane, a browser PWA, and Postgres as the
calculation and integrity authority. This file states the lanes, the
app-layer non-negotiables, the layer contract, and how the whole set runs in
development with one command.

The reasoning behind the choice (the why) is in
`notes/ops/2026-06-23-application-stack.md`. This directive states what is now
true. Schema and the database authority are `02`; the model server is `03`;
e-invoice validation and GAEB are `06`; image preprocessing is `07`; M365 is
`08`; auth and inbound access are `09`.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-23: Initial draft. Lanes, app-layer non-negotiables, layer
  contract, dev Compose.
- 2026-06-24: Scaffolded the four services (`api`, `web`, `validator`, `stubs`)
  so `docker compose up` is the entry point. Decisions now true: the migration
  runner is a thin `psql --single-transaction` wrapper over the plain SQL with
  `schema_migrations` bookkeeping (open question 1 resolved: one-shot `migrate`
  service); a non-superuser `app` DB login role is bootstrapped by the migrate
  step in dev so RLS actually binds (the api connects as it, never as the
  superuser); the per-request RLS context is transaction-local `set_config`;
  stubs are one shared `stubs` service (open question 2 resolved). The DB layer
  of all this was verified on PG17; the Docker builds and the KoSIT `validator`
  image are not yet built/run here (see `validator/README.md`). Detail in
  `notes/ops/2026-06-24-dev-stack-scaffold.md`.

-----

## Lanes (each language stays in its own)

- **Python / FastAPI**: the backend and all deterministic engines (GAEB
  parse, matching orchestration, pricing, the sense-check layer, Aufmaß
  reconciliation), plus the glue to the self-hosted model endpoints and the
  `07` image preprocessing. Python owns the money logic because it has a real
  decimal type and the engines are substantial logic that reads naturally
  here.
- **React + TypeScript**: the browser UI, delivered as a PWA. It owns
  interaction, never calculation. Every model output it receives is a
  candidate to confirm, never a number to trust (`00`, `06`, `07`).
- **Java**: exactly one instance, the KoSIT e-invoice validator, run as a
  sidecar the backend calls over HTTP. No other Java enters the system, ever
  (`00`, decision 6). Do not reach for a Java library out of convenience.
- **Postgres**: the authority, not just storage. It owns RLS, audit,
  immutability, numbering (`02`), and the money math. The backend
  orchestrates; the database calculates and enforces.

-----

## App-layer non-negotiables

These are the three places a browser stack can quietly break the guarantees
the other directives make, so they are fixed here.

1. **Per-request RLS session context.** Every request sets
   `app.tenant_id` and `app.user_id` with `SET LOCAL` inside its transaction,
   so RLS (`02`) sees the right tenant and the audit trigger records the right
   actor. The connection pooler must not leak that context across requests
   (reset on checkin / use a transaction-scoped pattern). This is what makes
   tenant isolation real rather than theoretical, and it must be in place from
   the first endpoint.
2. **Money is Decimal and Postgres, never float.** No floating-point money
   anywhere in the backend; amounts are decimal end to end, and totals and
   sums are computed in Postgres (`02`). The frontend never computes a money
   value; it displays what the backend committed.
3. **E-invoice validation runs the KoSIT validator locally.** EN 16931 /
   XRechnung validation is delegated to the Java sidecar, never reimplemented
   and never sent to a hosted validator (`03`, `06`). The sidecar stays on the
   firm's server.

-----

## Browser PWA

- **Installable, camera-capable, offline-tolerant.** Field capture happens on
  phones at the Baustelle (`07`): photographing Aufmaß sheets, large image
  uploads, flaky site network. The PWA gives camera access, install without an
  app store, and tolerance of poor connectivity, which is the reason for
  choosing browser over native.
- The two genuinely interactive screens (Aufmaß crop verification, quote
  matching review) are why this is a real client app and not server-rendered
  pages.

-----

## Layer contract

- A **typed API boundary**. FastAPI emits an OpenAPI schema; the TypeScript
  client types are generated from it, so the frontend and backend cannot
  drift out of agreement on shapes. Generated client, not hand-written.
- The frontend talks only to the backend. It never calls Postgres, the model
  server, the validator, or M365 directly.

-----

## Development environment

One command brings up the whole set: `docker compose up`. No local install of
Java, Node, or Postgres. See the `docker-compose.yml` shipped with this
directive.

### Four services

- **postgres**: official image, named volume so data survives restarts, a
  `pg_isready` healthcheck.
- **api**: the Python service, source bind-mounted, `uvicorn --reload` for hot
  reload. Waits on Postgres and the validator being healthy.
- **validator**: the KoSIT sidecar, the one Java instance, **internal-network
  only** (its port is not published to the host), with an HTTP healthcheck.
  Pinned by digest, not just a tag, so its behaviour is reproducible.
- **web**: the Vite dev server for the React PWA, source bind-mounted, HMR in
  the browser.

### Rules baked into the dev set

- **Health-gated startup**, not just `depends_on`. `depends_on` waits for
  start, not readiness, so the api waits on `condition: service_healthy` for
  Postgres and the validator. This is what makes "clone, up, working" true on
  the first try.
- **Migrations on startup**: a one-shot `migrate` step runs the full
  migration set before the api serves traffic, so a fresh clone lands on the
  current schema automatically.
- **Full RLS and triggers in dev.** Dev Postgres runs the complete migration
  set including the RLS policies and audit triggers (`02`), never a stripped
  schema, so tenant-isolation bugs surface on a developer's machine rather
  than in production.
- **The validator is internal-only.** The api reaches it as
  `http://validator:8080` on the Compose network; the port is not published.
  This keeps "one Java instance, called only by the backend" true at the
  network level, mirroring production.
- **Stubs, not live egress.** Dev points at stubbed model and M365 endpoints;
  no live Microsoft credentials or model server are needed to run the app.
  Real endpoints exist only in deployed environments.

### Explicitly out of the dev Compose

- **The GPU model server.** It lives on the German host (`03`), is heavy, and
  dev points at a remote endpoint or a small stub rather than running vLLM in
  Compose.
- **Live M365 / e-invoice egress.** Dev uses fakes (the KoSIT validator
  itself runs locally and is real; what is faked is Microsoft and any outbound
  send).

-----

## Open questions

1. ~~**Migrate step shape**~~ **Resolved (2026-06-24):** a dedicated one-shot
   `migrate` service running `python -m app.migrate`, which tracks applied files
   in `schema_migrations` and applies pending ones with `psql
   --single-transaction`. In dev it also bootstraps the non-superuser `app` DB
   role the api connects as.
2. ~~**Model/M365 stub form**~~ **Resolved (2026-06-24):** one shared `stubs`
   service in Compose (`/model`, `/m365`), so the app runs with no real
   credentials.
3. **Prod runtime topology**: the same Compose set on the German host vs a
   thin orchestration layer. Out of scope here; decide alongside `03` when
   standing up the host.
4. **KoSIT `validator` image**: the Dockerfile is scaffolded but not yet built
   against the real KoSIT artifacts; the daemon's HTTP request/health paths and
   the pinned artifact versions need confirming on a Docker host, then the image
   pinned by digest. See `validator/README.md`.
