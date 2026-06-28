# Aufmaß backend image. Also used by the one-shot `migrate` service.
FROM python:3.12-slim

# postgresql-client gives the migrate runner `psql` (it applies whole .sql files
# with --single-transaction; see app/migrate.py). curl is for healthchecks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. In dev the source is bind-mounted over
# /app (see docker-compose.yml), so we install in editable-free mode against the
# copied project metadata, then the live code is mounted on top.
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
      "fastapi>=0.111" "uvicorn[standard]>=0.30" \
      "psycopg[binary]>=3.2" "psycopg_pool>=3.2" \
      "pydantic-settings>=2.3" "httpx>=0.27" \
      "mistralai>=1.0"

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
