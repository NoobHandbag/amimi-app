-- The single write path adds chi (operator) to every insert; these two tables lacked the column,
-- which silently broke gift + B2B ingestion. Add it so the audit trail is uniform.
alter table gifts_offline add column if not exists chi text;
alter table b2b_movements add column if not exists chi text;
