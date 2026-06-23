# 04 - Backup and Archival

Where the durability and retention promises become real: Postgres
point-in-time recovery, original-format archival of records, and the
retention-and-deletion job. This implements the GoBD requirements stated in
`01` (immutability, original format, 8/10/6-year retention) and the
mechanisms `02` defines (soft-delete, the restricted retention role, the
append-only audit log).

DSGVO erasure mechanics and key custody detail are `09`; residency (all of
this stays in Germany / the EU) is `03`. This file states backup, archival,
retention enforcement, and disaster recovery.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Backup vs archival, Postgres PITR, document
  archival (WORM), retention/deletion job, disaster recovery.

-----

## Two different things, often conflated

- **Backup** is operational: recover from hardware failure, corruption, or a
  bad deploy. Measured by how little is lost (RPO) and how fast service
  returns (RTO).
- **Archival** is legal: keep records unaltered for their statutory period
  and prove they were not changed (`01`). Measured by integrity and
  retention, not recovery speed.

They have different mechanisms and are specified separately below. A backup is
not an archive (it gets overwritten), and an archive is not a backup (it is
not a fast restore path).

-----

## Database backup (Postgres)

- **Point-in-time recovery** via continuous WAL archiving plus periodic base
  backups. Recovery to any moment, which is what pairs with the `02`
  immutability model (no record silently vanishes between backups).
- **3-2-1**: at least three copies, on two kinds of media, with one
  geographically separate, all within Germany / the EU (`03`).
- **Encrypted** at rest and in transit.
- **Tested restores on a schedule.** An untested backup is a guess. A
  periodic drill restores into a scratch environment and verifies integrity;
  the drill result is recorded.
- Backup retention (how long old backups are kept) is distinct from record
  retention (how long records must legally live, below). Do not confuse the
  two windows.

-----

## Document archival (the GoBD originals)

The original-format artifacts from across the system: incoming e-invoice XML,
outgoing XRechnung / ZUGFeRD XML, GAEB files, Aufmaß photos and audio, signed
Abnahme protocols and other signed PDFs (`01`, `02` `document`).

- **Original format, unaltered.** The structured XML is the original; a
  rendered PDF is only a copy (`01`). Archived as received / generated.
- **Revisionssicher (WORM).** Stored with write-once / object-lock semantics
  so an original cannot be altered or deleted before its retention expires.
- **Content-hashed.** Each artifact carries a hash for integrity and
  tamper-evidence; a changed hash is a flag.
- **Retention class on every document.** `retention_class` (8 / 10 / 6 year,
  `01`) and computed `retention_until`, set when the document is stored.

-----

## Retention and lawful deletion

- Nothing is physically deleted while under retention. Application-level
  deletion is soft only (`02`); the DELETE grant is revoked from the app role
  and object-lock blocks early removal.
- **The retention job** is the only path to physical deletion. It runs under
  the restricted retention role (`02`), removes only records whose
  `retention_until` has passed, and its deletions are themselves written to
  the append-only `audit_log` (`02`). Deletion is an audited event, not a
  silent one.
- **DSGVO vs retention.** A data-subject erasure request (Art. 17) can
  collide with a statutory retention duty. Where a record is under retention,
  erasure is deferred and the personal data is **restricted**
  (Einschränkung der Verarbeitung, gesperrt) rather than deleted, then
  removed when the period lapses. The system therefore supports restriction
  as a first-class state, not only deletion. The decision logic and the
  data-subject workflow are owned by `09`; this directive provides the
  restrict-then-delete mechanism.

-----

## The audit log is itself a record

`audit_log` (`02`) is append-only and is part of what must survive: it is
backed up with the database and never truncated. It is how a Betriebsprüfung
reconstructs who changed what. Treat it as archival, not as disposable
operational logging.

-----

## Disaster recovery

- **Targets** (modest for a single firm, confirmed in the open questions):
  RPO on the order of minutes via WAL archiving; RTO on the order of hours
  via a documented restore.
- **Offsite copy** in a second German / EU location, encrypted.
- **Runbook**: a written, tested restore procedure (this is also part of the
  Verfahrensdokumentation that `01` requires and `09` owns).
- **Model weights**: fine-tuned Aufmaß weights (`03`) are backed up here;
  base weights are re-downloadable and excluded.

-----

## Keys

Backups and WORM archives are encrypted, so the encryption keys are
themselves load-bearing: lost keys make a backup useless, and over-exposed
keys defeat the point. Key custody and rotation are owned by `09`; this
directive only flags that backup integrity depends on it.

-----

## Open questions

1. **RPO / RTO targets**: confirm acceptable data-loss and downtime windows
   with the firm. Drafted as minutes / hours.
2. **Offsite location and provider**: which second German / EU site holds the
   geographically-separate copy. Drafted as unfixed, EU-bound.
3. **Backup retention window**: how long operational backups are kept (as
   distinct from statutory record retention). Drafted as unset; decide
   alongside RPO/RTO.
4. **WORM mechanism**: provider object-lock vs a filesystem-level immutability
   approach for the revisionssicher archive. Drafted as object-lock,
   contingent on the `03` storage choice.
