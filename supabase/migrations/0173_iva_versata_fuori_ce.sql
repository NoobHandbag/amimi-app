-- 0173_iva_versata_fuori_ce.sql (2026-10-26, decisioni Dan in chat: "new subcategory", "restate")
--
-- Il CE contava due volte l'IVA a debito. I ricavi entrano gia' netti (lordo / 1,22), quindi l'IVA sulle vendite e'
-- fuori; ma ogni F24 era una spesa TASSE dentro MC2, e la parte IVA di un F24 e' proprio IVA a debito meno IVA
-- detraibile (la liquidazione di Sergio e' netta). Togliere l'F24 dal CE lascia solo i costi di periodo caricati
-- lordi dalla banca (IVA detraibile dentro): sovrastima prudente, si chiude solo con l'IVA per spesa (CASI_APERTI).
-- I COGS non c'entrano: entrano come costo unitario netto alla vendita, le spese categoria COGS sono escluse.
--
-- Regola: una spesa TASSE con sottocategoria 'IVA' e' un regolamento IVA (partita patrimoniale) e resta FUORI dal CE,
-- visibile come esclusione dichiarata in v_ce_completezza. Ritenute, diritti, libri sociali restano costo (TASSE).
--
-- Righe ricodificate (fonte: email di Sergio Monetti, Studio CSSF, "Addebito F24"):
--   15/04  236,57  IVA marzo (nessuna email; regime mensile, pagato alla scadenza dell'IVA di marzo)
--   17/05  800,41  IVA aprile (email 12/05)
--   16/06 1848,99  -> 1305,39 IVA maggio + 543,60 ritenute Studio e Senesi (email 11/06): la riga si divide in due
--   16/07 3745,46  IVA giugno (email 15/07)
--   02/09 2244,79  IVA luglio (email 02/09)
-- Restano TASSE, in attesa della ripartizione di Sergio: 16/09 968,71 (IVA agosto + ritenuta Ginevra), 17/03 1012,00
-- (natura ignota); 10/03 309,87 e' la tassa annuale sui libri sociali (costo vero). Il check ce_tasse_iva_da_dividere
-- di ce-guard tiene in vista le righe F24 non ancora ripartite.
--
-- Mesi chiusi toccati: aprile, maggio, giugno (CE amimi e totale). Si muovono SOLO tasse e mc2, dell'importo IVA del
-- mese; guardie prima e dopo come in 0155, before/after in change_log. Luglio-settembre non sono chiusi.

-- 1) Viste CE: la riga tasse esclude la sottocategoria IVA. Sostituzione sulla definizione viva, con guardia che il
--    filtro compaia esattamente una volta (se qualcuno ha cambiato la vista nel frattempo, la migrazione si ferma).
do $$
declare
  v text; def text; vecchio text := $f$(expenses.categoria = 'TASSE'::text)$f$;
  nuovo text := $f$((expenses.categoria = 'TASSE'::text) AND (expenses.sottocategoria IS DISTINCT FROM 'IVA'::text))$f$;
begin
  foreach v in array array['v_ce_amimi', 'v_ce_totale'] loop
    def := pg_get_viewdef(('public.' || v)::regclass);
    if (length(def) - length(replace(def, vecchio, ''))) / length(vecchio) <> 1 then
      raise exception '0173: in % il filtro TASSE non compare esattamente una volta', v;
    end if;
    execute format('create or replace view public.%I as %s', v, replace(def, vecchio, nuovo));
  end loop;
end $$;

-- 2) Drill-down: le righe IVA non appartengono a nessuna riga del CE (come COGS e PACKAGING).
create or replace view public.v_ce_drill_expense as
select year, month, date_paid, operazione, categoria, sottocategoria, costo, amimi,
  case
    when categoria = 'SALARI' then 'sal'
    when categoria = 'TASSE' and sottocategoria = 'IVA' then null
    when categoria = 'TASSE' then 'tasse'
    when categoria = 'OPEX' then 'opex'
    when categoria = 'EVENTI' then 'ev'
    when categoria = 'MARKETING' then 'mkt'
    when categoria = 'LOGISTICA' and sottocategoria ilike 'sped%' then 'lvar'
    when categoria = 'LOGISTICA' then 'lmag'
    else null
  end as ce_line
from expenses e
where status = 'approved';

-- 3) Completezza: l'IVA versata e' la terza esclusione dichiarata (colonna visibile, in coda per il replace).
create or replace view public.v_ce_completezza as
with mesi_nativi as (
  select distinct year, month from v_ce_totale
  where (year, month) not in (select year, month from ce_totale_manual where year is not null)
),
sp as (
  select year, month,
    coalesce(sum(costo), 0) as approvate,
    coalesce(sum(costo) filter (where categoria = 'COGS'), 0) as cat_cogs,
    coalesce(sum(costo) filter (where categoria = 'PACKAGING'), 0) as cat_packaging,
    coalesce(sum(costo) filter (where categoria = 'TASSE' and sottocategoria = 'IVA'), 0) as iva_versata
  from expenses where status = 'approved' group by year, month
),
ce as (
  select year, month,
    coalesce(salari,0)+coalesce(tasse,0)+coalesce(opex,0)+coalesce(eventi,0)+coalesce(marketing,0)+coalesce(logistica_mag,0)+coalesce(logistica_var,0) as righe_spesa
  from v_ce_totale
)
select n.year, n.month,
  round(coalesce(sp.approvate, 0), 2) as spese_approvate,
  round(coalesce(ce.righe_spesa, 0), 2) as spese_nel_ce,
  round(coalesce(sp.cat_cogs, 0), 2) as spese_cogs_escluse,
  round(coalesce(sp.cat_packaging, 0), 2) as spese_packaging_escluse,
  round(coalesce(sp.approvate, 0) - (coalesce(ce.righe_spesa, 0) + coalesce(sp.cat_cogs, 0) + coalesce(sp.cat_packaging, 0) + coalesce(sp.iva_versata, 0)), 2) as spese_scoperte,
  round(coalesce(sp.iva_versata, 0), 2) as spese_iva_escluse
from mesi_nativi n
left join sp on sp.year = n.year and sp.month = n.month
left join ce on ce.year = n.year and ce.month = n.month;

-- 4) Righe F24 che le email di Sergio mostrano come IVA (e quelle ancora da ripartire, che restano in vista).
create or replace view public.v_tasse_iva_da_dividere as
select id, year, month, date_paid, operazione, sottocategoria, costo
from expenses
where status = 'approved' and categoria = 'TASSE'
  and coalesce(sottocategoria, '') not in ('IVA', 'Ritenute', 'Diritti e bolli')
  and (operazione ilike '%IVA%' or operazione ilike '%F24%' or operazione ilike '%I24%' or sottocategoria ilike 'F24%');
revoke all on public.v_tasse_iva_da_dividere from anon;

create temp table _e0173 on commit drop as
select id, to_jsonb(e) as prima from expenses e
where id in ('ee846649-a33b-4bba-ae01-cfc375dc137e', '4702af95-8943-45c1-bf30-e2db2060c470',
             '217f2e8a-7663-4bea-b475-e035be64a4b5', '8cc12929-ad23-4604-90e3-e6d24f5703ae',
             '3a25905f-6681-407b-8346-c381a8c72c0c');

do $$
declare v_n int; v_tot numeric;
begin
  select count(*), sum((prima->>'costo')::numeric) into v_n, v_tot from _e0173
   where prima->>'categoria' = 'TASSE' and prima->>'status' = 'approved';
  if v_n <> 5 or v_tot <> -8876.22 then
    raise exception '0173: attese 5 righe F24 TASSE approvate per -8876,22, trovate % per %', v_n, v_tot;
  end if;
end $$;

-- 5) Dati: ricodifica e divisione della riga di giugno.
update expenses e
   set sottocategoria = 'IVA',
       costo = case when e.id = '217f2e8a-7663-4bea-b475-e035be64a4b5' then -1305.39 else e.costo end,
       note = concat_ws(' | ', nullif(e.note, ''), case when e.id = '217f2e8a-7663-4bea-b475-e035be64a4b5'
              then 'quota IVA maggio; 543,60 ritenute su riga separata (migr 0173)'
              else 'IVA versata, fuori dal CE (migr 0173)' end)
 where e.id in (select id from _e0173);

insert into expenses (year, month, date_reported, date_paid, operazione, costo, categoria, sottocategoria,
                      amimi_raw, note, source, chi, status, proposed_by, approved_by)
select year, month, date_reported, date_paid,
       operazione || ' - quota ritenute Studio e Senesi', -543.60, 'TASSE', 'Ritenute',
       amimi_raw, 'divisa da 217f2e8a, email Sergio 11/06 (migr 0173)', 'migration-0173', chi, 'approved', proposed_by, approved_by
  from expenses where id = '217f2e8a-7663-4bea-b475-e035be64a4b5';

-- la tassa sui libri sociali del 10/03 resta costo (TASSE): solo la sottocategoria, perche' il check non la segnali.
insert into _e0173 select id, to_jsonb(e) from expenses e
 where id = 'a667d4bc-c43f-4234-a529-8f6f87005dfe' and categoria = 'TASSE' and costo = -309.87;
update expenses set sottocategoria = 'Diritti e bolli' where id = 'a667d4bc-c43f-4234-a529-8f6f87005dfe';

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', t.id::text, 'update', t.prima, to_jsonb(e), 'iva-versata-fuori-ce-2026-10-26', 'claude-code-migration'
  from _e0173 t join expenses e on e.id = t.id;
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', e.id::text, 'insert', null, to_jsonb(e), 'iva-versata-fuori-ce-2026-10-26', 'claude-code-migration'
  from expenses e where e.source = 'migration-0173';

-- 6) Ri-chiusura di aprile, maggio, giugno: prima, le sole differenze sono tasse e mc2 dell'IVA del mese.
create temp table _ce0173 on commit drop as
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
    from _ce0173, jsonb_object_keys(snapshot) k
   where k not in ('year', 'month')
     and abs((j->>k)::numeric - (snapshot->>k)::numeric) > 0.005;
  if v_diff is distinct from 'amimi-4:mc2 236.57, amimi-4:tasse 236.57, amimi-5:mc2 800.41, amimi-5:tasse 800.41, amimi-6:mc2 1305.39, amimi-6:tasse 1305.39, '
                          || 'totale-4:mc2 236.57, totale-4:tasse 236.57, totale-5:mc2 800.41, totale-5:tasse 800.41, totale-6:mc2 1305.39, totale-6:tasse 1305.39' then
    raise exception '0173: i mesi chiusi non si muovono della sola IVA attesa: %', coalesce(v_diff, '(nessuna differenza)');
  end if;
end $$;

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', ce || '-' || year || '-' || month, 'reclose',
       snapshot || jsonb_build_object('_closed_at', closed_at, '_closed_by', closed_by),
       snapshot || jsonb_build_object('tasse', j->'tasse', 'mc2', j->'mc2'),
       'iva-versata-fuori-ce-2026-10-26', 'claude-code-migration'
  from _ce0173 where year = 2026 and month between 4 and 6;

update ce_snapshots s
   set snapshot = s.snapshot || jsonb_build_object('tasse', t.j->'tasse', 'mc2', t.j->'mc2'),
       closed_at = now(), closed_by = 'claude-code (0173: IVA versata fuori dal CE, OK owner 26-10)'
  from _ce0173 t
 where s.id = t.id and t.year = 2026 and t.month between 4 and 6;

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
  if v_diff is not null then raise exception '0173: dopo la ri-chiusura restano righe diverse dal live: %', v_diff; end if;
  if exists (select 1 from v_ce_completezza where abs(spese_scoperte) > 0.01) then
    raise exception '0173: v_ce_completezza ha spese scoperte dopo la migrazione';
  end if;
end $$;
