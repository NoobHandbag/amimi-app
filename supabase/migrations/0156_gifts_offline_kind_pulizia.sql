-- 0156_gifts_offline_kind_pulizia.sql (2026-10-13, decisioni di Dan in chat; caso aperto 35 punto c)
--
-- Pulizia di gifts_offline. Fino a luglio il tab GIFT_OFFLINE del Foglio era l'unico posto dove segnare una vendita
-- fatta fuori da Qromo e Shopify, e l'import (etl/push.mjs, etl/load.mjs) scriveva kind = 'gift' su OGNI riga: 61 righe
-- "omaggio" sono vendite (6.355 EUR lordi, contanti, PayPal, Revolut, bonifico, Bottega Tremezzo, matrimonio). Il form
-- Regalo dell'app accettava un prezzo (5 di quelle righe, luglio-settembre). Altre 63 righe non avevano kind.
--
-- Decisioni di Dan (13-10): la base del compenso soci resta "vendite ufficiali + vendite manuali", quindi le 61 righe
-- incassate fuori dal fatturato restano FUORI dalla base, con un kind loro; il Regalo non ha piu' prezzo (soldi = Vendita).
--
-- Cosa fa:
--   1. kind: 'gift' = omaggio, prezzo 0; 'vendita_manuale' = vendita fuori Qromo/Shopify, conta nel compenso;
--      'vendita_fuori_fatturato' = incassata fuori dal fatturato, NON conta nel compenso (solo storico, l'app non la
--      scrive); 'rettifica' = uscita di magazzino che non e' ne' vendita ne' omaggio (conte, cambi, sostituzioni,
--      trasformazioni, scarico del matrimonio).
--   2. I 6 omaggi a 1 EUR simbolico (marzo) vanno a prezzo 0.
--   3. cogs (e' il TOTALE di riga, SCHEMA.md sez. 3): 13 righe con quantita' 0 e costo pieno (righe annullate che si sono
--      tenute il costo) vanno a 0; 3 righe da 2 pezzi col costo di un pezzo solo vanno a 2 pezzi.
--   4. kind obbligatorio (default 'gift') con i soli quattro valori; un 'gift' non puo' avere prezzo.
--   5. v_ce_totale: la base del compenso toglie 'vendita_fuori_fatturato' invece di 'gift'. Stesso perimetro di prima
--      (gli omaggi ora hanno prezzo 0); vista riscritta da pg_get_viewdef cambiando solo quel filtro.
--   5b. v_ce_drill_sales: is_gift vero solo per kind 'gift' (prima ogni riga di gifts_offline, anche le vendite).
--   6. Ri-chiusura del Totale di marzo e giugno, gli unici mesi chiusi che si muovono. Il CE Amimi' non legge
--      gifts_offline: la guardia finale verifica che nessuna riga di nessuno snapshot resti diversa dal live.
-- Ogni riga toccata ha before/after in change_log (chi = 'pulizia-gifts-offline-2026-10-13').

create temp table _g0156 on commit drop as select * from gifts_offline;

do $$
declare n int; s numeric;
begin
  select count(*), coalesce(sum(prezzo), 0) into n, s from gifts_offline where kind = 'gift' and prezzo > 1;
  if n <> 61 or s <> 6355 then raise exception '0156: vendite segnate gift attese 61 / 6355, trovate % / %', n, s; end if;
  select count(*), coalesce(sum(prezzo), 0) into n, s from gifts_offline where prezzo > 0 and prezzo <= 1;
  if n <> 6 or s <> 6 then raise exception '0156: omaggi a 1 EUR attesi 6 / 6, trovati % / %', n, s; end if;
  select count(*), coalesce(sum(prezzo), 0) into n, s from gifts_offline where kind is null and prezzo > 1;
  if n <> 3 or s <> 226 then raise exception '0156: vendite senza kind attese 3 / 226, trovate % / %', n, s; end if;
  select count(*) into n from gifts_offline where kind is null and coalesce(prezzo, 0) = 0;
  if n <> 57 then raise exception '0156: righe senza kind a prezzo 0 attese 57, trovate %', n; end if;
  select count(*) into n from gifts_offline where kind is null and coalesce(prezzo, 0) = 0 and nota like 'Gift Ana%';
  if n <> 1 then raise exception '0156: riga "Gift Ana" attesa 1, trovate %', n; end if;
  select count(*) into n from gifts_offline where kind is not null and kind not in ('gift', 'vendita_manuale');
  if n <> 0 then raise exception '0156: % righe con un kind inatteso', n; end if;
  select count(*), coalesce(sum(cogs), 0) into n, s from gifts_offline where quantita = 0 and cogs > 0;
  if n <> 13 or s <> 320.33 then raise exception '0156: righe a quantita 0 con costo attese 13 / 320,33, trovate % / %', n, s; end if;
  select count(*), coalesce(sum(p.cogs * g.quantita - g.cogs), 0) into n, s
    from gifts_offline g join products p on p.codice_norm = g.codice_norm
   where g.quantita = 2 and g.cogs = p.cogs;
  if n <> 3 or s <> 97 then raise exception '0156: righe da 2 pezzi col costo di uno attese 3 / +97, trovate % / %', n, s; end if;
end $$;

update gifts_offline set kind = 'vendita_fuori_fatturato' where kind = 'gift' and prezzo > 1;
update gifts_offline set kind = 'gift', prezzo = 0 where prezzo > 0 and prezzo <= 1;
update gifts_offline set kind = 'vendita_manuale' where kind is null and prezzo > 1;
update gifts_offline set kind = 'gift' where kind is null and coalesce(prezzo, 0) = 0 and nota like 'Gift Ana%';
update gifts_offline set kind = 'rettifica' where kind is null;
update gifts_offline set cogs = 0 where quantita = 0 and cogs > 0;
update gifts_offline g set cogs = p.cogs * g.quantita
  from products p
 where p.codice_norm = g.codice_norm and g.quantita = 2 and g.cogs = p.cogs;

do $$
declare v text; n int; d numeric;
begin
  select string_agg(kind || ' ' || c || ' ' || p, ', ' order by kind) into v
    from (select kind, count(*) c, coalesce(sum(prezzo), 0) p from gifts_offline group by kind) x;
  if v is distinct from 'gift 24 0.00, rettifica 56 0.00, vendita_fuori_fatturato 61 6355.00, vendita_manuale 13 992.00' then
    raise exception '0156: distribuzione dei kind inattesa: %', v;
  end if;
  select (select coalesce(sum(cogs), 0) from gifts_offline) - (select coalesce(sum(cogs), 0) from _g0156) into d;
  if d <> -223.33 then raise exception '0156: il costo totale doveva scendere di 223,33, e'' cambiato di %', d; end if;
  select count(*) into n from gifts_offline a join _g0156 b using (id) where to_jsonb(a) is distinct from to_jsonb(b);
  if n <> 128 then raise exception '0156: righe toccate attese 128, trovate %', n; end if;
  select count(*) into n from gifts_offline a join _g0156 b using (id)
   where a.quantita is distinct from b.quantita or a.codice is distinct from b.codice or a.data is distinct from b.data;
  if n <> 0 then raise exception '0156: % righe con quantita, codice o data cambiati (il magazzino non deve muoversi)', n; end if;
end $$;

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'gifts_offline', a.id::text, 'update', to_jsonb(b), to_jsonb(a), 'pulizia-gifts-offline-2026-10-13', 'claude-code-migration'
  from gifts_offline a join _g0156 b using (id)
 where to_jsonb(a) is distinct from to_jsonb(b);

alter table gifts_offline alter column kind set default 'gift';
alter table gifts_offline alter column kind set not null;
alter table gifts_offline add constraint gifts_offline_kind_check
  check (kind in ('gift', 'vendita_manuale', 'vendita_fuori_fatturato', 'rettifica'));
alter table gifts_offline add constraint gifts_offline_gift_senza_prezzo
  check (kind <> 'gift' or coalesce(prezzo, 0) = 0);

do $$
declare d text; old text := 'g.kind = ''gift''::text';
begin
  d := rtrim(pg_get_viewdef('public.v_ce_totale'::regclass, true), E' \n;');
  if (length(d) - length(replace(d, old, ''))) / length(old) <> 1 then
    raise exception '0156: in v_ce_totale atteso un solo filtro %', old;
  end if;
  execute 'create or replace view public.v_ce_totale as ' || replace(d, old, 'g.kind = ''vendita_fuori_fatturato''::text');
end $$;

do $$
declare d text; old text := E'true AS is_gift\n   FROM gifts_offline g';
begin
  d := rtrim(pg_get_viewdef('public.v_ce_drill_sales'::regclass, true), E' \n;');
  if (length(d) - length(replace(d, old, ''))) / length(old) <> 1 then
    raise exception '0156: in v_ce_drill_sales atteso un solo is_gift fisso sulle righe di gifts_offline';
  end if;
  execute 'create or replace view public.v_ce_drill_sales as ' || replace(d, old, E'g.kind = ''gift''::text AS is_gift\n   FROM gifts_offline g');
end $$;

create temp table _ce0156 on commit drop as
select s.id, s.ce, s.year, s.month, s.snapshot, s.closed_at, s.closed_by, l.j
  from ce_snapshots s
  join (select 'amimi'::text ce, year, month, to_jsonb(a) j from v_ce_amimi_summary a
        union all
        select 'totale', year, month, to_jsonb(t) from v_ce_totale t) l
    on l.ce = s.ce and l.year = s.year and l.month = s.month;

do $$
declare v_diff text;
begin
  select string_agg(ce || '-' || month || ':' || k || ' ' || round((j->>k)::numeric - (snapshot->>k)::numeric, 2), ', ' order by ce, month, k)
    into v_diff
    from _ce0156, jsonb_object_keys(snapshot) k
   where k not in ('year', 'month')
     and abs((j->>k)::numeric - (snapshot->>k)::numeric) > 0.005;
  if v_diff is distinct from
     'totale-3:base_compenso_soci -2.46, totale-3:cogs 30.33, totale-3:compenso_soci 0.06, totale-3:mc1 25.47, totale-3:mc2 25.47, '
     'totale-3:offline_lordo -6.00, totale-3:offline_netto -4.92, totale-3:omni_netto -4.92, '
     'totale-6:cogs 193.00, totale-6:mc1 193.00, totale-6:mc2 193.00' then
    raise exception '0156: i mesi chiusi non si muovono come atteso: %', coalesce(v_diff, '(nessuna differenza)');
  end if;
end $$;

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', ce || '-' || year || '-' || month, 'reclose',
       snapshot || jsonb_build_object('_closed_at', closed_at, '_closed_by', closed_by),
       snapshot || (select jsonb_object_agg(k, j->k) from jsonb_object_keys(snapshot) k
                     where k not in ('year', 'month') and abs((j->>k)::numeric - (snapshot->>k)::numeric) > 0.005),
       'pulizia-gifts-offline-2026-10-13', 'claude-code-migration'
  from _ce0156
 where ce = 'totale' and month in (3, 6);

update ce_snapshots s
   set snapshot = s.snapshot || (select jsonb_object_agg(k, t.j->k) from jsonb_object_keys(s.snapshot) k
                                  where k not in ('year', 'month') and abs((t.j->>k)::numeric - (s.snapshot->>k)::numeric) > 0.005),
       closed_at = now(), closed_by = 'claude-code (0156: pulizia gifts_offline, decisioni Dan 13-10)'
  from _ce0156 t
 where s.id = t.id and t.ce = 'totale' and t.month in (3, 6);

do $$
declare v_diff text;
begin
  select string_agg(s.ce || '-' || s.month || ' ' || k, ', ') into v_diff
    from ce_snapshots s
    join (select 'amimi'::text ce, year, month, to_jsonb(a) j from v_ce_amimi_summary a
          union all
          select 'totale', year, month, to_jsonb(t) from v_ce_totale t) l
      on l.ce = s.ce and l.year = s.year and l.month = s.month,
         jsonb_object_keys(s.snapshot) k
   where k not in ('year', 'month')
     and abs((l.j->>k)::numeric - (s.snapshot->>k)::numeric) > 0.005;
  if v_diff is not null then raise exception '0156: dopo la ri-chiusura restano righe diverse dal live: %', v_diff; end if;
end $$;
