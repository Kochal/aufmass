-- quotation_test.sql
-- Proves the DB-enforceable slice of directive 06 (quotation/billing) on top of
-- the foundation. The deterministic *arithmetic* engine is application-layer (02:
-- "No money math in the database"); this suite exercises what the DB owns:
-- provenance, the issue gate, tax snapshot, freeze, versioning, numbering.
--
--   Q1  angebot is a financial doc: number allocated at issue; issued -> frozen
--   Q2  issue gate: an unpriced / in-review position blocks issue
--   Q3  issue gate: an unresolved hard check failure blocks issue
--   Q4  tax treatment is snapshotted at issue and survives a later profile change
--   Q5  versioning: new_angebot_version chains the document group, supersedes prior
--   Q6  provenance: lv_position match links; rechnung_position traceability
--   Q7  new 06 tables inherit tenant RLS + audit
--   Q8  rechnung billing path: gate + tax snapshot + e-invoice fields stored

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
insert into auftraggeber(tenant_id,name) values (:'t1','Kunde A1') returning id as a1 \gset

insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless)
  values (:'t1','angebot','AN-{YYYY}-{SEQ:4}','none',0,0,false);
insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless,current_period)
  values (:'t1','rechnung','RE-{YYYY}-{SEQ:5}','yearly',0,0,true, to_char(now(),'YYYY'));

insert into tenant_tax_profile(tenant_id,ust_treatment,ust_satz,kleinunternehmer,turnover_band)
  values (:'t1','regelbesteuert',19.00,false,'gte_800k');

insert into leistungskatalog(tenant_id,name) values (:'t1','Standardkatalog') returning id as lk1 \gset
insert into leistung(tenant_id,leistungskatalog_id,code,kurztext,einheit,einheitspreis)
  values (:'t1',:'lk1','M001','Dispersion streichen','m2',12.50) returning id as le1 \gset

set role app_role;
select set_config('app.tenant_id', :'t1', false);
select set_config('app.user_id',   :'u1', false);

-- ===========================================================================
\echo ''
\echo '### Q1: angebot numbered at issue, then frozen'
-- ===========================================================================
insert into angebot(tenant_id,auftraggeber_id,summe_netto,summe_brutto)
  values (:'t1',:'a1',125.00,148.75) returning id as ang1 \gset
select set_config('test.ang1', :'ang1', false);
insert into lv(tenant_id,angebot_id,source) values (:'t1',:'ang1','manual') returning id as lv1 \gset
-- a priced, confirmed position (gesamtpreis = menge*einheitspreis, computed by
-- the engine and supplied here as a committed value)
insert into lv_position(tenant_id,lv_id,oz,menge,einheit,einheitspreis,gesamtpreis,
                        matched_leistung_id,match_confidence,match_status,source,pricing_rule)
  values (:'t1',:'lv1','1.1',10.000,'m2',12.50,125.00,:'le1',0.95,'confirmed','manual','katalogpreis');

select core.issue_angebot(:'ang1'::uuid) as ang1_num \gset
select _t_assert(:'ang1_num' like 'AN-%-0001', 'Q1: Angebotsnummer allocated at issue (AN-YYYY-0001)');
select _t_assert((select status from angebot where id=:'ang1'::uuid)='issued', 'Q1: angebot is issued');

do $$ declare ok boolean:=false; begin
  begin update angebot set summe_netto=999 where id=current_setting('test.ang1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: Q1: issued angebot accepted a content UPDATE'; end if;
  raise notice 'ok: Q1: issued angebot is frozen';
end $$;

-- ===========================================================================
\echo ''
\echo '### Q2: issue gate - unpriced / in-review position blocks issue'
-- ===========================================================================
insert into angebot(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as ang2 \gset
select set_config('test.ang2', :'ang2', false);
insert into lv(tenant_id,angebot_id,source) values (:'t1',:'ang2','pdf') returning id as lv2 \gset
-- unpriced + still in review
insert into lv_position(tenant_id,lv_id,oz,menge,einheit,match_status,source)
  values (:'t1',:'lv2','1.1',5.000,'m2','review','pdf') returning id as pos2 \gset
select set_config('test.pos2', :'pos2', false);

do $$ declare ok boolean:=false; begin
  begin perform core.issue_angebot(current_setting('test.ang2')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: Q2: angebot with an unpriced position was issued'; end if;
  raise notice 'ok: Q2: an unpriced / in-review position blocks issue';
end $$;

-- price and confirm it, then issue succeeds
update lv_position set einheitspreis=12.50, gesamtpreis=62.50, match_status='confirmed',
                       matched_leistung_id=:'le1' where id=:'pos2'::uuid;
select _t_assert(core.issue_angebot(:'ang2'::uuid) like 'AN-%', 'Q2: once priced+confirmed, issue succeeds');

-- ===========================================================================
\echo ''
\echo '### Q3: issue gate - an unresolved hard check failure blocks issue'
-- ===========================================================================
insert into angebot(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as ang3 \gset
select set_config('test.ang3', :'ang3', false);
insert into lv(tenant_id,angebot_id,source) values (:'t1',:'ang3','manual') returning id as lv3 \gset
insert into lv_position(tenant_id,lv_id,oz,menge,einheit,einheitspreis,gesamtpreis,match_status)
  values (:'t1',:'lv3','1.1',1.000,'psch',100.00,100.00,'confirmed');
insert into check_result(tenant_id,target_table,target_id,rule,severity,passed,detail)
  values (:'t1','angebot',:'ang3','arithmetic','hard',false,'{"expected":100,"got":90}'::jsonb)
  returning id as chk3 \gset

do $$ declare ok boolean:=false; begin
  begin perform core.issue_angebot(current_setting('test.ang3')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: Q3: angebot with a failing hard check was issued'; end if;
  raise notice 'ok: Q3: an unresolved hard check failure blocks issue';
end $$;

update check_result set resolved=true where id=:'chk3'::uuid;       -- reviewer cleared it
select _t_assert(core.issue_angebot(:'ang3'::uuid) like 'AN-%', 'Q3: once the hard check is resolved, issue succeeds');

-- ===========================================================================
\echo ''
\echo '### Q4: tax treatment snapshotted at issue, immune to later profile change'
-- ===========================================================================
select _t_assert((select steuer_behandlung from angebot where id=:'ang1'::uuid)='regelbesteuert'
              and (select ust_satz from angebot where id=:'ang1'::uuid)=19.00
              and (select kleinunternehmer from angebot where id=:'ang1'::uuid)=false,
                 'Q4: issue snapshotted the tax treatment onto the angebot');
-- change the profile afterwards
update tenant_tax_profile set ust_satz=7.00 where tenant_id=:'t1';
select _t_assert((select ust_satz from angebot where id=:'ang1'::uuid)=19.00,
                 'Q4: the issued angebot keeps its snapshot (19%), not the new 7%');
update tenant_tax_profile set ust_satz=19.00 where tenant_id=:'t1';   -- restore

-- ===========================================================================
\echo ''
\echo '### Q5: versioning chains the document group and supersedes the prior'
-- ===========================================================================
select core.new_angebot_version(:'ang1'::uuid) as ang1_v2 \gset
select _t_assert(
  (select document_group_id from angebot where id=:'ang1_v2'::uuid)
    = (select document_group_id from angebot where id=:'ang1'::uuid)
  and (select version_no from angebot where id=:'ang1_v2'::uuid) = 2
  and (select supersedes_id from angebot where id=:'ang1_v2'::uuid) = :'ang1'::uuid
  and (select status from angebot where id=:'ang1_v2'::uuid) = 'draft',
  'Q5: new version shares the group, increments version_no, points at the prior, is a draft');
select _t_assert((select status from angebot where id=:'ang1'::uuid)='superseded',
                 'Q5: the prior version is marked superseded');

-- ===========================================================================
\echo ''
\echo '### Q6: provenance links recorded'
-- ===========================================================================
select _t_assert((select matched_leistung_id from lv_position where lv_id=:'lv1'::uuid limit 1)=:'le1'::uuid,
                 'Q6: lv_position carries its matched Leistung');
insert into rechnung(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as rprov \gset
insert into rechnung_position(tenant_id,rechnung_id,bezeichnung,menge_tender,menge_aufmass,menge,
                             einheitspreis,gesamtpreis,vob_2_3_flag,lv_position_id,leistung_id)
  values (:'t1',:'rprov','Dispersion',10.000,11.500,11.500,12.50,143.75,true,
          (select id from lv_position where lv_id=:'lv1'::uuid limit 1), :'le1')
  returning id as rpos \gset
select _t_assert((select lv_position_id from rechnung_position where id=:'rpos'::uuid) is not null
              and (select vob_2_3_flag from rechnung_position where id=:'rpos'::uuid) = true,
                 'Q6: rechnung_position traces to its LV position and carries the VOB 2(3) flag');

-- ===========================================================================
\echo ''
\echo '### Q7: new 06 tables inherit tenant RLS + audit'
-- ===========================================================================
select set_config('app.tenant_id', :'t2', false);
select _t_assert((select count(*) from angebot where id=:'ang1'::uuid)=0,
                 'Q7: tenant T2 cannot see T1''s angebot (RLS inherited)');
select set_config('app.tenant_id', :'t1', false);
select _t_assert((select count(*) from audit_log where table_name='angebot' and row_id=:'ang1'::uuid and op='I')=1,
                 'Q7: angebot INSERT landed an audit row (audit inherited)');

-- ===========================================================================
\echo ''
\echo '### Q8: rechnung billing path - gate + tax snapshot'
-- ===========================================================================
-- a failing hard check (e.g. EN 16931 invalid) blocks issue
insert into rechnung(tenant_id,auftraggeber_id) values (:'t1',:'a1') returning id as rb \gset
select set_config('test.rb', :'rb', false);
insert into check_result(tenant_id,target_table,target_id,rule,severity,passed)
  values (:'t1','rechnung',:'rb','arithmetic','hard',false) returning id as chkr \gset
do $$ declare ok boolean:=false; begin
  begin perform core.issue_rechnung(current_setting('test.rb')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: Q8: rechnung with a failing hard check was issued'; end if;
  raise notice 'ok: Q8: rechnung issue is gated on hard checks too';
end $$;
update check_result set resolved=true where id=:'chkr'::uuid;
update rechnung set einvoice_format='xrechnung' where id=:'rb'::uuid;
select core.issue_rechnung(:'rb'::uuid) as rb_num \gset
select _t_assert(:'rb_num' like 'RE-%', 'Q8: rechnung issues once the check is resolved');
select _t_assert((select steuer_behandlung from rechnung where id=:'rb'::uuid)='regelbesteuert'
              and (select ust_satz from rechnung where id=:'rb'::uuid)=19.00,
                 'Q8: rechnung issue snapshotted the tax treatment');
select _t_assert((select einvoice_format from rechnung where id=:'rb'::uuid)='xrechnung',
                 'Q8: e-invoice format is stored on the rechnung');

reset role;
\echo ''
\echo '==================================================='
\echo '  ALL QUOTATION (06) DB GUARANTEES PASSED'
\echo '==================================================='
