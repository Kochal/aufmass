"""Dev stubs for the egress-bound dependencies (directive 10: "Stubs, not live
egress"). Lets the app run with no real Microsoft credentials and no GPU model
server. Replaced by real endpoints only in deployed environments.

  * /model  - stands in for the self-hosted vision/LLM endpoints (directive 03).
              Returns a canned, low-confidence extraction so the Aufmaß/quotation
              pipelines have a shape to consume without a GPU.
  * /m365   - stands in for Microsoft Graph (mail/calendar, directive 08).

These are intentionally dumb. They assert nothing about correctness; they only
keep the dependency wiring honest in dev.
"""
from fastapi import FastAPI

app = FastAPI(title="Aufmaß dev stubs", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "stub": True}


@app.post("/model")
def model(payload: dict | None = None) -> dict:
    # A deliberately uncertain candidate: every model output is a candidate to
    # confirm, never a committed number (directive 00/06/07).
    return {
        "candidate": True,
        "confidence": 0.5,
        "note": "stubbed model response; no real inference in dev",
        "echo": payload or {},
    }


@app.post("/m365")
def m365(payload: dict | None = None) -> dict:
    return {"sent": False, "stub": True, "echo": payload or {}}
