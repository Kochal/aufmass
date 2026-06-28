# Notes index

One-line summary per note. **Check here before opening individual files.**
Organised by area, newest first within each area.

---

## aufmass
| Date | File | Summary |
|------|------|---------|
| 2026-06-28 | [mistral-document-ai-pivot](aufmass/2026-06-28-mistral-document-ai-pivot.md) | Decision to pivot Aufmaß extraction to Mistral Document AI (`mistral-ocr-4-0`); decision 3 relaxed to co-equal per-step routing; DPA pending; compliance checklist; technical shape for code round |
| 2026-06-27 | [vision-client-poc-benchmark](aufmass/2026-06-27-vision-client-poc-benchmark.md) | PoC result: pipeline works end-to-end; Qwen2.5-VL-7B/8k too small (hallucination, context overflow); 32B+ / 32k context needed; key client fixes documented (fence strip, salvage on truncation, RUNPOD_API_KEY alias) |
| 2026-06-24 | [aufmass-db-layer](aufmass/2026-06-24-aufmass-db-layer.md) | Migration 0020: `aufmass` + `aufmass_entry` tables, guarantee suite AF1–AF8; engine/DB boundary decision; `quelle`-driven original constraint; prüfbarkeit floor trigger |

## quotation
| Date | File | Summary |
|------|------|---------|
| 2026-06-26 | [quotation-engine-api](quotation/2026-06-26-quotation-engine-api.md) | 06 app layer complete: pricing engine (Decimal/HALF_UP), checks engine, 9 entities, berechnen→pruefen→ausstellen→version flow; deferred: XRechnung/KoSIT, GAEB, PDF matching |
| 2026-06-23 | [quotation-db-layer](quotation/2026-06-23-quotation-db-layer.md) | Migrations 0015–0019: LV/Angebot/Rechnung schema; what the DB enforces vs. what the app layer owns |

## operations
| Date | File | Summary |
|------|------|---------|
| 2026-06-25 | [api-layer-decisions](operations/2026-06-25-api-layer-decisions.md) | 05 API design calls: `db_errors()` mapper, `require_row()`, `dict_row` pool, optimistic concurrency pattern, freeze-on-approval |
| 2026-06-23 | [operational-spine](operations/2026-06-23-operational-spine.md) | Migrations 0008–0014: all 05 entities (fahrzeug, fahrt, lieferant, material, bestellung, abnahmeprotokoll, mangel, gewaehrleistung); domain rules and assumptions |

## infra
| Date | File | Summary |
|------|------|---------|
| 2026-06-26 | [eu-eea-residency](infra/2026-06-26-eu-eea-residency.md) | Residency widened from German-only to EU/EEA; DSGVO adequacy rationale; §146 AO procedural note; all affected directives updated |

## schema
| Date | File | Summary |
|------|------|---------|
| 2026-06-23 | [cross-cutting-foundation](schema/2026-06-23-cross-cutting-foundation.md) | Migrations 0001–0007: tenant RLS, audit_log, immutability triggers, edit_lock, row_version; honest cross-tenant FK limitation |

## ui
| Date | File | Summary |
|------|------|---------|
| 2026-06-28 | [e2e-browser-test](ui/2026-06-28-e2e-browser-test.md) | E2E browser walkthrough complete; two bugs fixed (ausstellenMutation cache, nummernkreis format); immutability trigger confirmed; nummernkreis seed requirement documented |
| 2026-06-28 | [design-system-and-surfaces](ui/2026-06-28-design-system-and-surfaces.md) | shadcn/ui on Tailwind v4; three surfaces one design system; confidence/trust colour tokens; react-router-dom v7 + react-query v5 + openapi-fetch; dev-auth seam; office quote-review slice live |

## ops (infrastructure / tooling)
| Date | File | Summary |
|------|------|---------|
| 2026-06-25 | [remote-instance-standup](ops/2026-06-25-remote-instance-standup.md) | Hetzner host live: all 5 images build, all 20 migrations applied, KoSIT validator healthy, API /health green, React dev server up |
| 2026-06-24 | [dev-stack-scaffold](ops/2026-06-24-dev-stack-scaffold.md) | docker-compose scaffold (api/web/validator/stubs); migration runner; app-role RLS bootstrap; per-request session context |
| 2026-06-23 | [application-stack](ops/2026-06-23-application-stack.md) | Stack decision: FastAPI + psycopg3 (Python 3.12) + React/Vite/TypeScript; why not Go/Rust; psycopg_pool for connection pool |
| 2026-06-23 | [migrations-and-test-tooling](ops/2026-06-23-migrations-and-test-tooling.md) | Plain SQL migrations applied with psql --single-transaction; pgTAP-style test approach; run.sh wiring |
