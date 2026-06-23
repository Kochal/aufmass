-- foundation_test.sql
-- Proves the cross-cutting guarantees from directive 02 / CLAUDE.md actually
-- hold against the migrated schema. Run after applying migrations/*.sql, as a
-- superuser or migration_role (the suite SETs ROLE app_role to exercise RLS).
--
-- Any failed assertion aborts with a nonzero exit (ON_ERROR_STOP). Reaching the
-- final banner means every guarantee passed.
--
-- Guarantees checked:
--   G1  no app.tenant_id set            -> query returns nothing
--   G2  cross-tenant read               -> returns empty
--   G3  issued Rechnung                 -> UPDATE rejected (controlled move ok)
--   G4  rolled-back invoice issue       -> burns no number (gapless survives)
--   G5  hard DELETE on a business table -> refused (soft delete works)
--   G6  every write                     -> lands a row in audit_log
--   plus: optimistic concurrency (row_version) and the edit_lock leases.

\set ON_ERROR_STOP on
\timing off

-- ===========================================================================
-- Test helpers and fixtures (run as the privileged login role; RLS bypassed).
-- ===========================================================================

create or replace function _t_assert(p_cond boolean, p_msg text) returns void
  language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
  raise notice 'ok: %', p_msg;
end $$;

select set_config('app.user_id', 'setup-job', false);

insert into tenant(name) values ('Maler Eins GmbH') returning id as t1 \gset
insert into tenant(name) values ('Boden Zwei GmbH') returning id as t2 \gset

insert into app_user(tenant_id,email,display_name) values (:'t1','u1@eins.de' ,'User Eins')   returning id as u1  \gset
insert into app_user(tenant_id,email,display_name) values (:'t1','u1b@eins.de','User Eins B') returning id as u1b \gset
insert into app_user(tenant_id,email,display_name) values (:'t2','u2@zwei.de' ,'User Zwei')   returning id as u2  \gset

insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless,current_period)
  values (:'t1','rechnung','RE-{YYYY}-{SEQ:5}','yearly',137,137,true, to_char(now(),'YYYY'))
  returning id as nk1 \gset

insert into auftraggeber(tenant_id,name,typ,kundennummer) values (:'t1','Kunde A1','privat','K-001') returning id as a1 \gset
insert into auftraggeber(tenant_id,name,typ,kundennummer) values (:'t2','Kunde A2','privat','K-001') returning id as a2 \gset

insert into rechnung(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as r1 \gset
insert into rechnung(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as r2 \gset
insert into rechnung(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as r3 \gset

-- Ids that DO blocks need (psql does not interpolate :vars inside $$...$$).
select set_config('test.res1', '',     false),
       set_config('test.u1b',  :'u1b', false);

-- From here on, run exactly as the application would: as app_role, bound by RLS.
set role app_role;

-- ===========================================================================
\echo ''
\echo '### G1: no app.tenant_id set -> query returns nothing'
-- ===========================================================================
select set_config('app.tenant_id', '', false);
select _t_assert((select count(*) from auftraggeber) = 0,
                 'G1: with no tenant set, a business query sees no rows');

-- ===========================================================================
\echo ''
\echo '### G2: cross-tenant read returns empty'
-- ===========================================================================
select set_config('app.tenant_id', :'t2', false);
select _t_assert((select count(*) from auftraggeber where id = :'a1'::uuid) = 0,
                 'G2: tenant T2 cannot read T1''s row A1');
select _t_assert((select count(*) from auftraggeber) = 1,
                 'G2: tenant T2 sees only its own rows');

-- ===========================================================================
\echo ''
\echo '### G3: issued Rechnung rejects an UPDATE'
-- ===========================================================================
select set_config('app.tenant_id', :'t1', false);
select set_config('app.user_id',   :'u1', false);
select set_config('test.r1',       :'r1', false);

select core.issue_rechnung(:'r1'::uuid);
select _t_assert((select status from rechnung where id = :'r1'::uuid) = 'issued',
                 'G3: R1 transitioned draft -> issued');

do $$
declare ok boolean := false;
begin
  begin
    update rechnung set betrag_netto = 999.00 where id = current_setting('test.r1')::uuid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'ASSERTION FAILED: G3: issued rechnung accepted a content UPDATE'; end if;
  raise notice 'ok: G3: issued rechnung rejected the content UPDATE';
end $$;

-- the controlled status move IS still allowed
update rechnung set status = 'cancelled' where id = :'r1'::uuid;
select _t_assert((select status from rechnung where id = :'r1'::uuid) = 'cancelled',
                 'G3: controlled move issued -> cancelled is allowed');

-- ===========================================================================
\echo ''
\echo '### G4: a rolled-back invoice issue burns no number (gapless survives)'
-- ===========================================================================
select counter as c0 from nummernkreis where tenant_id = :'t1' and doc_type = 'rechnung' \gset

begin;
savepoint sp_issue;
  select core.issue_rechnung(:'r2'::uuid) as num_in_doomed_txn \gset
  select counter as c_issued from nummernkreis where tenant_id = :'t1' and doc_type = 'rechnung' \gset
rollback to savepoint sp_issue;
select counter as c_rolledback from nummernkreis where tenant_id = :'t1' and doc_type = 'rechnung' \gset
  select core.issue_rechnung(:'r3'::uuid) as num_after \gset
  select counter as c_reissued from nummernkreis where tenant_id = :'t1' and doc_type = 'rechnung' \gset
commit;

select _t_assert((:c_issued)::bigint     = (:c0)::bigint + 1, 'G4: issuing advanced the counter by 1');
select _t_assert((:c_rolledback)::bigint = (:c0)::bigint,     'G4: rollback restored the counter (no number burned)');
select _t_assert((:c_reissued)::bigint   = (:c0)::bigint + 1, 'G4: the next issue reused that number (gapless)');

-- ===========================================================================
\echo ''
\echo '### G5: a hard DELETE on a business table is refused'
-- ===========================================================================
select set_config('app.tenant_id', :'t1', false);
-- a dependency-free client (a1 now carries invoices; deleting it is blocked by
-- the directive-05 guard, which has its own test in operations_test.sql)
insert into auftraggeber(tenant_id,name,typ) values (:'t1','Delete Probe','privat') returning id as adel \gset
select set_config('test.adel', :'adel', false);

do $$
declare ok boolean := false;
begin
  begin
    delete from auftraggeber where id = current_setting('test.adel')::uuid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'ASSERTION FAILED: G5: hard DELETE on auftraggeber was not refused'; end if;
  raise notice 'ok: G5: hard DELETE on a business table is refused';
end $$;

-- soft delete is the supported path and leaves the row in place
select core.soft_delete('auftraggeber', :'adel'::uuid);
select _t_assert((select deleted_at is not null from auftraggeber where id = :'adel'::uuid),
                 'G5: soft delete sets deleted_at (row preserved)');

-- ===========================================================================
\echo ''
\echo '### G6: every write lands a row in audit_log'
-- ===========================================================================
select set_config('app.tenant_id', :'t1', false);
select set_config('app.user_id',   :'u1', false);

insert into auftraggeber(tenant_id,name,typ) values (:'t1','Audit Probe','privat') returning id as a3 \gset
select _t_assert((select count(*) from audit_log where table_name='auftraggeber' and row_id=:'a3'::uuid and op='I') = 1,
                 'G6: INSERT logged exactly one I row');
select _t_assert((select actor from audit_log where table_name='auftraggeber' and row_id=:'a3'::uuid and op='I') = :'u1',
                 'G6: audit actor is app.user_id');

update auftraggeber set name = 'Audit Probe (edited)' where id = :'a3'::uuid;
select _t_assert((select count(*) from audit_log where table_name='auftraggeber' and row_id=:'a3'::uuid and op='U') = 1,
                 'G6: UPDATE logged one U row');

select core.soft_delete('auftraggeber', :'a3'::uuid);
select _t_assert((select count(*) from audit_log where table_name='auftraggeber' and row_id=:'a3'::uuid and op='U') = 2,
                 'G6: soft delete logged another U row');

-- and the trail is append-only: the app cannot rewrite history
do $$
declare ok boolean := false;
begin
  begin
    update audit_log set actor = 'tamper' where table_name = 'auftraggeber';
  exception when others then ok := true;
  end;
  if not ok then raise exception 'ASSERTION FAILED: G6: audit_log accepted an UPDATE'; end if;
  raise notice 'ok: G6: audit_log is append-only (UPDATE refused)';
end $$;

-- ===========================================================================
\echo ''
\echo '### OCC: optimistic concurrency via row_version'
-- ===========================================================================
insert into auftraggeber(tenant_id,name) values (:'t1','Concurrency Probe')
  returning id as a4, row_version as rv0 \gset

update auftraggeber set name = 'rev2' where id = :'a4'::uuid and row_version = (:rv0)::int;
select _t_assert((select row_version from auftraggeber where id = :'a4'::uuid) = (:rv0)::int + 1,
                 'OCC: a successful update increments row_version');

with stale as (
  update auftraggeber set name = 'rev2-conflict'
   where id = :'a4'::uuid and row_version = (:rv0)::int
  returning 1
) select count(*) as affected from stale \gset
select _t_assert((:affected)::int = 0,
                 'OCC: an update against a stale row_version affects 0 rows (conflict)');

-- ===========================================================================
\echo ''
\echo '### LOCK: advisory edit leases (edit_lock)'
-- ===========================================================================
select gen_random_uuid() as res1 \gset
select set_config('test.res1', :'res1', false);

select _t_assert(owner_user_id = :'u1'::uuid, 'LOCK: U1 acquires a free lease')
  from core.acquire_edit_lock('angebot', :'res1'::uuid, :'u1'::uuid);

do $$
declare ok boolean := false;
begin
  begin
    perform core.acquire_edit_lock('angebot',
                                   current_setting('test.res1')::uuid,
                                   current_setting('test.u1b')::uuid);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'ASSERTION FAILED: LOCK: a held lease did not block a second editor'; end if;
  raise notice 'ok: LOCK: a live lease blocks a second editor';
end $$;

select core.release_edit_lock('angebot', :'res1'::uuid, :'u1'::uuid);
select _t_assert(owner_user_id = :'u1b'::uuid, 'LOCK: after release U1b can acquire')
  from core.acquire_edit_lock('angebot', :'res1'::uuid, :'u1b'::uuid);

-- auto-expiry: an already-expired lease is cleared on the next acquire
select core.release_edit_lock('angebot', :'res1'::uuid, :'u1b'::uuid);
select core.acquire_edit_lock('angebot', :'res1'::uuid, :'u1'::uuid, interval '-1 second');
select _t_assert(owner_user_id = :'u1b'::uuid, 'LOCK: an expired lease auto-clears for the next acquirer')
  from core.acquire_edit_lock('angebot', :'res1'::uuid, :'u1b'::uuid);

reset role;

\echo ''
\echo '==================================================='
\echo '  ALL FOUNDATION GUARANTEES PASSED'
\echo '==================================================='
