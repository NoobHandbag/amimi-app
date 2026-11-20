-- 0202: v_stock_drift esclude i codici di non_product_codici (GIFT_CARD e simili).
--
-- Perche': la gift card ha le varianti non tracciate su Shopify (tracked = false), quindi la quantita' scende sotto
-- zero a ogni vendita senza bloccare l'acquisto. shopify-stock la legge comunque in shopify_stock (GIFT_CARD, -4 al
-- 20-11) e v_stock_drift la mostrava come "hold_serve_conta" con delta 4: un segnale falso, una gift card non si conta.
-- Tutti gli altri controlli (ce-guard, v_health, stock fermo, watchdog) escludono gia' non_product_codici: questa
-- vista era l'unica rimasta. Misurato il 20-11 prima dell'apply: 259 righe, una sola esclusa (GIFT_CARD).
--
-- Un codice non-prodotto resta visibile se su Shopify ha quantita' sopra zero (Gate 2 del 20-11): un codice ritirato come
-- LEA_BAG_DARK_ZEBRA (migr 0052) che tornasse vendibile sul sito deve continuare a uscire come da_abbassare.
--
-- Cosa NON cambia: colonne, tipi, grant, shopify_stock, shopify-stock (nessuna scrittura di stock, Regola Ferrea 15).
-- Rollback: rieseguire la definizione della 0034 (stessa select senza il WHERE finale).

begin;

do $$
begin
  if not exists (select 1 from public.non_product_codici where codice = 'GIFT_CARD') then
    raise exception '0202: GIFT_CARD non e'' in non_product_codici';
  end if;
end $$;

create or replace view public.v_stock_drift as
with buf as (
  select coalesce((select value::int from app_flags where key = 'shopify_expose_buffer'), 2) as b
), fresh as (
  select distinct codice from counts where data_conta >= current_date - 30
)
select ss.codice,
       ss.shopify_title,
       ss.shopify_qty,
       greatest(0, coalesce(vi.disponibili_da_vendere, 0))::int as disponibili,
       (f.codice is not null) as conta_fresca,
       case when f.codice is not null then greatest(0, coalesce(vi.disponibili_da_vendere, 0))
            else greatest(0, coalesce(vi.disponibili_da_vendere, 0) - (select b from buf)) end::int as target_policy,
       (case when f.codice is not null then greatest(0, coalesce(vi.disponibili_da_vendere, 0))
             else greatest(0, coalesce(vi.disponibili_da_vendere, 0) - (select b from buf)) end
        - coalesce(ss.shopify_qty, 0))::int as delta,
       case
         when (case when f.codice is not null then greatest(0, coalesce(vi.disponibili_da_vendere, 0))
                    else greatest(0, coalesce(vi.disponibili_da_vendere, 0) - (select b from buf)) end) = coalesce(ss.shopify_qty, 0)
           then 'ok'
         when (case when f.codice is not null then greatest(0, coalesce(vi.disponibili_da_vendere, 0))
                    else greatest(0, coalesce(vi.disponibili_da_vendere, 0) - (select b from buf)) end) < coalesce(ss.shopify_qty, 0)
           then 'da_abbassare'
         when f.codice is not null then 'da_alzare'
         else 'hold_serve_conta'
       end as azione,
       ss.synced_at
from shopify_stock ss
left join v_inventory vi on vi.codice = ss.codice
left join fresh f on f.codice = ss.codice
where not exists (
  select 1 from non_product_codici n
  where upper(regexp_replace(n.codice, '\s+', '_', 'g')) = upper(regexp_replace(ss.codice, '\s+', '_', 'g'))
) or coalesce(ss.shopify_qty, 0) > 0;

do $$
declare
  n_gift int;
begin
  select count(*) into n_gift from public.v_stock_drift where upper(codice) = 'GIFT_CARD';
  if n_gift <> 0 then
    raise exception '0202: GIFT_CARD ancora in v_stock_drift (% righe)', n_gift;
  end if;
end $$;

commit;
