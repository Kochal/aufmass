---
date: 2026-06-29
area: infra
---

# Nominatim geocoding proxy — design and Datenschutz flag

## What we're building

Server-side proxy (`GET /api/geocode?q=<text>`) that forwards address queries
to the public OpenStreetMap Nominatim API (`nominatim.openstreetmap.org`).
The result is trimmed to `{ label, strasse, hausnummer, plz, ort, land }` and
returned to the frontend `AddressFields` component as autocomplete suggestions.

## Nominatim policy: no autocomplete

The OSM Nominatim usage policy explicitly states:
> "Auto-complete search — This is not yet supported by Nominatim and you must
> not implement such a service on the client side using the API."

The implementation fires **one request per explicit user action** (clicking the
"Adresse suchen" button or pressing Enter). The debounced-per-keystroke approach
used in the original Round 3 implementation was removed because it violated this
rule. Free-text typing into the individual address fields (Straße, PLZ, Ort)
never triggers a Nominatim call.

## Why proxied

- **Browser never calls Nominatim directly.** The user's IP address would be
  sent to OSM's infrastructure with every keystroke. Proxying confines the
  egress to the API server and makes the source IP the Hetzner server, not
  the user.
- **User-Agent control.** OSM policy requires a descriptive User-Agent
  identifying the application. A `fetch` from the browser cannot reliably
  set it. Server-side `httpx` sets it per call.
- **Swappable.** The proxy URL is in config (`settings.nominatim_url`). Swapping
  to self-hosted Photon/Nominatim on the same server is a one-config-line change.

## Datenschutz flag (DSGVO / directive 09)

**This is an unresolved egress.** Typed address text (not personal data per se,
but potentially identifying if combined with tenant or user context) is sent to
`nominatim.openstreetmap.org`, which is operated by the OpenStreetMap Foundation
(OSMF, UK charity). No DPA / AVV is in place. The OSMF is not in the named
allowlist (`03`, `09`).

**User accepted the compliance caveat** (session 2026-06-29). This implementation
is acceptable for dev/demo. Before production use with real customer addresses:

1. Either obtain and execute a DPA with OSMF (unlikely — they do not offer one
   for the public API).
2. Or self-host Nominatim / Photon on the Hetzner server (EU/EEA, no egress).
   Photon is lighter (read-only geocoder, ~30 GB planet extract). See directive 03
   for the self-hosted option path.

The implementation is gated behind an error if the server is not configured with
a User-Agent (`settings.nominatim_user_agent`) — this forces a deliberate config
step before going live and is a natural hook for adding a "pending DPA" guard.

## Assumptions

- OSM public Nominatim usage policy allows commercial use at low volume (true as
  of 2026-06 — "heavy use" policy enforces a User-Agent and rate limit, not a fee).
- The Hetzner server has outbound HTTPS access to nominatim.openstreetmap.org
  (not restricted by firewall).
- `httpx` is available in the API container (it is — already used by the voice
  ASR module for OpenAI calls).
- Address text is not being used as an identifier or personal data in isolation.
  If the application later adds PII cross-referencing, this changes.

What would invalidate: OSMF changes usage policy; internal legal review decides
address text is personal data per DSGVO Art. 4; volume grows to heavy use class.
