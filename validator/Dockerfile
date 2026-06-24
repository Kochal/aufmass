# The ONE Java instance (directive 00 decision 6, directive 10): the KoSIT
# e-invoice validator (EN 16931 / XRechnung), run as an internal-only HTTP
# sidecar the backend calls. No other Java enters the system.
#
# NOTE: This is a faithful starting point that has NOT been built/run in this
# environment (no Docker host here). Verify on the target host and pin the image
# by digest in docker-compose.yml once confirmed. See README.md in this dir.
#
# Pinned versions (override at build time with --build-arg). Bump deliberately.
ARG VALIDATOR_VERSION=1.5.0
ARG CONFIG_VERSION=release-2023-11-15

FROM eclipse-temurin:17-jre-jammy

ARG VALIDATOR_VERSION
ARG CONFIG_VERSION
WORKDIR /opt/validator

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 1. The validator engine (standalone jar) from the KoSIT release.
RUN curl -fsSL -o validationtool.jar \
      "https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validationtool-${VALIDATOR_VERSION}-standalone.jar"

# 2. The EN 16931 / XRechnung scenario configuration (scenarios.xml + resources).
RUN curl -fsSL -o config.zip \
      "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/${CONFIG_VERSION}/validator-configuration-xrechnung_${CONFIG_VERSION}.zip" \
 && unzip -q config.zip -d config \
 && rm config.zip

EXPOSE 8080

# Daemon mode: serve validation over HTTP on the internal network only. The
# backend POSTs the e-invoice XML and reads back the report (directive 06).
# -H/-P bind host/port; -s scenarios; -r the resource repository root.
CMD ["sh", "-c", "java -jar validationtool.jar -D -H 0.0.0.0 -P 8080 -s config/scenarios.xml -r config"]
