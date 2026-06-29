"""Runtime configuration, read from the environment (see docker-compose.yml).

Nothing here is a secret default fit for production: the dev Compose supplies
dev-only values. Real deployments inject their own (directive 03/09).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())

    # The application connects as a NON-superuser login role that is a member of
    # app_role (directive 02 / the migrations note's footgun): RLS only binds for
    # a role that is not superuser, table owner, or BYPASSRLS. In dev this is the
    # `app` role the migrate step bootstraps; the migrate step itself uses a
    # separate superuser URL (DATABASE_URL on the migrate service).
    database_url: str = Field(
        default="postgresql://app:app_dev@postgres:5432/maler",
        alias="DATABASE_URL",
    )

    # Internal-only sidecars / stubs (directive 10). The frontend never reaches
    # any of these directly; only the backend does.
    validator_url: str = Field(default="http://validator:8080", alias="VALIDATOR_URL")

    # Write-once filesystem original store (directive 04, minimal dev slice).
    # Production path: replace with an S3/WORM backend in the directive-04 round.
    documents_dir: str = Field(
        default="/var/lib/aufmass/documents", alias="DOCUMENTS_DIR"
    )

    # Mistral Document AI — Aufmaß extraction (directive 07a).
    # DPA + no-training tier required before first production call (directive 09).
    mistral_api_key: str = Field(default="", alias="MISTRAL_API_KEY")
    mistral_model_id: str = Field(default="mistral-ocr-4-0", alias="MISTRAL_MODEL_ID")

    # Whisper ASR — voice Aufmaß extraction (directive 07b, self-hosted).
    # Model is downloaded from HuggingFace on first use and cached locally.
    # Dev default: "base" (~145 MB, fast). Production: "large-v3" (~3 GB, accurate).
    asr_model_id: str = Field(default="base", alias="ASR_MODEL_ID")
    asr_device: str = Field(default="cpu", alias="ASR_DEVICE")
    asr_compute_type: str = Field(default="int8", alias="ASR_COMPUTE_TYPE")

    # Self-hosted VLM fallback (directive 03 escape hatch) — not the active path.
    # Kept here so the fallback can be wired in without touching the schema.
    model_endpoint: str = Field(default="http://stubs:9000/openai/v1", alias="MODEL_ENDPOINT")
    model_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MODEL_API_KEY", "RUNPOD_API_KEY"),
    )
    model_name: str = Field(default="qwen/qwen2.5-vl-7b-instruct", alias="MODEL_NAME")
    model_guided_json: bool = Field(default=False, alias="MODEL_GUIDED_JSON")

    m365_endpoint: str = Field(default="http://stubs:9000/m365", alias="M365_ENDPOINT")

    env: str = Field(default="dev", alias="ENV")

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
