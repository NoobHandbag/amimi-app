-- 0120_gifts_offline_cogs_backfill.sql (2026-09-14, audit gate blocco 1, finding A2; OK owner 14-09)
--
-- Le vendite manuali e i regali registrati dall'app (write-api azione 'gift', insert generico) entravano in
-- gifts_offline con cogs NULL: il client non lo manda e il server non lo cercava a catalogo. Le viste CE
-- sommano gifts_offline.cogs come TOTALE di riga (SCHEMA.md sez. 3), quindi 15 righe fra luglio e settembre
-- 2026 (tutte in mesi APERTI: ce_snapshots arriva a giugno) pesavano 0 EUR di costo. Dalla write-api v26 il
-- server scrive cogs = products.cogs * quantita; qui si riallineano le righe gia' scritte, con la before-image
-- in change_log (op cogs_backfill_0120) per ogni riga. La riga etl SVEVA_BAG_PURPLE (luglio, senza prodotto a
-- catalogo) NON viene toccata: non ha un costo da cui derivare.
--
-- Guardie: se i numeri non sono quelli verificati il 14-09 (15 righe app, somma 396,14, zero righe in mesi
-- chiusi, tutte con COGS > 0 a catalogo) la transazione si ferma senza scrivere nulla.

do $$
declare
  v_n int;
  v_closed int;
  v_nocogs int;
  v_sum numeric;
begin
  select count(*) into v_n from gifts_offline where cogs is null and source = 'app';
  if v_n <> 15 then
    raise exception 'attese 15 righe app senza cogs, trovate %: verifica prima di applicare', v_n;
  end if;

  select count(*) into v_closed
  from gifts_offline g
  where g.cogs is null and g.source = 'app'
    and exists (select 1 from ce_snapshots s where s.year = g.year and s.month = g.month);
  if v_closed <> 0 then
    raise exception 'Regola Ferrea 11: % righe cadono in mesi chiusi, decisione owner richiesta', v_closed;
  end if;

  select count(*) into v_nocogs
  from gifts_offline g
  left join products p on p.codice_norm = g.codice_norm
  where g.cogs is null and g.source = 'app' and coalesce(p.cogs, 0) <= 0;
  if v_nocogs <> 0 then
    raise exception '% righe senza COGS a catalogo: non derivabili', v_nocogs;
  end if;

  select round(sum(p.cogs * g.quantita), 2) into v_sum
  from gifts_offline g
  join products p on p.codice_norm = g.codice_norm
  where g.cogs is null and g.source = 'app';
  if abs(v_sum - 396.14) > 0.01 then
    raise exception 'somma attesa 396.14, calcolata %: i COGS a catalogo sono cambiati, ricontrolla', v_sum;
  end if;
end $$;

-- before-image per riga (ricostruibile a mano; il write-api usa lo stesso schema di change_log)
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'gifts_offline', g.id::text, 'cogs_backfill_0120',
       jsonb_build_object('cogs', null, 'quantita', g.quantita, 'codice', g.codice, 'year', g.year, 'month', g.month),
       jsonb_build_object('cogs', round(p.cogs * g.quantita, 2), 'cogs_unitario', p.cogs, 'cogs_da_catalogo', true,
                          'motivo', 'audit gate 2026-09-14 A2: gift/vendite manuali dall''app scritte con COGS NULL'),
       'claude-code', 'migration'
from gifts_offline g
join products p on p.codice_norm = g.codice_norm
where g.cogs is null and g.source = 'app';

update gifts_offline g
set cogs = round(p.cogs * g.quantita, 2)
from products p
where p.codice_norm = g.codice_norm and g.cogs is null and g.source = 'app';

do $$
declare v int;
begin
  select count(*) into v from gifts_offline where cogs is null and source = 'app';
  if v <> 0 then raise exception 'backfill incompleto: % righe ancora senza cogs', v; end if;
  select count(*) into v from change_log where op = 'cogs_backfill_0120';
  if v <> 15 then raise exception 'change_log: attese 15 before-image, trovate %', v; end if;
end $$;
