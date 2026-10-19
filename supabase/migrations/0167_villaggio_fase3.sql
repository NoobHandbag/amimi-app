-- 0167_villaggio_fase3.sql (2026-10-18): Villaggio fase 3, la parte di database. Nessuna tabella nuova, nessuna scrittura
-- di dati: due viste in sola lettura.
-- (1) v_tempi_laboratori: il tempo abituale di ogni laboratorio, per il SUGGERIMENTO del modulo d'ordine ("di solito
--     Francesco consegna in circa 30 giorni"). Solo un suggerimento: la data di consegna non si precompila mai.
-- (2) v_villaggio_eventi ricreata. La verifica vale per le righe che ha SISTEMATO (data aggiunta, data cambiata o riga
--     chiusa con write-api v30), non per quelle solo confermate: verificare ogni settimana gli stessi laboratori fermi valeva
--     quasi il doppio di ordini e arrivi veri (ricerca del 18-10). Una riga nata con la data di consegna gia' nell'ordine vale
--     come una data aggiunta. Il resto della vista e' quello della 0164, riga per riga.
begin;

-- Giorni fra data_ordine e PRIMO arrivo (il primo aumento registrato in change_log da arrival o arrival_set), solo sulle
-- righe scritte prima che la merce arrivasse (giorno del primo arrivo dopo il giorno di creazione): un ordine scritto con le
-- borse gia' sul tavolo (27 righe su 68 il 18-10) direbbe 0 giorni e non insegna niente sul laboratorio. Ultimi 365 giorni di
-- data_ordine, solo laboratori con almeno 3 righe: con meno righe la mediana e' un caso. Un primo arrivo prima di
-- data_ordine e' una data scritta male e resta fuori. I case tengono il cast fuori dai valori non numerici, come nella 0164.
create or replace view v_tempi_laboratori as
with primo as (
  select c.row_id, min(c.ts) as ts
  from change_log c
  where c.tbl = 'supplier_orders' and c.op in ('arrival', 'arrival_set')
    and coalesce(case when jsonb_typeof(c.after -> 'delta') = 'number' then (c.after -> 'delta')::numeric end,
                 case when jsonb_typeof(c.after -> 'qty') = 'number' then (c.after -> 'qty')::numeric end, 0) > 0
  group by c.row_id
),
righe as (
  select so.fornitore, (p.ts at time zone 'Europe/Rome')::date - so.data_ordine as giorni
  from supplier_orders so
  join primo p on p.row_id = so.id::text
  where so.fornitore is not null and so.data_ordine is not null
    and so.data_ordine >= (now() at time zone 'Europe/Rome')::date - 365
    and (p.ts at time zone 'Europe/Rome')::date > (so.created_at at time zone 'Europe/Rome')::date
    and (p.ts at time zone 'Europe/Rome')::date >= so.data_ordine
)
select fornitore,
       round(percentile_cont(0.5) within group (order by giorni)::numeric)::int as giorni_mediani,
       count(*)::int as righe
from righe
group by fornitore
having count(*) >= 3;

-- Owner postgres e senza security_invoker, come nella 0164. Cambiano solo il ramo 'verifica' (n) e il ramo 'data_aggiunta'
-- in piu' da supplier_orders; colonne, filtri e gli altri rami sono quelli della 0164.
create or replace view v_villaggio_eventi as
with cfg as (
  select
    coalesce(max(value) filter (where key = 'villaggio_paillettes_enabled') = 'true', false) as acceso,
    max(value) filter (where key = 'villaggio_paillettes_chi') as chi,
    max(case when key = 'villaggio_paillettes_dal' and value ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(value, 'date')
             then value::date end)::timestamp at time zone 'Europe/Rome' as dal
  from app_flags
  where key in ('villaggio_paillettes_enabled', 'villaggio_paillettes_chi', 'villaggio_paillettes_dal')
),
ev as (
  select 'presenza'::text as tipo, p.giorno, p.ts, p.giorno::text as ref, 1 as n, p.chi
  from vil_presenze p
  union all
  -- n = righe del gruppo che esistono ANCORA: un ordine tutto cancellato vale 0, una riga cancellata non conta piu'
  select 'ordine', (c.ts at time zone 'Europe/Rome')::date, c.ts, c.row_id,
         (select count(*)::int from supplier_orders so where so.gruppo::text = c.row_id), c.chi
  from change_log c
  where c.op = 'order_multi' and c.source = 'write-api'
  union all
  -- solo gli aumenti: una correzione al ribasso non e' un arrivo. Il case tiene il cast fuori dalle righe non numeriche.
  -- Un arrivo annullato non vale: la riga ordine deve esistere ancora e avere qualcosa di arrivato.
  select 'arrivo', (c.ts at time zone 'Europe/Rome')::date, c.ts, c.row_id, (c.after -> 'delta')::numeric::int, c.chi
  from change_log c
  where c.op = 'arrival_set' and c.source = 'write-api'
    and (case when jsonb_typeof(c.after -> 'delta') = 'number' then (c.after -> 'delta')::numeric end) > 0
    and exists (select 1 from supplier_orders so where so.id::text = c.row_id and so.qty_arrived > 0)
  union all
  -- giorno dal ts, non da data_conta: data_conta la sceglie il chiamante e una conta retrodatata non e' di quel giorno
  select 'conta', (k.ts at time zone 'Europe/Rome')::date, k.ts, k.codice, 1, k.chi
  from counts k
  union all
  -- n = righe SISTEMATE: chiusa (write-api v30), oppure con una data dopo la verifica diversa da quella di prima (aggiunta o
  -- cambiata). Confermare soltanto vale 0, e il client non da' punti a una verifica con n = 0.
  select 'verifica', s.giorno, s.ts, s.fornitore,
         (select count(*)::int from jsonb_array_elements(s.righe) e
          where e -> 'chiusa' = 'true'::jsonb
             or ((e ->> 'data_dopo') is not null and (e ->> 'data_dopo') is distinct from (e ->> 'data_prima'))), s.chi
  from vil_verifiche s
  union all
  select 'data_aggiunta', s.giorno, s.ts, e ->> 'id', 1, s.chi
  from vil_verifiche s
  cross join lateral jsonb_array_elements(s.righe) e
  where e ->> 'data_prima' is null and e ->> 'data_dopo' is not null
  union all
  -- una riga nata con la data di consegna gia' nell'ordine vale come una data aggiunta, con lo stesso ref (id riga) di quella
  -- della verifica: il client la conta una volta sola. Non vale una data arrivata DOPO la nascita, da una verifica (che ha il
  -- suo evento, nel giorno della verifica) o da order_update (una modifica non da' punti): lo dice il change_log, con la data
  -- di prima a null nel before. Giorno e ts sono quelli della nascita della riga.
  select 'data_aggiunta', (so.created_at at time zone 'Europe/Rome')::date, so.created_at, so.id::text, 1, so.chi
  from supplier_orders so
  where so.data_consegna is not null
    and not exists (select 1 from change_log c
                    where c.tbl = 'supplier_orders' and c.row_id = so.id::text and c.op in ('order_date', 'order_update')
                      and c.before -> 'data_consegna' = 'null'::jsonb)
  union all
  select 'conta_completa', (x.ts at time zone 'Europe/Rome')::date, x.ts, x.mese, x.codici, x.chi
  from vil_conte_complete x
)
select ev.tipo, ev.giorno, ev.ts, ev.ref, ev.n
from ev
cross join cfg
where cfg.acceso and ev.chi = cfg.chi and ev.ts >= cfg.dal;

alter view v_villaggio_eventi owner to postgres;
alter view v_tempi_laboratori owner to postgres;
revoke all on v_villaggio_eventi, v_tempi_laboratori from public, anon, authenticated;
grant select on v_villaggio_eventi, v_tempi_laboratori to anon, authenticated;

commit;

-- Rollback: drop view v_tempi_laboratori; (il modulo d'ordine nasconde il suggerimento) e v_villaggio_eventi rimessa col
-- testo della 0164 (create or replace). Le righe chiuse da write-api v30 restano chiuse: sono dati, col loro change_log.
