-- 0055 — Alias per la riga orfana dell'ordine #1482 (Annie Bag Brown Silk personalizzata).
-- Contesto: l'ordine #1482 (13-07, Martina De Serio) e' stato venduto come CUSTOM ITEM Shopify
-- (product/variant/sku null, nome digitato a mano "Annie_Bag_Silk_Brown_Personalizzata"), quindi
-- il resolver dello shopify-sync non aveva nulla da agganciare: ricavo contato, COGS 0, stock non
-- scalato. La riga esistente e' gia' stata risolta via write-api (sale_correct -> ANNIE_BAG_BROWN,
-- COGS 16,50, giacenza -> 0, change_log 2026-07-21). Questo alias NON tocca quella riga: serve solo
-- a far risolvere automaticamente lo STESSO nome a un eventuale re-seed dell'ETL (il pull orario
-- salta gli ordini gia' presenti, ma un re-seed li reimporterebbe da zero e li ri-orfanerebbe).
-- shopify_name_norm e' GENERATA: non scriverla (Regola Ferrea 14). Idempotente: guardata da NOT EXISTS
-- sul norm. Stesso pattern dell'alias audit AGATA "- Senza Catena" (audit-2026-07-06).
with ins as (
  insert into product_aliases (shopify_name, codice, source)
  select 'Annie_Bag_Silk_Brown_Personalizzata', 'ANNIE_BAG_BROWN', 'audit-2026-07-21'
  where not exists (
    select 1 from product_aliases where shopify_name_norm = 'ANNIE_BAG_SILK_BROWN_PERSONALIZZATA'
  )
  returning id, shopify_name, shopify_name_norm, codice, source
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'product_aliases', id::text, 'alias_add', to_jsonb(ins), 'Claude-Code', 'migration-0055' from ins;
