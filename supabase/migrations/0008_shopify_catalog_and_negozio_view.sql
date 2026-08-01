-- 0008: catalogo Shopify (flag on_shopify) + vista del conto vendita per negozio.
--
-- RECUPERATA il 2026-08-01 dal DB di produzione (`supabase_migrations.schema_migrations.statements`).
-- Il file mancava dal repo: la storia delle migrazioni era incompleta e un rebuild da zero si
-- fermava alla 0013. Contenuto identico a quello applicato in produzione il 2026-06-24.

create table if not exists shopify_catalog (
  codice text primary key,
  handle text,
  on_shopify boolean not null default true
);

create or replace view v_conto_vendita_negozio as
with cv as (
  select negozio, codice_norm,
    sum(case when tipo_movimento='invio' then quantita
             when tipo_movimento in ('reso','venduto') then -quantita else 0 end) as pezzi
  from b2b_movements
  where modello='conto_vendita' and negozio is not null
  group by negozio, codice_norm
)
select cv.negozio, p.codice, p.item, p.variant, p.image_url, cv.pezzi
from cv join products p on p.codice_norm = cv.codice_norm
where cv.pezzi > 0;
