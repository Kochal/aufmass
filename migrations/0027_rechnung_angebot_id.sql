-- Link rechnung to its source angebot and support position import on creation.
-- Soft-delete semantics: a soft-deleted angebot still holds the reference for audit trail.
alter table rechnung
  add column if not exists angebot_id uuid references angebot(id);
