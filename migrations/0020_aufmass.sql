-- 0020_aufmass.sql
-- Aufmaß capture (directive 07; schema reserved in 02). A measurement session
-- (aufmass) and its individual measured things (aufmass_entry). Both inherit the
-- full foundation: tenant RLS, audit, soft-delete/no-hard-delete, optimistic
-- concurrency. aufmass is a lockable aggregate under the 02 concurrency model
-- (edit_lock already names 'aufmass' as a resource_type, see 0007).
--
-- The DB does NO arithmetic here. Reconciliation (formula-as-checksum, candidate
-- search), magnitude bands and the geometric cross-checks are the deterministic
-- engine (app-layer, directive 07), exactly as money math is (02: "No money math
-- in the database"). The columns below hold what that engine produces; the DB
-- stores it, audits changes to it, and enforces the row-level guarantees plus the
-- prüfbarkeit floor (00 non-negotiable 6; 01 prüfbares Aufmaß) at confirm time.

-- aufmass: a measurement session / sheet. Free-form layout is expected (07):
-- structure comes from the entries, not the sheet grid. The source photo or
-- audio is kept as an immutable document (04, non-negotiable 4); manual capture
-- has no original. quelle drives that: foto/voice MUST point at an archived
-- original, manual MUST NOT.
create table aufmass (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id),
  projekt_id         uuid not null references projekt(id),   -- always attaches to a Baustelle
  erfasst_von        uuid references app_user(id),           -- who captured it
  erfasst_am         timestamptz not null default now(),
  quelle             text not null check (quelle in ('foto','voice','manual')),
  source_document_id uuid references document(id),           -- the photo/audio original (04)
  -- A photo/voice capture must reference its archived original; a manual capture
  -- has none. (07 capture modes; 00 non-negotiable 4.)
  constraint aufmass_original_present check (
    (quelle in ('foto','voice') and source_document_id is not null)
    or (quelle = 'manual' and source_document_id is null)
  )
);
select core.add_standard_columns('aufmass');
select core.register_business_table('aufmass');

-- aufmass_entry: one measured thing. Home of the expression-tree + candidate +
-- crop + confidence design (07). All result columns are quantities, numeric(14,3)
-- (02). The engine writes expression/candidate_readings/computed_result/
-- reconciled/confidence; the human confirms grouping and labels (07 verification
-- UX). lv_position_id is nullable: standalone Aufmaß (a job with no tender yet) is
-- allowed, with the link left null until a quote is built (07 open question 4).
create table aufmass_entry (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id),
  aufmass_id         uuid not null references aufmass(id),
  bauteil            text,                          -- label; may be low-confidence
  expression         jsonb,                         -- parsed formula tree: operands, operator, multiplier
  candidate_readings jsonb,                         -- alternative glyph reads for reconciliation
  written_result     numeric(14,3),                 -- the result the builder wrote on the sheet
  computed_result    numeric(14,3),                 -- deterministic evaluation / reconciled value (engine)
  einheit            text,                           -- unit of the measured quantity (drives the magnitude band)
  reconciled         boolean not null default false, -- formula and written result agree / were reconciled
  confidence         numeric(5,4),                   -- engine confidence for this reading
  source_crop_ref    jsonb,                          -- crop coordinates into the source image for this entry
  lv_position_id     uuid references lv_position(id),-- nullable: the residual human-review link to billing
  review_status      text not null default 'review'
                       check (review_status in ('review','auto_accepted','confirmed','corrected'))
);
select core.add_standard_columns('aufmass_entry');
select core.register_business_table('aufmass_entry');

-- Prüfbarkeit floor. A measurement only has to be traceable once it is both
-- human-confirmed AND linked to an LV position, i.e. about to feed billing
-- (07 "Linkage to billing"; 01 prüfbares Aufmaß; 00 non-negotiable 6, "every
-- committed value traceable to its source ... a measurement to a formula and an
-- image crop. No orphan numbers."). Entries still in capture/review, or not yet
-- linked, are deliberately free so the capture and review workflows are never
-- blocked. The reconciliation arithmetic itself stays app-layer; this guard only
-- refuses to *commit* an untraceable number.
create or replace function core.check_aufmass_entry_pruefbar() returns trigger
  language plpgsql as $$
declare
  v_quelle text;
begin
  if new.lv_position_id is null or new.review_status not in ('confirmed','corrected') then
    return new;  -- not yet billing-bound: nothing to enforce
  end if;

  -- 1. It must carry a number (written or computed).
  if new.written_result is null and new.computed_result is null then
    raise exception 'aufmass_entry %: a confirmed, billing-linked measurement must have a result', new.id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- 2. It must trace to its source. A number read from a photo or voice capture
  --    must point at the crop it was read from; a manual entry is its own trace
  --    (the keying user, captured in audit_log).
  select quelle into v_quelle from aufmass where id = new.aufmass_id;
  if v_quelle in ('foto','voice') and new.source_crop_ref is null then
    raise exception 'aufmass_entry %: a confirmed measurement read from a % capture must reference its source crop',
      new.id, v_quelle
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;

create trigger mmm_aufmass_pruefbar before insert or update on aufmass_entry
  for each row execute function core.check_aufmass_entry_pruefbar();
