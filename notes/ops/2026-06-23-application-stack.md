# Application stack: why polyglot

Context. The directives left the application language and web framework open
(`00`, `10`). We needed to fix the stack before building the app layer, and
the trigger was choosing a browser-based UI.

Decision. A polyglot set, each language in its lane: Python / FastAPI for the
backend and deterministic engines and the AI glue; React + TypeScript for a
browser PWA; exactly one Java instance, the KoSIT e-invoice validator, as a
sidecar; Postgres as the calculation and integrity authority. Pinned in `10`.

Why, in order of weight.

- **Money safety drives the backend language.** The system forbids float
  money and puts every committed number on the deterministic side (`02`,
  `06`, `07`). JavaScript / TypeScript has no native decimal type, which makes
  a TS backend a standing hazard for exactly the part that must never be
  wrong. Python has `Decimal`, and the engines (GAEB parse, pricing, the
  sense-check, Aufmaß reconciliation) read naturally in Python. We also push
  the actual arithmetic into Postgres so correctness does not depend on
  app-language discipline.
- **Python is already in the system.** The `07` image preprocessing (deskew,
  crop extraction) and the glue to the self-hosted model endpoints (`03`) are
  Python-natural. Making the backend Python too means the app and the AI layer
  share one language instead of adding a third.
- **A browser PWA fits the field reality.** Capture happens on phones at the
  Baustelle: camera, large image uploads, flaky network (`07`). A PWA gives
  installable, camera-capable, offline-tolerant behaviour with no app-store
  friction, which is the point of choosing browser over native. React is also
  where the two genuinely interactive screens (Aufmaß crop verification, quote
  matching review) are built well.
- **The e-invoice validator is Java, and that is fine.** Authoritative
  XRechnung / EN 16931 validation is the KoSIT validator, which is Java. We
  run it as a local sidecar rather than reimplement EN 16931 (`06`). It stays
  on the firm's server, so self-hosting holds. Locked to exactly one Java
  instance so nobody adds more out of convenience.

Alternatives considered.

- **TypeScript end to end** (e.g. React Router / Next plus a typed SQL layer).
  Viable only on the strict condition that all arithmetic lives in Postgres
  and a decimal library, with Python kept as an AI-only sidecar. Rejected
  because the money-safety argument cuts against a TS backend and Python is
  already required for the AI and image work, so TS-everywhere would not even
  remove a language. It stays the fallback if a future team is strongly
  TS-native.
- **Pure server-rendered hypermedia** (HTMX / Hotwire, server-rendered pages
  with sprinkles). Rejected because two screens are genuinely interactive and
  need real client-side state; a hypermedia-only approach would fight them.

What would invalidate this.

- If the team that maintains this turns out to be strongly TypeScript-native
  and commits to the math-in-Postgres discipline, TS-everywhere becomes the
  more maintainable choice for a small firm's tool. Maintainability by whoever
  inherits it is the real swing factor, more than any technical nicety.
- If KoSIT validation became available as a non-Java path we trust, the one
  Java instance could be removed.

Confidence. High on Python backend for money safety and on the PWA for field
capture. Medium on the specific frontend framework choice within React;
that can be settled at first scaffolding without disturbing the lanes.
