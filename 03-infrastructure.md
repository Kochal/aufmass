# 03 - Infrastructure and Model Serving

Where compute, storage, and models live, and the rules that keep customer
and tender data within the allowed processor boundary. This is the technical
form of `00` decision 3 (per-step model routing behind an endpoint boundary)
and the residency half of the `01` DSGVO posture.

Backup and archival are `04`; DSGVO operations and access control are `09`;
which models do what is `06` and `07`. This file states the hosting, the
serving stack, the egress rules, the named processor allowlist, and how
correctness survives any model endpoint being down.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-28: Pivot from "self-hosted only" to co-equal per-step routing.
  Mistral Document AI added to named EU-native processor allowlist (Aufmaß).
  Self-hosted GPU vision demoted to optional/fallback. Residency-vs-sovereignty
  nuance added. GPU-class open question parked (no longer critical path).
  See notes/aufmass/2026-06-28-mistral-document-ai-pivot.md.
- 2026-06-22: Initial draft. Hosting and residency, models served, serving
  stack, egress rule, model lifecycle, degradation, remote-execution norms.
- 2026-06-22: Split egress from inbound (client-server collaboration is
  inbound, secured access control owned by `09`); named M365 as a deliberate
  AVV-covered exception to the data-stays-in rule.
- 2026-06-26: Residency widened from German server to EU/EEA (whole stack);
  self-hosting + egress-deny + AVV unchanged. See notes/infra/2026-06-26-eu-eea-residency.md.

-----

## Hosting and residency

- **Everything stays within the EU/EEA.** The database (`02`), the
  application, the document/object store (`04`), any self-hosted model
  components, and every named EU-native model API — all run in EU/EEA
  datacenters. Residency is a hard rule, not a preference.
- **Sovereignty**: where possible, processors are EU-headquartered (no CLOUD
  Act exposure). Mistral AI is EU-headquartered. This reinforces residency and
  matters for B2G (`00`).
- **Realistic shape**: a firm-controlled dedicated server in an EU/EEA
  datacenter (Hetzner is the current host) for Postgres, the app, the
  document store, and self-hosted model components (ASR, embeddings, optional
  VLM fallback). GPU-class hardware is not required immediately now that
  Aufmaß extraction routes to Mistral; procure when RfP/PDF extraction routing
  is decided.
- An **AVV** is in place with the hosting provider (`01`, `09`). A signed
  **DPA** and no-training tier are required with each named EU-native model
  API processor before first production call.

## What runs here

- **Postgres** (`02`), with the immutability, RLS, and PITR story `04`
  depends on.
- The **application** (API and web).
- The **object store** for original-format documents (`04`).
- **Self-hosted model components**: ASR (Whisper), embeddings, and an optional
  VLM fallback when/if procured (see Models served).

Whether the database and self-hosted model components share a host or are
split is an open question; for a single firm's load they can co-reside.

## Models served (per-step routing — each step's choice is its own decision)

Models run behind an endpoint boundary. Each step chooses between self-hosted
and a named EU-native API on its own merits (benchmark, cost, quality,
compliance). The endpoint-interface boundary (`07a`) means switching is one
module change.

- **Aufmaß extraction** (`07`): **Mistral Document AI** (`mistral-ocr-4-0`),
  EU-native (see Allowlist). Self-hosted VLM is an optional/fallback escape
  hatch (e.g. Qwen2.5-VL-32B+) if Mistral is unavailable or a future
  benchmark favours it.
- **Embeddings** for LV-to-Leistungskatalog matching (`06`): a strong
  multilingual or German model (e.g. BGE-m3, multilingual-e5). Self-hosted;
  small; CPU-or-modest-GPU.
- **Text LLM** for PDF extraction and match rerank/confirm (`06`): routing
  TBD. Self-hosted or EU-native API, decided when the step is built.
- **ASR** for voice Aufmaß (`07`): Whisper large-v3 (faster-whisper), German.
  Self-hosted.

## Sizing and capacity

- Load is low and latency-tolerant: quoting and Aufmaß are human-in-the-loop,
  not high-QPS. One GPU server can plausibly host the vision model, the
  embedder, and Whisper together, time-shared.
- Commit hardware only after a sizing benchmark against real sheets and real
  tenders (VRAM for the chosen vision model dominates). Until then, treat the
  GPU class as unfixed.

## Serving stack

- **Self-hosted components**: VLM fallback and embeddings via vLLM (or
  equivalent) exposing a local OpenAI-compatible endpoint; ASR via
  faster-whisper. All self-hosted endpoints bind locally / to the private
  network.
- **Named EU-native APIs**: accessed via their official SDK behind the
  endpoint-interface boundary (`07a`); credentials are env-only, never
  hardcoded. The boundary means swapping an endpoint is one env/module change.
- **Sizing**: no GPU required for the current workload (Aufmaß → Mistral;
  ASR and embeddings run on CPU or modest GPU). Procure GPU-class hardware
  when RfP PDF extraction routing is decided.

## Egress and access paths

Two independent controls, not to be conflated. Egress governs the server
reaching **out**; inbound governs clients reaching the server. Collaboration
between employees is inbound, not egress.

### Egress (deny-by-default with a named allowlist)

- The server's outbound network defaults to **deny**, allowlisted to what the
  system genuinely needs. The allowlist is config, reviewed in `09`.
- **Named EU-native processors** appear on the allowlist only when all of the
  following hold: EU-headquartered with no CLOUD Act exposure (residency **and**
  sovereignty), a signed **DPA** in place, a **no-training tier** confirmed in
  writing, EU residency of processing confirmed, and the step is individually
  justified. Sending data to an allowlisted processor is deliberate, bounded,
  and governed — not a general permission.
- **Current allowlist:**
  - **M365 Graph** — mail and calendar (`08`). AVV in place.
  - **Mistral Document AI** (`api.mistral.ai`, `mistral-ocr-4-0`) — Aufmaß
    extraction (`07`). DPA + no-training tier required before first production
    call; **status: pending**. See
    `notes/aufmass/2026-06-28-mistral-document-ai-pivot.md`.
  - OS and package updates.
- e-invoice (EN 16931) validation runs locally, not via a hosted validator.
- Data never reaches a processor outside the EU/EEA.

### Named processors (the allowlist in practice)

- **M365 / Microsoft**: mail and calendar data leaves to Microsoft through the
  Graph allowlist entry. AVV in place, EU/EEA residency, no-training. This
  was always a deliberate, bounded exception; it is now one entry in a general
  allowlist framework rather than a unique carve-out. Detail in `08` and `09`.
- **Mistral Document AI**: handwritten Aufmaß images leave to Mistral through
  the `api.mistral.ai` allowlist entry. DPA + no-training tier required before
  first production call; status: pending. Mistral is EU-headquartered (no
  CLOUD Act exposure). No data beyond the image is sent. Detail in `07a` and
  `09`.
- Egress deny-by-default means each new processor requires a new named
  allowlist entry, a confirmed DPA/AVV, and a residency check. The allowlist
  is not a general permission to use any EU-based service.

### Inbound access (collaboration)

- Employees do not talk peer-to-peer; they all talk to the same server. Edits
  flow client -> server -> Postgres -> other client. The data path is
  user-to-server, never user-to-user, so collaboration is entirely inbound,
  governed by tenant isolation (RLS) and the edit-lease / optimistic
  concurrency model in `02`. None of it is egress.
- How that inbound path is secured (TLS everywhere, authentication, exposure
  via VPN or a single hardened reverse proxy rather than an open app port,
  on-LAN vs remote clients) is access control, **owned by `09`**. The egress
  deny does not cover it and must not be assumed to.

## Model lifecycle and provenance

- Model identity and version are pinned and recorded alongside the outputs
  they produced, so an Aufmaß extraction or a match can be traced to the
  exact model that produced it (echoes the `00` traceability principle).
- Swapping or upgrading a model is a design decision: note it, add a
  changelog line, and re-run the relevant benchmark.
  - For EU-native API models: pin the model id (e.g. `mistral-ocr-4-0`) and
    record it with each extraction result (`07a`). A model-id change is a
    design decision; update the directive and re-benchmark.
  - For self-hosted models: fine-tuned weights are versioned artifacts and are
    backed up (`04`); base weights are re-downloadable and need not be.
- **Non-determinism is assumed.** Model outputs vary run to run; that is
  precisely why the deterministic layers in `06` and `07` own every number
  and never trust the model's value. Infra does not try to make the model
  deterministic; it makes the model's output checkable.

## Reliability and degradation

- Correctness does not depend on any model endpoint. The deterministic
  pricing, sense-check, and reconciliation layers are the source of truth.
- If a model endpoint is down or slow (whether self-hosted or an EU-native
  API): PDF extraction, Aufmaß extraction, and matching **queue**; the
  operational spine (`05`), manual Aufmaß entry (`07`), manual matching, and
  issuing already-prepared documents keep working. The firm is never fully
  blocked by a model endpoint outage.

## Remote-execution norms

Compute and storage are remote; the local machine is a thin client.

- One-off commands go through `ssh` so output and errors return to the local
  session.
- Long jobs (fine-tuning, batch extraction, large imports) start detached
  (`tmux` / `nohup`) on the remote side so a dropped connection does not kill
  them; poll for completion rather than holding the session open.
- Do not assume local paths exist; data and models live on the remote host.

-----

## Open questions

1. **GPU class / VLM fallback**: parked; no longer on the critical path.
   Aufmaß routes to Mistral. Revisit if Mistral DPA negotiations fail, the
   benchmark underperforms, or RfP/PDF extraction routing is decided for a
   self-hosted model.
2. **Co-locate vs split**: database and self-hosted model components on one
   host, or separate? Drafted as co-resident for a single firm; revisit if a
   second tenant's load (`00`) changes the picture.
3. **On-prem vs hosted**: hosted-dedicated is the default for self-hosted
   components; flag if the firm has a reason (existing hardware, contractual)
   to run on-premise.
4. **Fine-tune cadence**: if a self-hosted VLM fallback is procured, how often
   Aufmaß weights are retrained as verified sheets accumulate. Drafted as
   periodic and manual; moot until the fallback is live.
5. **RfP / PDF extraction routing**: self-hosted text LLM vs EU-native API.
   Deferred pending benchmark. Decide as a step-specific routing call.
