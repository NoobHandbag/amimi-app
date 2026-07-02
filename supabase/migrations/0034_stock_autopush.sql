-- 0034: push automatico dello stock su Shopify (sostituisce il variant-sync Apps Script).
-- Policy replicata dal variant-sync V2: esporre disponibili-buffer (default 2); con conta fisica
-- fresca (<=30gg) esposizione piena; MAI rialzi automatici senza conta fresca (hold); ribassi sempre.
insert into app_flags (key, value) values ('shopify_autopush_enabled', 'false') on conflict (key) do nothing;
insert into app_flags (key, value) values ('shopify_expose_buffer', '2') on conflict (key) do nothing;

-- monitor "sta funzionando?": drift gestionale vs Shopify vs target di policy, per codice
create or replace view v_stock_drift as
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
left join fresh f on f.codice = ss.codice;

grant select on v_stock_drift to anon, authenticated;

-- cron orario :27 (dopo il read-sync :17); la funzione stessa e' gated da shopify_autopush_enabled
select cron.schedule('shopify-autopush-hourly', '27 * * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/shopify-stock',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"realign_all","pin":"x"}'::jsonb
     ) $$);
