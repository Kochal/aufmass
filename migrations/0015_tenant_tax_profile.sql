-- 0015_tenant_tax_profile.sql
-- Per-tenant regulatory state the engines branch on (directive 02,
-- tenant_tax_profile; 01). Snapshotted onto an Angebot/Rechnung at issue so a
-- later profile change does not rewrite an issued document (06, Stage 3).
--
-- NOTE: this table stores tax *state*, not tax *math*. Applying the rate to a
-- total is the deterministic engine's job (02: "No money math in the database").

create table tenant_tax_profile (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenant(id),
  kleinunternehmer            boolean not null default false,
  ust_treatment               text not null default 'regelbesteuert'
                                check (ust_treatment in ('regelbesteuert','kleinunternehmer')),
  ust_satz                    numeric(5,2) not null default 19.00,   -- stored rate, not applied here
  ust_idnr                    text,
  steuernummer                text,
  turnover_band               text check (turnover_band in ('lt_800k','gte_800k')),
  -- derived from the band and stored for auditability (>=800k -> 2027, <800k -> 2028).
  einvoice_issue_required_from date,
  unique (tenant_id)
);
select core.add_standard_columns('tenant_tax_profile');
select core.register_business_table('tenant_tax_profile');
