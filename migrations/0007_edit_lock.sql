-- 0007_edit_lock.sql
-- Advisory edit leases at aggregate granularity. Directive 02, "Advisory edit
-- leases". The hard guarantee is the optimistic-concurrency row_version check
-- (0003); this layer is the "in Bearbeitung von X" UX and collision avoidance.
--
-- edit_lock is ephemeral operational state, not a GoBD business record, so it
-- is registered with RLS + audit but is genuinely deletable (release / expiry):
-- the no-hard-delete guard would be wrong here.

create table edit_lock (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id),
  resource_type text not null,                 -- 'angebot' | 'aufmass' | 'bestellung'
  resource_id   uuid not null,
  owner_user_id uuid not null references app_user(id),
  acquired_at   timestamptz not null default now(),
  expires_at    timestamptz not null,
  unique (tenant_id, resource_type, resource_id)
);
select core.add_standard_columns('edit_lock');
select core.register_business_table('edit_lock', p_hard_delete_ok => true);

-- Acquire a lease. Clears an expired lease first (auto-expiry: a closed laptop
-- never locks a record forever), then takes the lease if free. Raises if a live
-- lease is held by someone else.
create or replace function core.acquire_edit_lock(
  p_resource_type text,
  p_resource_id   uuid,
  p_owner         uuid,
  p_ttl           interval default interval '5 minutes'
) returns edit_lock
  language plpgsql as $$
declare
  v_tenant uuid := core.current_tenant();
  v_lock   edit_lock;
begin
  delete from edit_lock
   where tenant_id = v_tenant
     and resource_type = p_resource_type
     and resource_id = p_resource_id
     and expires_at <= now();

  insert into edit_lock (tenant_id, resource_type, resource_id, owner_user_id, expires_at)
  values (v_tenant, p_resource_type, p_resource_id, p_owner, now() + p_ttl)
  on conflict (tenant_id, resource_type, resource_id) do nothing
  returning * into v_lock;

  if v_lock.id is null then
    select * into v_lock from edit_lock
     where tenant_id = v_tenant
       and resource_type = p_resource_type
       and resource_id = p_resource_id;
    raise exception 'resource %/% is locked by % until %',
      p_resource_type, p_resource_id, v_lock.owner_user_id, v_lock.expires_at
      using errcode = 'lock_not_available';
  end if;

  return v_lock;
end $$;

-- Renew (heartbeat) a lease the caller owns.
create or replace function core.renew_edit_lock(
  p_resource_type text,
  p_resource_id   uuid,
  p_owner         uuid,
  p_ttl           interval default interval '5 minutes'
) returns void
  language plpgsql as $$
declare v_tenant uuid := core.current_tenant();
begin
  update edit_lock
     set expires_at = now() + p_ttl
   where tenant_id = v_tenant
     and resource_type = p_resource_type
     and resource_id = p_resource_id
     and owner_user_id = p_owner;
  if not found then
    raise exception 'no lease held by % on %/%', p_owner, p_resource_type, p_resource_id
      using errcode = 'lock_not_available';
  end if;
end $$;

-- Release a lease the caller owns (on save / close).
create or replace function core.release_edit_lock(
  p_resource_type text,
  p_resource_id   uuid,
  p_owner         uuid
) returns void
  language plpgsql as $$
declare v_tenant uuid := core.current_tenant();
begin
  delete from edit_lock
   where tenant_id = v_tenant
     and resource_type = p_resource_type
     and resource_id = p_resource_id
     and owner_user_id = p_owner;
end $$;
