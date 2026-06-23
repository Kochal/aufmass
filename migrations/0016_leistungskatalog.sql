-- 0016_leistungskatalog.sql
-- The firm's own priced services that LV positions are matched against (02
-- Catalog; 06 Stage 2). Price changes are versioned/audited via audit_log so
-- historical quotes remain reconstructable (02, resolved decision 3).

create table leistungskatalog (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name      text not null,
  aktiv     boolean not null default true
);
select core.add_standard_columns('leistungskatalog');
select core.register_business_table('leistungskatalog');

create table leistung (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id),
  leistungskatalog_id uuid not null references leistungskatalog(id),
  code               text not null,
  kurztext           text not null,
  langtext           text,
  einheit            text not null,                 -- m2 | lfm | stck | psch | ...
  einheitspreis      numeric(12,2),                 -- current price; stored, not computed here
  aktiv              boolean not null default true,
  -- Langtext embedding for semantic matching is produced by the self-hosted
  -- model (03) and added with the matching implementation; not stored yet.
  unique (tenant_id, code)
);
select core.add_standard_columns('leistung');
select core.register_business_table('leistung');
