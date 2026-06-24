# validator — KoSIT e-invoice validator sidecar

The one Java instance in the system (directive `00` decision 6, directive `10`):
the [KoSIT validator](https://github.com/itplr-kosit/validator) running EN 16931
/ XRechnung validation, as an **internal-only** HTTP sidecar the backend calls.
EN 16931 validation is never reimplemented and never sent to a hosted validator.

## Status: needs verification on a Docker host

This directory was scaffolded without a Docker host or network access to the
KoSIT release artifacts, so the `Dockerfile` is a faithful starting point but has
**not been built or run**. Before relying on it:

1. **Confirm the artifact URLs and versions.** `VALIDATOR_VERSION` and
   `CONFIG_VERSION` are build args; check the latest compatible
   [validator](https://github.com/itplr-kosit/validator/releases) and
   [configuration-xrechnung](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases)
   releases and the exact asset filenames.
2. **Confirm the daemon HTTP interface.** Verify the daemon's request path
   (POST the invoice XML) and, crucially, the **health path** the Compose
   healthcheck hits. The Compose file currently probes `/health`; if the daemon
   does not expose that, adjust the healthcheck in `docker-compose.yml` to a path
   it does serve (e.g. `GET /`).
3. **Pin by digest.** Once it builds and runs, pin the image by `@sha256:` digest
   in `docker-compose.yml` (directive 10) so behaviour is reproducible, rather
   than tracking a moving tag.

## Why it stays internal-only

The Compose service uses `expose: 8080` (not `ports:`), so the validator is
reachable only on the Compose network as `http://validator:8080`, mirroring
production where it lives on the firm's German server and is called solely by the
backend. This keeps "one Java instance, called only by the backend" true at the
network level.
