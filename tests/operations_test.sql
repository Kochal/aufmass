-- operations_test.sql
-- Proves the directive-05 (operational spine) rules hold on top of the 02
-- foundation. Run after migrations, as superuser/migration_role (the suite SETs
-- ROLE app_role). Any failed assertion aborts with a nonzero exit.
--
--   O1  projekt number is auto-allocated from the Nummernkreis
--   O2  projekt lifecycle: forward free; backward/cancel need a reason;
--       'abgenommen' needs a date; terminal states are terminal; pause/resume
--   O3  gewaehrleistung.frist_ende computed by regime (VOB 4y / BGB 5y / override)
--   O4  arbeitszeit: duration derived; an approved entry is frozen; a correction
--       is a new linked entry
--   O5  an Auftraggeber with open work cannot be soft-deleted; otherwise it can
--   O6  bestellung lifecycle via the generic linear guard
--   O7  inheritance: directive-05 tables get tenant RLS + audit for free
--   O8  tenant_setting accessor returns values and defaults

\set ON_ERROR_STOP on
\timing off

create or replace function _t_assert(p_cond boolean, p_msg text) returns void
  language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
  raise notice 'ok: %', p_msg;
end $$;

-- ---- fixtures (privileged; RLS bypassed) ----
select set_config('app.user_id','setup-job',false);

insert into tenant(name) values ('Maler Eins GmbH') returning id as t1 \gset
insert into tenant(name) values ('Boden Zwei GmbH') returning id as t2 \gset
insert into app_user(tenant_id,email) values (:'t1','u1@eins.de') returning id as u1 \gset
insert into app_user(tenant_id,email) values (:'t2','u2@zwei.de') returning id as u2 \gset
insert into auftraggeber(tenant_id,name) values (:'t1','Kunde A1') returning id as a1 \gset
insert into auftraggeber(tenant_id,name) values (:'t1','Kunde A3 (no work)') returning id as a3 \gset
insert into auftraggeber(tenant_id,name) values (:'t2','Kunde A2') returning id as a2 \gset

insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless)
  values (:'t1','projekt','P-{YYYY}-{SEQ:4}','none',0,0,false) returning id as nkp \gset

set role app_role;
select set_config('app.tenant_id', :'t1', false);
select set_config('app.user_id',   :'u1', false);
select set_config('app.reason',    '',    false);

-- ===========================================================================
\echo ''
\echo '### O1: projekt number auto-allocated from the Nummernkreis'
-- ===========================================================================
insert into projekt(tenant_id,auftraggeber_id,name) values (:'t1',:'a1','Bad Sanierung') returning id as p1 \gset
select set_config('test.p1', :'p1', false);
select _t_assert((select nummer from projekt where id=:'p1'::uuid) like 'P-%-0001',
                 'O1: first projekt got an allocated number (P-YYYY-0001)');

-- ===========================================================================
\echo ''
\echo '### O2: projekt lifecycle state machine'
-- ===========================================================================
-- forward moves are free
update projekt set status='kalkulation'   where id=:'p1'::uuid;
update projekt set status='beauftragt', regime='vob' where id=:'p1'::uuid;
update projekt set status='in_ausfuehrung' where id=:'p1'::uuid;
select _t_assert((select status from projekt where id=:'p1'::uuid)='in_ausfuehrung',
                 'O2: forward transitions are allowed');

-- reaching 'abgenommen' without a date is rejected
do $$ declare ok boolean:=false; begin
  begin update projekt set status='abgenommen' where id=current_setting('test.p1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O2: abgenommen without abnahme_datum was allowed'; end if;
  raise notice 'ok: O2: abgenommen requires abnahme_datum';
end $$;

-- with a date it is allowed
update projekt set status='abgenommen', abnahme_datum=date '2026-06-15' where id=:'p1'::uuid;
select _t_assert((select status from projekt where id=:'p1'::uuid)='abgenommen',
                 'O2: abgenommen with a date is allowed');

-- backward without a reason is rejected
do $$ declare ok boolean:=false; begin
  begin update projekt set status='in_ausfuehrung' where id=current_setting('test.p1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O2: backward move without a reason was allowed'; end if;
  raise notice 'ok: O2: backward move requires a reason';
end $$;

-- backward WITH a reason is allowed, then forward again
select set_config('app.reason','Nacharbeit noetig',false);
update projekt set status='in_ausfuehrung' where id=:'p1'::uuid;
select set_config('app.reason','',false);
update projekt set status='abgenommen' where id=:'p1'::uuid;   -- date still set
select _t_assert((select status from projekt where id=:'p1'::uuid)='abgenommen',
                 'O2: backward+forward with a reason works');

-- cancellation requires a reason and is terminal
insert into projekt(tenant_id,auftraggeber_id,name) values (:'t1',:'a1','Storno Projekt') returning id as p3 \gset
select set_config('test.p3', :'p3', false);
do $$ declare ok boolean:=false; begin
  begin update projekt set status='storniert' where id=current_setting('test.p3')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O2: storniert without a reason was allowed'; end if;
  raise notice 'ok: O2: cancellation requires a reason';
end $$;
select set_config('app.reason','Kunde abgesprungen',false);
update projekt set status='storniert' where id=:'p3'::uuid;
select set_config('app.reason','',false);
do $$ declare ok boolean:=false; begin
  begin update projekt set status='angelegt' where id=current_setting('test.p3')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O2: a terminal (storniert) projekt accepted a transition'; end if;
  raise notice 'ok: O2: terminal state is terminal';
end $$;

-- pause remembers and resume must return to the prior state
insert into projekt(tenant_id,auftraggeber_id,name) values (:'t1',:'a1','Pause Projekt') returning id as p2 \gset
select set_config('test.p2', :'p2', false);
update projekt set status='kalkulation' where id=:'p2'::uuid;
update projekt set status='pausiert'    where id=:'p2'::uuid;
select _t_assert((select status_vor_pause from projekt where id=:'p2'::uuid)='kalkulation',
                 'O2: pause remembers the prior state');
do $$ declare ok boolean:=false; begin
  begin update projekt set status='beauftragt' where id=current_setting('test.p2')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O2: resume to the wrong state was allowed'; end if;
  raise notice 'ok: O2: resume must return to the remembered state';
end $$;
update projekt set status='kalkulation' where id=:'p2'::uuid;   -- correct resume
select _t_assert((select status from projekt where id=:'p2'::uuid)='kalkulation'
              and (select status_vor_pause from projekt where id=:'p2'::uuid) is null,
                 'O2: resume returns to the remembered state and clears it');

-- ===========================================================================
\echo ''
\echo '### O3: gewaehrleistung.frist_ende computed by regime'
-- ===========================================================================
insert into gewaehrleistung(tenant_id,projekt_id,regime,start_datum)
  values (:'t1',:'p1','vob', date '2026-06-15') returning frist_jahre as fj_vob, frist_ende as fe_vob \gset
select _t_assert((:'fj_vob')::int=4 and (:'fe_vob')::date = date '2030-06-15',
                 'O3: VOB defaults to 4 years -> 2030-06-15');
insert into gewaehrleistung(tenant_id,projekt_id,regime,start_datum)
  values (:'t1',:'p2','bgb', date '2026-06-15') returning frist_ende as fe_bgb \gset
select _t_assert((:'fe_bgb')::date = date '2031-06-15', 'O3: BGB defaults to 5 years -> 2031-06-15');
insert into gewaehrleistung(tenant_id,projekt_id,regime,start_datum,frist_jahre)
  values (:'t1',:'p3','vob', date '2026-06-15', 2) returning frist_ende as fe_ovr \gset
select _t_assert((:'fe_ovr')::date = date '2028-06-15', 'O3: an explicit term overrides the default');

-- ===========================================================================
\echo ''
\echo '### O4: arbeitszeit duration + freeze-on-approval'
-- ===========================================================================
insert into arbeitszeit(tenant_id,app_user_id,projekt_id,start_zeit,end_zeit,pause_minuten,art)
  values (:'t1',:'u1',:'p1', timestamptz '2026-06-01 08:00+00', timestamptz '2026-06-01 16:30+00', 30, 'arbeit')
  returning id as az1, dauer as az_dauer \gset
select set_config('test.az1', :'az1', false);
select _t_assert((select dauer from arbeitszeit where id=:'az1'::uuid) = interval '8 hours',
                 'O4: dauer derived from start/end minus break (8h)');

-- approval is allowed (entry not yet frozen) ...
update arbeitszeit set freigabe_status='freigegeben', freigegeben_am=now(), freigegeben_von=:'u1'
  where id=:'az1'::uuid;
-- ... after which the entry is frozen
do $$ declare ok boolean:=false; begin
  begin update arbeitszeit set art='ruest' where id=current_setting('test.az1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O4: an approved arbeitszeit accepted an edit'; end if;
  raise notice 'ok: O4: an approved (freigegeben) entry is frozen';
end $$;
-- a correction is a new, linked entry
insert into arbeitszeit(tenant_id,app_user_id,projekt_id,start_zeit,end_zeit,korrektur_von_id,art)
  values (:'t1',:'u1',:'p1', timestamptz '2026-06-01 08:00+00', timestamptz '2026-06-01 17:00+00', :'az1','arbeit')
  returning id as az_corr \gset
select _t_assert((select korrektur_von_id from arbeitszeit where id=:'az_corr'::uuid)=:'az1'::uuid,
                 'O4: a correction is a new entry linked to the frozen original');

-- ===========================================================================
\echo ''
\echo '### O5: Auftraggeber with open work cannot be soft-deleted'
-- ===========================================================================
select set_config('test.a1', :'a1', false);
do $$ declare ok boolean:=false; begin
  begin perform core.soft_delete('auftraggeber', current_setting('test.a1')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O5: Auftraggeber with open projects was soft-deleted'; end if;
  raise notice 'ok: O5: Auftraggeber with open work cannot be deleted';
end $$;
-- one with no work can be
select core.soft_delete('auftraggeber', :'a3'::uuid);
select _t_assert((select deleted_at is not null from auftraggeber where id=:'a3'::uuid),
                 'O5: an Auftraggeber with no open work can be soft-deleted');

-- ===========================================================================
\echo ''
\echo '### O6: bestellung lifecycle (generic linear guard)'
-- ===========================================================================
insert into lieferant(tenant_id,name) values (:'t1','Großhandel GmbH') returning id as l1 \gset
insert into bestellung(tenant_id,projekt_id,lieferant_id) values (:'t1',:'p1',:'l1') returning id as b1 \gset
select set_config('test.b1', :'b1', false);
update bestellung set status='bestellt' where id=:'b1'::uuid;          -- forward free
select _t_assert((select status from bestellung where id=:'b1'::uuid)='bestellt', 'O6: forward to bestellt');
do $$ declare ok boolean:=false; begin
  begin update bestellung set status='storniert' where id=current_setting('test.b1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O6: bestellung storniert without a reason was allowed'; end if;
  raise notice 'ok: O6: cancelling a bestellung requires a reason';
end $$;
select set_config('app.reason','Falsch bestellt',false);
update bestellung set status='storniert' where id=:'b1'::uuid;
select set_config('app.reason','',false);
do $$ declare ok boolean:=false; begin
  begin update bestellung set status='bestellt' where id=current_setting('test.b1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: O6: a terminal bestellung accepted a transition'; end if;
  raise notice 'ok: O6: storniert is terminal';
end $$;

-- ===========================================================================
\echo ''
\echo '### O7: directive-05 tables inherit tenant RLS + audit'
-- ===========================================================================
select set_config('app.tenant_id', :'t2', false);
select _t_assert((select count(*) from projekt where id=:'p1'::uuid)=0,
                 'O7: tenant T2 cannot see T1''s projekt (RLS inherited)');
select set_config('app.tenant_id', :'t1', false);
select _t_assert((select count(*) from audit_log where table_name='projekt' and row_id=:'p1'::uuid and op='I')=1,
                 'O7: projekt INSERT landed an audit row (audit inherited)');

-- ===========================================================================
\echo ''
\echo '### O8: tenant_setting accessor'
-- ===========================================================================
insert into tenant_setting(tenant_id,key,value) values (:'t1','time_tracking','false'::jsonb);
select _t_assert(core.setting_bool('time_tracking', true) = false,
                 'O8: setting_bool reads a stored toggle');
select _t_assert(core.setting_bool('mileage_tracking', false) = false,
                 'O8: setting_bool falls back to the default when unset');

reset role;
\echo ''
\echo '==================================================='
\echo '  ALL OPERATIONAL (05) GUARANTEES PASSED'
\echo '==================================================='
