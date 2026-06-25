-- NEW FEATURE: Returns & Exchanges (#1 gap from the chats — offline returns were invisible).
create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  year int, month int,
  codice text not null,
  codice_norm text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  item text, variant text,
  quantita numeric not null default 1,
  canale text,                          -- online | qromo | b2b
  importo_rimborsato numeric default 0, -- money refunded (0 for a pure exchange)
  rientra_stock boolean not null default true,
  motivo text,                          -- difetto | taglia | ripensamento | cambio | altro
  sostituito_con text,                  -- replacement CODICE, for exchanges
  note text, source text, chi text,
  created_at timestamptz default now()
);
grant select on returns to anon, authenticated;

-- Stock: a returned unit that re-enters stock adds back to giacenza. resi_rientrati appended last
-- to preserve the existing column order (CREATE OR REPLACE can't reorder).
create or replace view v_inventory as
 with pur as (select codice_norm, sum(quantita) q from purchases group by codice_norm),
      sho as (select codice_norm, sum(quantita) q from shopify_line_items group by codice_norm),
      qro as (select codice_norm, sum(quantita) q from qromo_sales group by codice_norm),
      gif as (select codice_norm, sum(quantita) q from gifts_offline group by codice_norm),
      ret as (select codice_norm, sum(quantita) q from returns where rientra_stock = true group by codice_norm),
      b2v as (select codice_norm, sum(quantita) q from b2b_movements where tipo_movimento='venduto' group by codice_norm),
      b2cv as (select codice_norm, sum(case when tipo_movimento='invio' then quantita
                 when tipo_movimento = any(array['reso','venduto']) then -quantita else 0 end) q
               from b2b_movements where modello='conto_vendita' group by codice_norm),
      last_sale as (select s.codice_norm, max(s.d) d from (
                 select codice_norm, data::timestamptz d from qromo_sales where data is not null
                 union all select codice_norm, data::timestamptz from b2b_movements where tipo_movimento='venduto' and data is not null
                 union all select li.codice_norm, o.created_at_shop from shopify_line_items li join shopify_orders o on o.order_id=li.order_id where o.created_at_shop is not null
               ) s group by s.codice_norm)
 select p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs, p.image_url, p.status,
    coalesce(pur.q,0) as qty_purchased,
    coalesce(sho.q,0) as shopify_sold, coalesce(qro.q,0) as qromo_sold, coalesce(gif.q,0) as gift_sold,
    coalesce(b2v.q,0) as b2b_venduto, coalesce(b2cv.q,0) as in_conto_vendita,
    coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) as giacenza_attuale,
    coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) - coalesce(b2v.q,0) as giacenza_totale_conb2b,
    coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) - coalesce(b2v.q,0) - coalesce(b2cv.q,0) as disponibili_da_vendere,
    round((coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0)) * coalesce(p.retail_price,0), 2) as valore,
    ls.d as last_sale, sc.codice is not null as on_shopify,
    coalesce(ret.q,0) as resi_rientrati
   from products p
     left join pur on pur.codice_norm=p.codice_norm
     left join sho on sho.codice_norm=p.codice_norm
     left join qro on qro.codice_norm=p.codice_norm
     left join gif on gif.codice_norm=p.codice_norm
     left join ret on ret.codice_norm=p.codice_norm
     left join b2v on b2v.codice_norm=p.codice_norm
     left join b2cv on b2cv.codice_norm=p.codice_norm
     left join last_sale ls on ls.codice_norm=p.codice_norm
     left join shopify_catalog sc on sc.codice=p.codice;

-- Money: returns visible without touching the parity-validated CE.
create or replace view v_resi_mensile as
 select year, month, canale, count(*) n, sum(quantita) pezzi, sum(coalesce(importo_rimborsato,0)) importo
 from returns group by year, month, canale;
grant select on v_resi_mensile to anon, authenticated;
