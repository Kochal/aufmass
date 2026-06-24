-- aufmass_test.sql
-- Proves the DB-enforceable slice of directive 07 (Aufmaß capture) on top of the
-- foundation. The reconciliation engine (formula-as-checksum, candidate search,
-- magnitude bands, geometric cross-checks) is application-layer (02: "No money
-- math in the database" — and no measurement math either); this suite exercises
-- what the DB owns: capture-mode integrity, the standalone/nullable billing link,
-- the lockable aggregate, audited corrections, concurrency, soft-delete, and the
-- prüfbarkeit floor that refuses to commit an untraceable measured number.
--
--   AF1  aufmass + aufmass_entry inherit tenant RLS + audit
--   AF2  capture modes: foto/voice need an archived original, manual must not
--   AF3  standalone Aufmaß: entry may have a null lv_position link, set later;
--        a foreign tenant's lv_position is invisible (cannot be linked)
--   AF4  aufmass is a lockable aggregate (edit_lock resource_type 'aufmass')
--   AF5  a reviewer's correction to an entry is captured in audit_log
--   AF6  optimistic concurrency: a stale row_version write affects 0 rows
--   AF7  no hard delete on aufmass/aufmass_entry; soft delete works
--   AF8  prüfbarkeit: a confirmed, billing-linked measurement needs a result and
--        (for foto/voice) a source crop; manual is its own trace

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
insert into app_user(tenant_id,email) values (:'t1','u1@eins.de')  returning id as u1  \gset
insert into app_user(tenant_id,email) values (:'t1','u1b@eins.de') returning id as u1b \gset
insert into app_user(tenant_id,email) values (:'t2','u2@zwei.de')  returning id as u2  \gset
insert into auftraggeber(tenant_id,name) values (:'t1','Kunde A1') returning id as a1 \gset
insert into auftraggeber(tenant_id,name) values (:'t2','Kunde A2') returning id as a2 \gset
insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless)
  values (:'t1','projekt','P-{YYYY}-{SEQ:4}','none',0,0,false);
insert into nummernkreis(tenant_id,doc_type,format,reset_policy,counter,start_offset,gapless)
  values (:'t2','projekt','P-{YYYY}-{SEQ:4}','none',0,0,false);

-- ---- a foreign tenant's LV position, for the cross-tenant invisibility check ----
set role app_role;
select set_config('app.tenant_id', :'t2', false);
select set_config('app.user_id',   :'u2', false);
insert into lv(tenant_id,source) values (:'t2','manual') returning id as lv2 \gset
insert into lv_position(tenant_id,lv_id,oz,menge,einheit) values (:'t2',:'lv2','1.1',5.000,'m2')
  returning id as pos_t2 \gset
select set_config('test.pos_t2', :'pos_t2', false);

-- ---- back to tenant T1 for the rest ----
select set_config('app.tenant_id', :'t1', false);
select set_config('app.user_id',   :'u1', false);
insert into projekt(tenant_id,auftraggeber_id,name) values (:'t1',:'a1','Aufmass Baustelle')
  returning id as p1 \gset
insert into document(tenant_id,kind,retention_class) values (:'t1','aufmass_foto',10)
  returning id as doc_foto \gset
insert into document(tenant_id,kind,retention_class) values (:'t1','aufmass_audio',10)
  returning id as doc_voice \gset
insert into lv(tenant_id,source) values (:'t1','manual') returning id as lv1 \gset
insert into lv_position(tenant_id,lv_id,oz,menge,einheit) values (:'t1',:'lv1','1.1',10.000,'m2')
  returning id as pos1 \gset
select set_config('test.pos1', :'pos1', false);
select set_config('test.p1',   :'p1',   false);
select set_config('test.doc_foto', :'doc_foto', false);

-- ===========================================================================
\echo ''
\echo '### AF1: aufmass + aufmass_entry inherit tenant RLS + audit'
-- ===========================================================================
insert into aufmass(tenant_id,projekt_id,erfasst_von,quelle,source_document_id)
  values (:'t1',:'p1',:'u1','foto',:'doc_foto') returning id as af1 \gset
select set_config('test.af1', :'af1', false);
insert into aufmass_entry(tenant_id,aufmass_id,bauteil,expression,written_result,einheit,source_crop_ref)
  values (:'t1',:'af1','Wand Nord',
          '{"op":"*","operands":[3.86,3.02]}'::jsonb, 11.657,'m2','{"x":120,"y":40,"w":210,"h":60}'::jsonb)
  returning id as e1 \gset
select set_config('test.e1', :'e1', false);

select set_config('app.tenant_id', :'t2', false);
select _t_assert((select count(*) from aufmass where id=:'af1'::uuid)=0,
                 'AF1: tenant T2 cannot see T1''s aufmass (RLS inherited)');
select set_config('app.tenant_id', :'t1', false);
select _t_assert((select count(*) from audit_log where table_name='aufmass' and row_id=:'af1'::uuid and op='I')=1,
                 'AF1: aufmass INSERT landed an audit row');
select _t_assert((select count(*) from audit_log where table_name='aufmass_entry' and row_id=:'e1'::uuid and op='I')=1,
                 'AF1: aufmass_entry INSERT landed an audit row');

-- ===========================================================================
\echo ''
\echo '### AF2: capture modes - original required for foto/voice, forbidden for manual'
-- ===========================================================================
do $$ declare ok boolean:=false; begin
  begin insert into aufmass(tenant_id,projekt_id,quelle)
        values (current_setting('app.tenant_id')::uuid, current_setting('test.p1')::uuid, 'foto');
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF2: a foto aufmass without an archived original was accepted'; end if;
  raise notice 'ok: AF2: foto capture requires an archived original';
end $$;

do $$ declare ok boolean:=false; begin
  begin insert into aufmass(tenant_id,projekt_id,quelle,source_document_id)
        values (current_setting('app.tenant_id')::uuid, current_setting('test.p1')::uuid,
                'manual', current_setting('test.doc_foto')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF2: a manual aufmass with a source document was accepted'; end if;
  raise notice 'ok: AF2: manual capture must not carry an original';
end $$;

-- the three valid shapes
insert into aufmass(tenant_id,projekt_id,quelle,source_document_id) values (:'t1',:'p1','voice',:'doc_voice')
  returning id as af_voice \gset
insert into aufmass(tenant_id,projekt_id,quelle) values (:'t1',:'p1','manual')
  returning id as af_manual \gset
select set_config('test.af_manual', :'af_manual', false);
select _t_assert(:'af_voice' is not null and :'af_manual' is not null,
                 'AF2: foto+doc, voice+doc, and manual (no doc) are all accepted');

-- ===========================================================================
\echo ''
\echo '### AF3: standalone Aufmaß (nullable link, set later) + cross-tenant invisibility'
-- ===========================================================================
-- an entry with no LV position at all (a job with no tender yet)
insert into aufmass_entry(tenant_id,aufmass_id,written_result,einheit,source_crop_ref)
  values (:'t1',:'af1',7.500,'m2','{"x":10,"y":10,"w":50,"h":20}'::jsonb)
  returning id as e_standalone \gset
select _t_assert((select lv_position_id from aufmass_entry where id=:'e_standalone'::uuid) is null,
                 'AF3: a standalone entry may carry a null lv_position link');
-- later, when a quote exists, it can be linked to a same-tenant position
update aufmass_entry set lv_position_id=:'pos1' where id=:'e_standalone'::uuid;
select _t_assert((select lv_position_id from aufmass_entry where id=:'e_standalone'::uuid)=:'pos1'::uuid,
                 'AF3: the link can be set once a quote is built');
-- a foreign tenant's LV position is invisible under RLS, so it can never be linked
select _t_assert((select count(*) from lv_position where id=:'pos_t2'::uuid)=0,
                 'AF3: T1 cannot see T2''s lv_position (cross-tenant link impossible by construction)');

-- ===========================================================================
\echo ''
\echo '### AF4: aufmass is a lockable aggregate (edit_lock resource_type ''aufmass'')'
-- ===========================================================================
select set_config('test.u1b', :'u1b', false);
select _t_assert(owner_user_id = :'u1'::uuid, 'AF4: U1 acquires a free lease on the aufmass sheet')
  from core.acquire_edit_lock('aufmass', :'af1'::uuid, :'u1'::uuid);
do $$ declare ok boolean:=false; begin
  begin perform core.acquire_edit_lock('aufmass', current_setting('test.af1')::uuid,
                                       current_setting('test.u1b')::uuid);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF4: a held aufmass lease did not block a second editor'; end if;
  raise notice 'ok: AF4: a live lease blocks a second editor';
end $$;
select core.release_edit_lock('aufmass', :'af1'::uuid, :'u1'::uuid);
select _t_assert(owner_user_id = :'u1b'::uuid, 'AF4: after release U1b can acquire the sheet')
  from core.acquire_edit_lock('aufmass', :'af1'::uuid, :'u1b'::uuid);
select core.release_edit_lock('aufmass', :'af1'::uuid, :'u1b'::uuid);

-- ===========================================================================
\echo ''
\echo '### AF5: a reviewer correction is captured in audit_log'
-- ===========================================================================
insert into aufmass_entry(tenant_id,aufmass_id,bauteil,written_result,einheit,source_crop_ref,confidence)
  values (:'t1',:'af1','Wand Ost',386.000,'m2','{"x":300,"y":40,"w":120,"h":60}'::jsonb,0.55)
  returning id as e_fix \gset
select set_config('test.e_fix', :'e_fix', false);
-- the reviewer fixes a comma misread (386 -> 3,86) and confirms the correction
update aufmass_entry set computed_result=3.860, reconciled=true, review_status='corrected'
  where id=:'e_fix'::uuid;
select _t_assert((select count(*) from audit_log
                   where table_name='aufmass_entry' and row_id=:'e_fix'::uuid and op='U')=1,
                 'AF5: the correction landed exactly one audit U row');
select _t_assert((select (new_row->>'review_status') from audit_log
                   where table_name='aufmass_entry' and row_id=:'e_fix'::uuid and op='U' limit 1)='corrected'
              and (select (new_row->>'computed_result') from audit_log
                   where table_name='aufmass_entry' and row_id=:'e_fix'::uuid and op='U' limit 1)='3.860',
                 'AF5: the audit row records the corrected value and status');

-- ===========================================================================
\echo ''
\echo '### AF6: optimistic concurrency on an entry (stale write affects 0 rows)'
-- ===========================================================================
insert into aufmass_entry(tenant_id,aufmass_id,written_result,einheit)
  values (:'t1',:'af1',2.400,'m')
  returning id as e_occ, row_version as rv0 \gset
update aufmass_entry set bauteil='Sturz' where id=:'e_occ'::uuid and row_version=(:rv0)::int;
select _t_assert((select row_version from aufmass_entry where id=:'e_occ'::uuid)=(:rv0)::int+1,
                 'AF6: a successful update increments row_version');
with stale as (
  update aufmass_entry set bauteil='conflict' where id=:'e_occ'::uuid and row_version=(:rv0)::int
  returning 1
) select count(*) as affected from stale \gset
select _t_assert((:affected)::int=0,
                 'AF6: an update against a stale row_version affects 0 rows (conflict)');

-- ===========================================================================
\echo ''
\echo '### AF7: no hard delete; soft delete works'
-- ===========================================================================
do $$ declare ok boolean:=false; begin
  begin delete from aufmass_entry where id=current_setting('test.e1')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF7: hard DELETE on aufmass_entry was not refused'; end if;
  raise notice 'ok: AF7: hard DELETE on aufmass_entry is refused';
end $$;
select core.soft_delete('aufmass_entry', :'e1'::uuid);
select _t_assert((select deleted_at is not null from aufmass_entry where id=:'e1'::uuid),
                 'AF7: soft delete sets deleted_at on the entry');
select core.soft_delete('aufmass', :'af_manual'::uuid);
select _t_assert((select deleted_at is not null from aufmass where id=:'af_manual'::uuid),
                 'AF7: soft delete sets deleted_at on the sheet');

-- ===========================================================================
\echo ''
\echo '### AF8: prüfbarkeit floor on confirm'
-- ===========================================================================
-- (a) confirm a foto-sourced, billing-linked entry with NO crop -> rejected
insert into aufmass_entry(tenant_id,aufmass_id,written_result,einheit,lv_position_id)
  values (:'t1',:'af1',9.000,'m2',:'pos1') returning id as e_nocrop \gset
select set_config('test.e_nocrop', :'e_nocrop', false);
do $$ declare ok boolean:=false; begin
  begin update aufmass_entry set review_status='confirmed' where id=current_setting('test.e_nocrop')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF8: a foto entry was confirmed with no source crop'; end if;
  raise notice 'ok: AF8: a confirmed foto measurement must reference its source crop';
end $$;

-- (b) confirm with a crop but NO result -> rejected
insert into aufmass_entry(tenant_id,aufmass_id,einheit,source_crop_ref,lv_position_id)
  values (:'t1',:'af1','m2','{"x":1,"y":1,"w":9,"h":9}'::jsonb,:'pos1') returning id as e_noresult \gset
select set_config('test.e_noresult', :'e_noresult', false);
do $$ declare ok boolean:=false; begin
  begin update aufmass_entry set review_status='confirmed' where id=current_setting('test.e_noresult')::uuid;
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERTION FAILED: AF8: an entry with no result was confirmed'; end if;
  raise notice 'ok: AF8: a confirmed measurement must carry a result';
end $$;

-- (c) crop + result + confirmed -> allowed
update aufmass_entry set source_crop_ref='{"x":1,"y":1,"w":9,"h":9}'::jsonb, written_result=9.000,
                         review_status='confirmed'
  where id=:'e_nocrop'::uuid;
select _t_assert((select review_status from aufmass_entry where id=:'e_nocrop'::uuid)='confirmed',
                 'AF8: a foto measurement with a crop and a result confirms');

-- (d) a MANUAL entry is its own trace: confirm with a result but no crop -> allowed
insert into aufmass(tenant_id,projekt_id,quelle) values (:'t1',:'p1','manual') returning id as af_m2 \gset
insert into aufmass_entry(tenant_id,aufmass_id,written_result,einheit,lv_position_id,review_status)
  values (:'t1',:'af_m2',4.250,'lfm',:'pos1','confirmed') returning id as e_manual \gset
select _t_assert((select review_status from aufmass_entry where id=:'e_manual'::uuid)='confirmed',
                 'AF8: a manual entry confirms with a result and no crop (manual is its own trace)');

reset role;
\echo ''
\echo '==================================================='
\echo '  ALL AUFMASS (07) DB GUARANTEES PASSED'
\echo '==================================================='
