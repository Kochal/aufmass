-- 0004_tenant_and_users.sql
-- Identity tables: the tenant (root of isolation) and app_user (the actor in
-- audit_log). Directive 02, "Identity and tenant config".

-- tenant: the firm. Its own id IS its tenant scope, so RLS keys on `id`.
create table tenant (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  rechtsform   text,
  steuernummer text,
  status       text not null default 'active'
                 check (status in ('active','suspended','closed'))
);
select core.add_standard_columns('tenant');
select core.register_business_table('tenant', p_tenant_col => 'id');

-- app_user: a person in a tenant. Referenced as the actor throughout.
create table app_user (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id),
  email        text not null,
  display_name text,
  role         text not null default 'mitarbeiter',
  status       text not null default 'active'
                 check (status in ('active','disabled')),
  unique (tenant_id, email)
);
select core.add_standard_columns('app_user');
select core.register_business_table('app_user');

-- Note: tenant_tax_profile and tenant_setting (directive 02) follow the exact
-- same two-line registration pattern and are added with their feature work;
-- they are not part of the foundation guarantees.
