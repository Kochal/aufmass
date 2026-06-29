-- 0025_mangel_foto.sql
-- Mängel photos (directive 05 / UI round 2). A Mangel can have many photos;
-- each photo is a write-once original (directive 04). Photos are stored on the
-- EU server (no egress). The `document` FK carries the content-hash + storage_ref
-- from storage.py. Soft-delete on the row; the original is never deleted
-- (retention_class 10 yr per §147 AO — same as the parent Mangel record).
-- The table inherits the full 02 foundation: tenant RLS, audit, soft-delete,
-- optimistic concurrency, and the no-hard-delete trigger.

create table mangel_foto (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id),
  mangel_id   uuid not null references mangel(id),
  document_id uuid not null references document(id),  -- write-once original (04)
  beschriftung text                                    -- optional caption
);
select core.add_standard_columns('mangel_foto');
select core.register_business_table('mangel_foto');
