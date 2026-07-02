-- 0033: EVENTI e' una categoria legittima (il CE la somma gia' come voce fissa dedicata);
-- allineo la colonna generata categoria_valid.
alter table expenses drop column categoria_valid;
alter table expenses add column categoria_valid boolean generated always as
  (categoria = any (array['COGS','LOGISTICA','MARKETING','OPEX','PACKAGING','SALARI','TASSE','EVENTI'])) stored;
