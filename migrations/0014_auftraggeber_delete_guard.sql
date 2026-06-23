-- 0014_auftraggeber_delete_guard.sql
-- "An Auftraggeber with open projects or unsettled invoices cannot be
-- soft-deleted; the action is blocked and explained, not silently dropped."
-- (directive 05, Auftraggeber and Kontakt.) Installed here because it references
-- projekt (0009) and rechnung (0006).

create or replace function core.auftraggeber_block_delete_with_deps() returns trigger
  language plpgsql as $$
declare
  v_open_projekte int;
  v_offene_rechnungen int;
begin
  -- Only fire on the soft-delete transition (deleted_at NULL -> set).
  if not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;

  select count(*) into v_open_projekte
    from projekt
   where auftraggeber_id = old.id
     and deleted_at is null
     and status not in ('abgeschlossen','storniert');

  -- "Unsettled" here = an invoice that is not cancelled/superseded. Payment
  -- state is not modelled yet; revisit when it is (see schema note).
  select count(*) into v_offene_rechnungen
    from rechnung
   where auftraggeber_id = old.id
     and deleted_at is null
     and status in ('draft','issued');

  if v_open_projekte > 0 or v_offene_rechnungen > 0 then
    raise exception
      'Auftraggeber % cannot be deleted: % open project(s) and % unsettled invoice(s) exist',
      old.id, v_open_projekte, v_offene_rechnungen
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;

create trigger bbb_block_delete_with_deps before update on auftraggeber
  for each row execute function core.auftraggeber_block_delete_with_deps();
