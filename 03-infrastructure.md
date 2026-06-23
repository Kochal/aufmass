# 03 - Infrastructure and Model Serving

Where compute, storage, and models live, and the rule that keeps customer
and tender data off any third-party model. This is the technical form of
`00` decision 3 (self-hosted LLM on a German server) and the residency half
of the `01` DSGVO posture.

Backup and archival are `04`; DSGVO operations and access control are `09`;
which models do what is `06` and `07`. This file states the hosting, the
serving stack, the egress rule, and how correctness survives the model
server being down.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Hosting and residency, models served, serving
  stack, egress rule, model lifecycle, degradation, remote-execution norms.
- 2026-06-22: Split egress from inbound (client-server collaboration is
  inbound, secured access control owned by `09`); named M365 as a deliberate
  AVV-covered exception to the data-stays-in rule.

-----

## Hosting and residency

- **Everything runs in Germany / the EU.** The database (`02`), the
  application, the document/object store (`04`), and the model servers all
  sit in a German datacenter. Residency is a hard rule, not a preference.
- **Realistic shape**: a firm-controlled dedicated GPU server in a German
  datacenter (Hetzner is the obvious candidate and is already familiar).
  On-premise at the firm is an alternative if there is reason, but the ops
  burden is real for a small Betrieb, so hosted-dedicated is the default.
- An **AVV** is in place with the hosting provider (`01`, `09`). The provider
  hosts the hardware; it is not a model processor, and no model inference
  leaves the firm's own machines.

## What runs here

- **Postgres** (`02`), with the immutability, RLS, and PITR story `04`
  depends on.
- The **application** (API and web).
- The **object store** for original-format documents (`04`).
- The **model servers** (below).

Whether the database and the model server share a host or are split is an
open question; for a single firm's load they can co-reside, with the GPU
server also carrying Postgres if sized for it.

## Models served (final choice deferred to benchmark, like `07`)

All self-hosted; the app talks only to local inference endpoints.

- **Vision** for Aufmaß extraction (`07`): benchmark Qwen3-VL and
  handwriting-tuned variants (Chandra, olmOCR) on the firm's own sheets;
  fine-tune on their forms as labelled data accrues.
- **Embeddings** for LV-to-Leistungskatalog matching (`06`): a strong
  multilingual or German model (e.g. BGE-m3, multilingual-e5). Small;
  CPU-or-modest-GPU.
- **Text LLM** for PDF extraction and match rerank/confirm (`06`): a
  German-capable instruct model; may be the vision model itself.
- **ASR** for voice Aufmaß (`07`): Whisper large-v3 (faster-whisper), German.

## Sizing and capacity

- Load is low and latency-tolerant: quoting and Aufmaß are human-in-the-loop,
  not high-QPS. One GPU server can plausibly host the vision model, the
  embedder, and Whisper together, time-shared.
- Commit hardware only after a sizing benchmark against real sheets and real
  tenders (VRAM for the chosen vision model dominates). Until then, treat the
  GPU class as unfixed.

## Serving stack

- LLM / VLM via vLLM (or equivalent) exposing a local OpenAI-compatible
  endpoint; embeddings via a lightweight local server; ASR via faster-whisper.
- All endpoints bind locally / to the private network. The application has no
  configuration path to a remote model API.

## Egress and access paths

Two independent controls, not to be conflated. Egress governs the server
reaching **out**; inbound governs clients reaching the server. Collaboration
between employees is inbound, not egress.

### Egress (the hard line)

- **No tender, customer, measurement, or price data is sent to any
  third-party model service for inference.** Ever. This is `00` decision 3 in
  enforceable form, and it is specifically about model services; it is not a
  claim that the firm touches no cloud at all.
- The server's outbound network defaults to **deny**, allowlisted to what the
  system genuinely needs: M365 Graph for `08`, OS and package updates. The
  allowlist is config, reviewed in `09`.
- e-invoice (EN 16931) validation runs locally, not via a hosted validator.

### The M365 exception (named, deliberate)

- M365 is in scope (`00`), and Outlook mail and calendar are Microsoft's
  cloud. Tender-related email and calendar data therefore does legitimately
  leave to Microsoft through the Graph allowlist entry.
- This is a deliberate, AVV-covered, EU-residency exception (`01`, `09`), not
  a contradiction of the rule. "Self-hosted" and "uses M365" are both true:
  the hard line is that data never reaches a third-party **model** for
  inference, not that no cloud is ever touched. Detail in `08` and `09`.

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
  changelog line, and re-run the relevant benchmark. Fine-tuned Aufmaß
  weights are versioned artifacts and are backed up (`04`); base weights are
  re-downloadable and need not be.
- **Non-determinism is assumed.** Model outputs vary run to run; that is
  precisely why the deterministic layers in `06` and `07` own every number
  and never trust the model's value. Infra does not try to make the model
  deterministic; it makes the model's output checkable.

## Reliability and degradation

- Correctness does not depend on the model server. The deterministic
  pricing, sense-check, and reconciliation layers are the source of truth.
- If the model server is down or slow: PDF extraction, Aufmaß extraction, and
  matching **queue**; the operational spine (`05`), manual Aufmaß entry
  (`07`), manual matching, and issuing already-prepared documents keep
  working. The firm is never fully blocked by a GPU outage.

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

1. **Provider and GPU class**: decided by the sizing benchmark. Hetzner
   dedicated is the working assumption; confirm against the chosen vision
   model's VRAM.
2. **Co-locate vs split**: database and model server on one host, or
   separate? Drafted as co-resident for a single firm; revisit if a second
   tenant's load (`00`) changes the picture.
3. **On-prem vs hosted**: hosted-dedicated is the default; flag if the firm
   has a reason (existing hardware, contractual) to run on-premise.
4. **Fine-tune cadence**: how often the Aufmaß model is retrained as verified
   sheets accumulate, and who triggers it. Drafted as periodic and manual.
