-- 0087 (brief sales_guard_alerts, A7): smart alerts DETERMINISTICI sulle vendite.
-- Soglie in tabella (mai hardcoded), tarate sul BACKTEST 90gg del 2026-08-01:
--   zero ordini 24h: 0/90 giorni chiusi (evento raro vero -> error, unico che fa push ntfy);
--   best seller fermo: soglia 6 pezzi nei 30gg precedenti = 1,17 accensioni/settimana (2=6,1;
--   3=4,0; 4=2,5: sopra il budget ~2/sett del brief); sconto anomalo: max osservato 32 usi/sett
--   (AMIMI10 welcome) -> soglia 50/7gg = 0 falsi allarmi nel backtest; low stock: giorni_stock<=14
--   E velocita' 60gg sopra mediana (oggi 19, riga AGGREGATA informativa, non 19 alert);
--   esaurito pubblicato: aggregato (oggi 28), info.
-- Flag sales_guard_enabled default FALSE: il cron e' NO-OP finche' l'owner non accende.

create table if not exists alert_rules (
  metrica text primary key,
  soglia numeric not null,
  finestra_giorni int not null,
  severity text not null check (severity in ('error','warn','info')),
  attivo boolean not null default true,
  note text
);
insert into alert_rules (metrica, soglia, finestra_giorni, severity, attivo, note) values
  ('sales_zero_ordini', 0, 1, 'error', true, 'ordini nelle ultime 24 ORE <= soglia: 0/90 nel backtest, di solito = checkout rotto. UNICO segnale che fa push ntfy (al cambio di stato).'),
  ('sales_best_seller_fermo', 6, 14, 'warn', true, 'codice con >= soglia pezzi venduti nei 30gg PRECEDENTI la finestra (giorni [-44,-15]), ZERO negli ultimi finestra_giorni, e disponibili > 0. Backtest: 1,17 accensioni/sett a soglia 6.'),
  ('sales_low_stock', 14, 60, 'warn', true, 'giorni_stock (v_reorder) <= soglia E venduto_60d sopra la MEDIANA dei codici che vendono. Riga aggregata informativa, mai push.'),
  ('sales_esaurito_pubblicato', 0, 0, 'info', true, 'conteggio aggregato di v_sku_availability stato pubblicato_esaurito: pagine che prendono traffico e non convertono.'),
  ('sales_sconto_anomalo', 50, 7, 'warn', true, 'usi di UN codice sconto negli ultimi finestra_giorni > soglia. Backtest: max 32/sett (AMIMI10 welcome), 0 falsi allarmi a 50.')
on conflict (metrica) do nothing;
grant select on alert_rules to anon, authenticated;

-- flag di modulo, default OFF (Regola Ferrea 19): il cron e' NO-OP finche' non lo accende l'owner
insert into app_flags (key, value) values ('sales_guard_enabled', 'false') on conflict (key) do nothing;

-- vista di ispezione a mano: le anomalie CORRENTI di S2/S3/S4/S5 (S1 e' istantaneo, lo calcola la edge)
create or replace view v_sales_anomalie as
with vend as (
  select upper(li.codice) as codice,
    sum(li.quantita) filter (where o.created_at_shop >= now() - interval '44 days' and o.created_at_shop < now() - interval '14 days') as prima_30gg,
    sum(li.quantita) filter (where o.created_at_shop >= now() - interval '14 days') as ultimi_14gg
  from shopify_line_items li join shopify_orders o on o.order_id = li.order_id
  where o.created_at_shop >= now() - interval '44 days' and li.codice is not null
  group by 1
),
med as (select percentile_cont(0.5) within group (order by venduto_60d) as m from v_reorder where venduto_60d > 0)
select 'best_seller_fermo'::text as tipo, v.codice,
  format('%s pezzi nei 30gg precedenti, 0 negli ultimi 14, disponibili %s', v.prima_30gg, i.disponibili_da_vendere) as dettaglio,
  v.prima_30gg::numeric as valore
from vend v
join v_inventory i on upper(i.codice) = v.codice
cross join (select soglia from alert_rules where metrica = 'sales_best_seller_fermo') r
where coalesce(v.prima_30gg, 0) >= r.soglia and coalesce(v.ultimi_14gg, 0) = 0 and i.disponibili_da_vendere > 0
union all
select 'low_stock', r2.codice,
  format('%s giorni di stock, venduto_60d %s (mediana %s)', r2.giorni_stock, r2.venduto_60d, round(med.m::numeric, 1)),
  r2.giorni_stock::numeric
from v_reorder r2, med
cross join (select soglia from alert_rules where metrica = 'sales_low_stock') rr
where r2.giorni_stock is not null and r2.giorni_stock <= rr.soglia and r2.venduto_60d > med.m
union all
select 'esaurito_pubblicato', codice, 'pubblicato su Shopify ma esaurito', 0
from v_sku_availability where stato = 'pubblicato_esaurito'
union all
select 'sconto_anomalo', s.cod,
  format('%s usi negli ultimi %s giorni (soglia %s)', s.usi, rs.finestra_giorni, rs.soglia), s.usi::numeric
from (
  select upper(trim(o.discount_codes)) as cod, count(*) as usi
  from shopify_orders o
  cross join (select finestra_giorni from alert_rules where metrica = 'sales_sconto_anomalo') f
  where o.created_at_shop >= now() - (f.finestra_giorni || ' days')::interval
    and o.discount_codes is not null and trim(o.discount_codes) <> ''
  group by 1, f.finestra_giorni
) s
cross join (select soglia, finestra_giorni from alert_rules where metrica = 'sales_sconto_anomalo') rs
where s.usi > rs.soglia;
grant select on v_sales_anomalie to anon, authenticated;

-- refresh_health_log (cron health-daily 06:00) cancellava TUTTE le chiavi non-ce_*: le sales_*
-- (scritte una volta al giorno dalla guardia) sarebbero sparite in silenzio alle 06:00, e la
-- chiave shipping_status (batch orario del sync spedizioni) avrebbe avuto un buco fino al giro
-- dopo. Stessa esclusione gia' riservata alle ce_* (verificato, non assunto: brief criterio 3).
create or replace function public.refresh_health_log()
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  delete from health_log where day = current_date and k not like 'ce\_%' and k not like 'sales\_%' and k <> 'shipping_status';
  insert into health_log (day, k, label, n, severity)
    select current_date, k, label, n, severity from v_health;
end; $function$;

-- cron giornaliero (07:45 Roma d'estate; NB ce-guard malgrado il nome gira ORARIO, qui NO: i
-- segnali sono a finestra lunga). A flag spento la edge risponde skipped (NO-OP).
select cron.schedule(
  'sales-guard-daily',
  '45 5 * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/sales-guard',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","pin":"x","source":"cron"}'::jsonb
     ) $$
);
