# The ONE Java instance (directive 00 decision 6, directive 10): the KoSIT
# e-invoice validator (EN 16931 / XRechnung), run as an internal-only HTTP
# sidecar the backend calls. No other Java enters the system.
#
# NOTE: This is a faithful starting point that has NOT been built/run in this
# environment (no Docker host here). Verify on the target host and pin the image
# by digest in docker-compose.yml once confirmed. See README.md in this dir.
#
# Pinned versions (override at build time with --build-arg). Bump deliberately.
# v1.6.2: jar prefix changed to "validator-" (was "validationtool-" before standalone existed)
# CONFIG_ZIP: filename includes XRechnung version, so not composable from tag alone
ARG VALIDATOR_VERSION=1.6.2
ARG CONFIG_TAG=release-2025-07-10
ARG CONFIG_ZIP=validator-configuration-xrechnung_3.0.2_2025-07-10.zip

FROM eclipse-temurin:17-jre-jammy

ARG VALIDATOR_VERSION
ARG CONFIG_TAG
ARG CONFIG_ZIP
WORKDIR /opt/validator

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 1. The validator engine (standalone jar) from the KoSIT release.
RUN curl -fsSL -o validationtool.jar \
      "https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validator-${VALIDATOR_VERSION}-standalone.jar"

# 2. The EN 16931 / XRechnung scenario configuration (scenarios.xml + resources).
# scenarios.xml sits at the zip root; after unzip -d config it lands at config/scenarios.xml.
RUN curl -fsSL -o config.zip \
      "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/${CONFIG_TAG}/${CONFIG_ZIP}" \
 && unzip -q config.zip -d config \
 && rm config.zip

EXPOSE 8080

# Daemon mode: serve validation over HTTP on the internal network only. The
# backend POSTs the e-invoice XML and reads back the report (directive 06).
# -H/-P bind host/port; -s scenarios; -r the resource repository root.
CMD ["sh", "-c", "java -jar validationtool.jar -D -H 0.0.0.0 -P 8080 -s config/scenarios.xml -r config"]
