-- Background expiry function for Gewährleistung.
--
-- SECURITY DEFINER means it runs as its owner (maler, the superuser created by
-- the migration step), which bypasses FORCE ROW LEVEL SECURITY. This is the only
-- way to do a cross-tenant UPDATE from the app_role without iterating over tenants
-- one by one. The audit triggers still fire correctly because:
--   • audit_log.tenant_id is read from the row itself (not from app.tenant_id)
--   • updated_by is set to 'system:expire_gewaehrleistung' via set_config before
--     the UPDATE, so every flipped row has a clear system actor in the audit trail
--
-- A future notification hook (email / UI) can add a PERFORM after the UPDATE
-- and iterate the affected rows before returning the count.

create or replace function core.expire_gewaehrleistung() returns int
  language plpgsql
  security definer
  set search_path = public, core
as $$
declare
  v_count int;
begin
  -- Mark this transaction as the system expiry job.
  perform set_config('app.user_id', 'system:expire_gewaehrleistung', true);

  update gewaehrleistung
    set status = 'abgelaufen'
  where status   = 'laufend'
    and frist_ende is not null
    and frist_ende < current_date
    and deleted_at  is null;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- app_role may call this; SECURITY DEFINER elevates at runtime to bypass RLS.
grant execute on function core.expire_gewaehrleistung() to app_role;
