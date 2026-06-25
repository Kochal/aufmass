# 2026-06-25 — Remote instance stand-up on Hetzner

/ area: ops / status: docker compose up confirmed green on the remote host /

## What was done

Stood up the dev stack on the Hetzner server (95.217.218.99, Ubuntu 26.04 LTS,
16 GB RAM, 150 GB disk). The project lives in `/root/aufmass/`, isolated from
pre-existing work (`flood/`, `lisflood-fp/`) in the same `/root/`.

Steps:
1. Created `/root/aufmass/` on remote.
2. Installed Docker Engine 29.6.0 + Compose plugin via `get.docker.com`.
3. Transferred project code via `tar | ssh` (excluding `.git`, `data/`,
   `node_modules`, `__pycache__`).
4. Fixed the validator Dockerfile (see below).
5. `docker compose build` — all 5 images built.
6. `docker compose up -d` — all services started; migrate completed, validator
   health-gated.

## Validator Dockerfile fix

The original Dockerfile had two wrong assumptions about the KoSIT releases:

- **Wrong jar prefix**: used `validationtool-1.5.0-standalone.jar`; v1.5.0 only
  ships a distribution zip (no standalone jar). The standalone jar starts at a
  later version and uses the `validator-` prefix, not `validationtool-`.
- **Wrong config zip filename**: used `validator-configuration-xrechnung_${CONFIG_VERSION}.zip`
  but the actual filename includes the XRechnung spec version, e.g.
  `validator-configuration-xrechnung_3.0.2_2025-07-10.zip`.

Fixed to:
- `VALIDATOR_VERSION=1.6.2` → `validator-1.6.2-standalone.jar`
- `CONFIG_TAG=release-2025-07-10`, `CONFIG_ZIP=validator-configuration-xrechnung_3.0.2_2025-07-10.zip`
- Added `CONFIG_ZIP` as a separate ARG because the zip filename is not
  composable from the tag alone (it embeds the XRechnung spec version).

`scenarios.xml` sits at the zip root; `unzip -d config` puts it at
`config/scenarios.xml` — matches the CMD `-s config/scenarios.xml -r config`.

## Confirmed green

```
NAME                  STATUS               PORTS
aufmass-api-1         Up (healthy)         0.0.0.0:8000->8000/tcp
aufmass-postgres-1    Up (healthy)         5432/tcp
aufmass-stubs-1       Up                   9000/tcp
aufmass-validator-1   Up (healthy)         8080/tcp
aufmass-web-1         Up                   0.0.0.0:5173->5173/tcp
```

- All 20 migrations applied; dev `app` login role bootstrapped.
- `GET /health` → `{"status":"ok","db":true,"env":"dev"}`
- Web dev server (Vite / React) responding on :5173.

## Validator smoke test (same session)

The daemon HTTP interface:
- Correct call: `POST /` with raw XML body, `Content-Type: application/xml`.
  The handler explicitly rejects `multipart/form-data`; use `--data-binary @file`,
  not `-F file=@file`.
- The test instances shipped in the config source repo are Ant build templates
  (`@xrechnung.spec.id@` placeholder); they fail scenario matching as-is.
- A correctly formed XRechnung 3.0 UBL Invoice (CustomizationID =
  `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`)
  returned `valid="true"`, scenario `EN16931 XRechnung (UBL Invoice)` matched,
  all validation steps passed.

The daemon is fully operational.

## What is still open
- Ports 8000 and 5173 are exposed on the public IP. For anything beyond
  local-only testing, lock them down (firewall / nginx reverse proxy, `09`).
- The host has no GPU; the model server stub works for the dev stack but the
  `03` vision benchmark still needs a GPU host decision.

Related: [[2026-06-24-dev-stack-scaffold]], [[2026-06-23-application-stack]].
