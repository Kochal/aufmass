"""Aufmaß backend (Python / FastAPI).

Owns the deterministic engines and the orchestration glue (directive 10). All
money- and measurement-math lives here and in Postgres, never in the frontend,
and never as floating point (use decimal.Decimal end to end).
"""
