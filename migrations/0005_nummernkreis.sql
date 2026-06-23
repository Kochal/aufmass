-- 0005_nummernkreis.sql
-- Per-tenant, per-document-type number allocation. Directive 02, "Number
-- allocation (Nummernkreise)".
--
-- Gapless types (Rechnung) must not show unexplained gaps, so a plain sequence
-- is unsuitable (it gaps on rollback). Instead the counter row is locked with
-- SELECT ... FOR UPDATE, incremented, and the number assigned inside the same
-- transaction that issues the document. A rolled-back issue restores the
-- counter and therefore burns no number.

create table nummernkreis (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id),
  doc_type       text not null
                   check (doc_type in ('rechnung','angebot','auftrag','projekt','auftraggeber')),
  format         text not null,            -- template, e.g. 'RE-{YYYY}-{SEQ:5}'
  reset_policy   text not null default 'none'
                   check (reset_policy in ('none','yearly','monthly')),
  counter        bigint  not null default 0,   -- last number used; seed = start_offset
  start_offset   bigint  not null default 0,   -- last number from prior software (carryover)
  gapless        boolean not null default false,
  current_period text,                          -- last period token; drives reset
  unique (tenant_id, doc_type)
);
select core.add_standard_columns('nummernkreis');
select core.register_business_table('nummernkreis');

-- Allocate the next number for the current tenant's scheme of p_doc_type.
-- Locks the counter row (serializes + ties the increment to this transaction),
-- applies the reset policy, advances the counter, and renders the format. The
-- counter UPDATE fires the audit trigger, so every allocation is audited.
--
-- Format tokens: {YYYY} {YY} {MM} {SEQ} {SEQ:n} (n = zero-pad width).
create or replace function core.allocate_number(p_doc_type text) returns text
  language plpgsql as $$
declare
  nk       nummernkreis%rowtype;
  v_tenant uuid := core.current_tenant();
  v_period text;
  v_seq    bigint;
  v_result text;
  v_width  int;
begin
  if v_tenant is null then
    raise exception 'allocate_number: app.tenant_id is not set';
  end if;

  select * into nk
    from nummernkreis
   where tenant_id = v_tenant and doc_type = p_doc_type
   for update;                              -- the gapless lock
  if not found then
    raise exception 'no nummernkreis configured for tenant % doc_type %', v_tenant, p_doc_type;
  end if;

  v_period := case nk.reset_policy
                when 'yearly'  then to_char(now(), 'YYYY')
                when 'monthly' then to_char(now(), 'YYYYMM')
                else null end;
  if nk.reset_policy <> 'none' and nk.current_period is distinct from v_period then
    nk.counter := 0;                        -- new period: restart the sequence
  end if;

  v_seq := nk.counter + 1;

  update nummernkreis
     set counter = v_seq, current_period = v_period
   where id = nk.id;

  v_result := nk.format;
  v_result := replace(v_result, '{YYYY}', to_char(now(), 'YYYY'));
  v_result := replace(v_result, '{YY}',   to_char(now(), 'YY'));
  v_result := replace(v_result, '{MM}',   to_char(now(), 'MM'));
  if v_result ~ '\{SEQ:\d+\}' then
    v_width  := (regexp_match(v_result, '\{SEQ:(\d+)\}'))[1]::int;
    v_result := regexp_replace(v_result, '\{SEQ:\d+\}', lpad(v_seq::text, v_width, '0'));
  end if;
  v_result := replace(v_result, '{SEQ}', v_seq::text);

  return v_result;
end $$;
