-- 0008_tenant_setting_and_document.sql
-- Two cross-cutting tables that directive 05 depends on:
--   tenant_setting  - per-tenant module toggles and operational defaults (02)
--   document        - original-format artifacts with a retention class (02/04)
-- Both inherit the full set of foundation guarantees via register_business_table.

-- tenant_setting: typed keys, audited on change. Modules read these instead of
-- hardcoding (e.g. time_tracking, mileage_tracking, abnahme_mode, approval
-- granularity, material costing method). Value is jsonb so a key can be a bool,
-- a string, or a small object. (directive 02, tenant_setting; 05 toggles.)
create table tenant_setting (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  key       text not null,
  value     jsonb not null,
  unique (tenant_id, key)
);
select core.add_standard_columns('tenant_setting');
select core.register_business_table('tenant_setting');

-- Read a setting for the current tenant, falling back to a default when unset.
create or replace function core.get_setting(p_key text, p_default jsonb default null)
  returns jsonb language sql stable as $$
  select coalesce(
    (select value from tenant_setting
       where tenant_id = core.current_tenant() and key = p_key and deleted_at is null),
    p_default)
$$;

-- Convenience boolean accessor for module toggles.
create or replace function core.setting_bool(p_key text, p_default boolean)
  returns boolean language sql stable as $$
  select coalesce((core.get_setting(p_key))::boolean, p_default)
$$;

-- document: every original-format artifact (e-invoice XML, GAEB, Aufmaß photos,
-- signed PDFs, order confirmations, delivery notes). Originals are immutable;
-- physical deletion only via the retention job (04). The full archival story
-- (content-hash write-once, object store) is directive 04; here it carries what
-- 05 needs to attach originals with the right retention class.
create table document (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  kind            text not null,          -- 'abnahmeprotokoll' | 'auftragsbestaetigung' | 'lieferschein' | ...
  content_hash    text,                   -- set when the original is archived (04)
  storage_ref     text,                   -- object-store reference (04)
  original_format boolean not null default true,
  retention_class integer not null check (retention_class in (6,8,10)),  -- years (01)
  retention_until date                    -- computed by the retention logic (04)
);
select core.add_standard_columns('document');
select core.register_business_table('document');
