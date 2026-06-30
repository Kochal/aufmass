-- 0026 – lv_position: persist the raw arithmetic formula behind a Menge entry
-- When a user types an expression such as "2 * (8+9) / 3" in the position editor,
-- the resolved numeric result goes into menge (unchanged contract) and the original
-- expression is stored here for traceability (CLAUDE.md non-negotiable #6).
-- The pricing engine reads menge only; this column is display/audit only.

alter table lv_position
  add column if not exists menge_formel text;
