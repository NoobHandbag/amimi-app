-- tests/ads_mensile_viste.sql: prova VIVA della migr 0176 (v_ads_mensile sulla serie viva, regola per giorno), da
-- lanciare DOPO l'apply. Solo letture, piu' la copia temporanea della base per ad e la vista temporanea del replay K,
-- che spariscono col rollback. Si incolla in UNA chiamata execute_sql (o psql): e' un unico blocco DO che alla fine alza
-- SEMPRE un'eccezione.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Prima dell'apply gira dentro un unico blocco DO annullato, dopo il corpo della migrazione.
-- In produzione plpgsql.variable_conflict vale 'error': le variabili hanno il prefisso v_.
-- Regola per giorno RISCRITTA qui a mano: un giorno con righe in meta_ads_creative_daily si legge da ads-sync, un giorno
-- senza da meta_ads_daily. Le somme attese sono le due serie aggregate PER CONTO LORO e poi sommate per mese (la vista
-- invece aggrega l'unione dei giorni).
-- Cosa prova (i 9 controlli della prova del 28-10, rifatti sulla regola per giorno, piu' il replay K):
--   C  colonne e tipi: le 8 della 0020 (year, month integer; spend, impressions, clicks, purchases, purchase_value,
--      roas numeric), poi fonte text e ultimo_giorno date; owner postgres; commento della 0176
--   G  nessun giorno contato due volte: totali della vista = serie vecchia intera + ads-sync - serie vecchia sui giorni
--      che ads-sync ha (oggi 12, 20-06..01-07)
--   M  mesi della vista = mesi dei giorni attesi, una riga per mese, in ordine anno/mese
--   V  per mese spesa, impression, click, acquisti e valore = giorni solo vecchi + giorni ads-sync
--   F  fonte per mese: ads-sync, meta_ads_daily o misto secondo i giorni attesi
--   U  ultimo_giorno = ultimo giorno atteso del mese; l'ultimo mese arriva a v_fonti_freschezza.meta_ads_creative_ultimo_giorno
--   T  storico di oggi: nessun mese prima di 2026-04; aprile e maggio 2026 meta_ads_daily; giugno 2026 misto con
--      01-19 dalla serie vecchia e 20-30 da ads-sync; ogni mese da luglio 2026 ads-sync (un backfill legittimo prima
--      del 20-06 cambia questa riga: si aggiorna insieme a tests/features.mjs)
--   R  roas = round(valore / spesa, 2), 0 a spesa 0
--   A  ask_select (ask_ro: ask-data, tool MCP ask_data) legge le 5 viste Ads con le righe del proprietario e prende
--      42501 su ogni base meta_* tranne meta_ads_daily (SELECT dal 0121); anon legge v_ads_mensile come il proprietario
--   K  (Gate 2 M176-1) replay della vista viva su una copia temporanea della base per ad con un giorno di backfill finto
--      a meta' della serie vecchia: cambia solo il mese di quel giorno (misto, quel giorno da ads-sync, gli altri giorni
--      vecchi restano); con un taglio unico su min(date) sparirebbero i giorni vecchi da li' al 19-06
do $t$
declare
  v_n int;
  v_k int;
  v_sovrap int;
  v_basi int := 0;
  v_ym int;
  v_prev int := 0;
  v_dt date;
  v_d0 date;
  v_num numeric;
  v_num2 numeric;
  v_cols text;
  v_r text;
  v_st text;
  v_mesi text;
  v_owner text;
  v_anon text;
  v_def text;
  v_replay text;
  v_j jsonb;
begin
  if to_regclass('public.v_ads_mensile') is null then raise exception 'KO C: v_ads_mensile assente'; end if;

  -- C
  select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ',' order by attnum) into v_cols
    from pg_attribute where attrelid = 'public.v_ads_mensile'::regclass and attnum > 0 and not attisdropped;
  if v_cols is distinct from 'year integer,month integer,spend numeric,impressions numeric,clicks numeric,purchases numeric,'
       || 'purchase_value numeric,roas numeric,fonte text,ultimo_giorno date' then
    raise exception 'KO C: colonne di v_ads_mensile = % (migr 0176 non applicata?)', v_cols;
  end if;
  if pg_get_userbyid((select relowner from pg_class where oid = 'public.v_ads_mensile'::regclass)) <> 'postgres' then
    raise exception 'KO C: v_ads_mensile non e'' di postgres (legge la base per ad con RLS senza policy)';
  end if;
  if coalesce(obj_description('public.v_ads_mensile'::regclass, 'pg_class'), '') not like '%Per ogni giorno%Migr 0176.' then
    raise exception 'KO C: commento della vista diverso da quello della 0176';
  end if;

  create temp table t_ads_att on commit drop as
  with vl as (
    select extract(year from l.date)::int as a, extract(month from l.date)::int as m, sum(coalesce(l.spend, 0)) as s,
           sum(coalesce(l.impressions, 0)) as i, sum(coalesce(l.clicks, 0)) as c, sum(coalesce(l.purchases, 0)) as p,
           sum(coalesce(l.purchase_value, 0)) as pv, max(l.date) as u, count(distinct l.date) as g
      from meta_ads_daily l
     where not exists (select 1 from meta_ads_creative_daily c where c.date = l.date)
     group by 1, 2
  ), vc as (
    select extract(year from c.date)::int as a, extract(month from c.date)::int as m, sum(coalesce(c.spend, 0)) as s,
           sum(coalesce(c.impressions, 0)) as i, sum(coalesce(c.clicks, 0)) as c, sum(coalesce(c.purchases, 0)) as p,
           sum(coalesce(c.purchase_value, 0)) as pv, max(c.date) as u, count(distinct c.date) as g
      from meta_ads_creative_daily c
     group by 1, 2
  )
  select coalesce(vl.a, vc.a) as a, coalesce(vl.m, vc.m) as m,
         round(coalesce(vl.s, 0) + coalesce(vc.s, 0), 2) as s, coalesce(vl.i, 0) + coalesce(vc.i, 0) as i,
         coalesce(vl.c, 0) + coalesce(vc.c, 0) as c, coalesce(vl.p, 0) + coalesce(vc.p, 0) as p,
         round(coalesce(vl.pv, 0) + coalesce(vc.pv, 0), 2) as pv, greatest(vl.u, vc.u) as u,
         case when vl.a is null then 'ads-sync' when vc.a is null then 'meta_ads_daily' else 'misto' end as f,
         coalesce(vl.g, 0) as g_vecchi, coalesce(vc.g, 0) as g_ads
    from vl full join vc on vc.a = vl.a and vc.m = vl.m;

  -- G
  select count(distinct l.date) into v_sovrap from meta_ads_daily l
   where exists (select 1 from meta_ads_creative_daily c where c.date = l.date);
  select (select coalesce(sum(impressions), 0) from meta_ads_daily) + (select coalesce(sum(impressions), 0) from meta_ads_creative_daily)
         - (select coalesce(sum(l.impressions), 0) from meta_ads_daily l where exists (select 1 from meta_ads_creative_daily c where c.date = l.date)),
         (select coalesce(sum(spend), 0) from meta_ads_daily) + (select coalesce(sum(spend), 0) from meta_ads_creative_daily)
         - (select coalesce(sum(l.spend), 0) from meta_ads_daily l where exists (select 1 from meta_ads_creative_daily c where c.date = l.date))
    into v_num, v_num2;
  if (select coalesce(sum(impressions), 0) from v_ads_mensile) is distinct from v_num
     or (select coalesce(sum(spend), 0) from v_ads_mensile) is distinct from v_num2 then
    raise exception 'KO G: totali della vista (impression %, spesa %) contro serie vecchia senza i giorni ads-sync + ads-sync (%, %)',
      (select sum(impressions) from v_ads_mensile), (select sum(spend) from v_ads_mensile), v_num, v_num2;
  end if;
  if v_sovrap > 0 and (select coalesce(sum(impressions), 0) from v_ads_mensile)
       >= (select coalesce(sum(impressions), 0) from meta_ads_daily) + (select coalesce(sum(impressions), 0) from meta_ads_creative_daily) then
    raise exception 'KO G: con % giorni in comune le impression della vista non sono sotto la somma piena delle due serie', v_sovrap;
  end if;

  -- M
  select count(*) into v_n from v_ads_mensile;
  select count(*) into v_k from t_ads_att;
  if v_n <> v_k then raise exception 'KO M: % mesi nella vista, attesi %', v_n, v_k; end if;
  select count(*) into v_n from (select year, month from v_ads_mensile group by 1, 2 having count(*) > 1) q;
  if v_n > 0 then raise exception 'KO M: % mesi con piu'' di una riga', v_n; end if;
  select count(*) into v_n from v_ads_mensile v where not exists (select 1 from t_ads_att x where x.a = v.year and x.m = v.month);
  if v_n > 0 then raise exception 'KO M: % mesi nella vista senza giorni attesi', v_n; end if;
  for v_ym in select year * 100 + month from v_ads_mensile loop
    if v_ym <= v_prev then raise exception 'KO M: mesi fuori ordine anno/mese (% dopo %)', v_ym, v_prev; end if;
    v_prev := v_ym;
  end loop;

  -- V
  select count(*) into v_n from v_ads_mensile v join t_ads_att x on x.a = v.year and x.m = v.month
   where (v.spend, v.impressions, v.clicks, v.purchases, v.purchase_value) is distinct from (x.s, x.i, x.c, x.p, x.pv);
  if v_n > 0 then
    raise exception 'KO V: % mesi con somme diverse da giorni vecchi + giorni ads-sync (%)', v_n,
      (select string_agg(v.year || '-' || v.month || ' vista ' || v.spend || '/' || v.impressions || ' attesi ' || x.s || '/' || x.i, '; ')
         from v_ads_mensile v join t_ads_att x on x.a = v.year and x.m = v.month
        where (v.spend, v.impressions, v.clicks, v.purchases, v.purchase_value) is distinct from (x.s, x.i, x.c, x.p, x.pv));
  end if;

  -- F
  select count(*) into v_n from v_ads_mensile v join t_ads_att x on x.a = v.year and x.m = v.month where v.fonte is distinct from x.f;
  if v_n > 0 then raise exception 'KO F: % mesi con fonte diversa da quella dei giorni attesi', v_n; end if;

  -- U
  select count(*) into v_n from v_ads_mensile v join t_ads_att x on x.a = v.year and x.m = v.month where v.ultimo_giorno is distinct from x.u;
  if v_n > 0 then raise exception 'KO U: % mesi con ultimo_giorno diverso dall''ultimo giorno atteso', v_n; end if;
  select meta_ads_creative_ultimo_giorno into v_dt from v_fonti_freschezza;
  if v_dt is not null and (select ultimo_giorno from v_ads_mensile order by year desc, month desc limit 1) is distinct from v_dt then
    raise exception 'KO U: l''ultimo mese arriva al %, v_fonti_freschezza.meta_ads_creative_ultimo_giorno = %',
      (select ultimo_giorno from v_ads_mensile order by year desc, month desc limit 1), v_dt;
  end if;

  -- T
  select count(*) into v_n from v_ads_mensile where year * 100 + month < 202604;
  if v_n > 0 then raise exception 'KO T: % mesi prima di 2026-04', v_n; end if;
  select count(*) into v_n from v_ads_mensile
   where (year = 2026 and month in (4, 5) and fonte <> 'meta_ads_daily')
      or (year = 2026 and month = 6 and fonte <> 'misto')
      or (year * 100 + month >= 202607 and fonte <> 'ads-sync');
  if v_n > 0 then raise exception 'KO T: % mesi con fonte diversa da apr-mag meta_ads_daily, giu misto, da lug ads-sync', v_n; end if;
  select count(distinct l.date), min(l.date), max(l.date) into v_n, v_dt, v_d0 from meta_ads_daily l
   where l.date between '2026-06-01' and '2026-06-30' and not exists (select 1 from meta_ads_creative_daily c where c.date = l.date);
  if (v_n, v_dt, v_d0) is distinct from (19, date '2026-06-01', date '2026-06-19') then
    raise exception 'KO T: giugno 2026 dalla serie vecchia % giorni (% .. %), attesi 19 (01-06 .. 19-06)', v_n, v_dt, v_d0;
  end if;
  select count(distinct date), min(date), max(date) into v_n, v_dt, v_d0 from meta_ads_creative_daily
   where date between '2026-06-01' and '2026-06-30';
  if (v_n, v_dt, v_d0) is distinct from (11, date '2026-06-20', date '2026-06-30') then
    raise exception 'KO T: giugno 2026 da ads-sync % giorni (% .. %), attesi 11 (20-06 .. 30-06)', v_n, v_dt, v_d0;
  end if;

  -- R
  select count(*) into v_n from v_ads_mensile
   where roas is distinct from case when spend > 0 then round(purchase_value / spend, 2) else 0 end;
  if v_n > 0 then raise exception 'KO R: % mesi con roas diverso da round(valore / spesa, 2) (0 a spesa 0)', v_n; end if;

  select string_agg(year || '-' || lpad(month::text, 2, '0') || ' ' || fonte || ' ' || spend || ' roas ' || roas || ' al '
                    || to_char(ultimo_giorno, 'DD-MM'), '; ' order by year, month) into v_mesi from v_ads_mensile;

  -- K (M176-1): replay su una copia temporanea della base per ad con un giorno di backfill finto nella serie vecchia
  select count(distinct l.date) into v_n from meta_ads_daily l where not exists (select 1 from meta_ads_creative_daily c where c.date = l.date);
  if v_n >= 3 then
    select q.d into v_d0 from (select distinct l.date as d from meta_ads_daily l
                                where not exists (select 1 from meta_ads_creative_daily c where c.date = l.date)) q
     order by q.d offset v_n / 2 limit 1;
    create temp table t_ads_cd on commit drop as
      select date, spend, impressions, clicks, purchases, purchase_value from meta_ads_creative_daily;
    insert into t_ads_cd (date, spend, impressions, clicks, purchases, purchase_value) values (v_d0, 1.00, 1000, 10, 0, 0);
    v_def := pg_get_viewdef('public.v_ads_mensile'::regclass, true);
    if regexp_count(v_def, '\mmeta_ads_creative_daily\M') <> 2 then
      raise exception 'KO K: meta_ads_creative_daily trovata % volte nella vista (attese 2)', regexp_count(v_def, '\mmeta_ads_creative_daily\M');
    end if;
    execute 'create temp view v_ads_mensile_replay as '
            || rtrim(regexp_replace(v_def, '(\mpublic\.)?\mmeta_ads_creative_daily\M', 'pg_temp.t_ads_cd', 'g'), E'; \n');
    select count(*) into v_n from (
      (select * from v_ads_mensile where (year, month) <> (extract(year from v_d0)::int, extract(month from v_d0)::int)
       except all
       select * from v_ads_mensile_replay)
      union all
      (select * from v_ads_mensile_replay where (year, month) <> (extract(year from v_d0)::int, extract(month from v_d0)::int)
       except all
       select * from v_ads_mensile)) q;
    if v_n > 0 then raise exception 'KO K: col backfill finto del % cambiano % righe di altri mesi (taglio unico?)', v_d0, v_n; end if;
    select coalesce(sum(spend), 0), coalesce(sum(impressions), 0) into v_num, v_num2 from meta_ads_daily where date = v_d0;
    select count(*) into v_n
      from v_ads_mensile v join v_ads_mensile_replay r on r.year = v.year and r.month = v.month
     where v.year = extract(year from v_d0)::int and v.month = extract(month from v_d0)::int
       and r.fonte = 'misto' and r.ultimo_giorno = v.ultimo_giorno
       and r.spend = v.spend - v_num + 1.00 and r.impressions = v.impressions - v_num2 + 1000;
    if v_n <> 1 then
      raise exception 'KO K: il mese del backfill finto (%) non e'' misto con solo quel giorno spostato (vecchia %/% sostituita da 1.00/1000): %', v_d0, v_num, v_num2,
        (select string_agg(r.year || '-' || r.month || ' ' || r.fonte || ' ' || r.spend || '/' || r.impressions, '; ') from v_ads_mensile_replay r
          where r.year = extract(year from v_d0)::int and r.month = extract(month from v_d0)::int);
    end if;
    v_replay := 'backfill finto al ' || to_char(v_d0, 'DD-MM-YYYY') || ': solo il suo mese cambia (misto), gli altri uguali';
  else
    v_replay := 'saltato (' || v_n || ' giorni vecchi)';
  end if;

  -- A
  select string_agg(t::text, '|' order by year, month) into v_owner from v_ads_mensile t;
  perform set_config('role', 'anon', true);
  select string_agg(t::text, '|' order by year, month) into v_anon from v_ads_mensile t;
  reset role;
  if v_anon is distinct from v_owner then raise exception 'KO A: anon legge v_ads_mensile diversa dal proprietario'; end if;
  foreach v_r in array array['v_ads_mensile', 'v_ads_periodo_14g', 'v_ads_swap', 'v_ads_weekly_account', 'v_ads_creative_status'] loop
    begin
      v_j := ask_select('select count(*) as n from ' || v_r);
    exception when others then
      raise exception 'KO A: ask_select su % = % %', v_r, sqlstate, sqlerrm;
    end;
    execute 'select count(*) from ' || v_r into v_n;
    if (v_j -> 0 ->> 'n')::int is distinct from v_n then
      raise exception 'KO A: ask_select su % da'' % righe, il proprietario %', v_r, v_j -> 0 ->> 'n', v_n;
    end if;
  end loop;
  for v_r in select c.relname::text from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname like 'meta\_%'
                and c.relname <> 'meta_ads_daily' order by 1 loop
    v_st := 'ok';
    begin
      perform ask_select('select 1 from ' || v_r || ' limit 1');
    exception when others then v_st := sqlstate;
    end;
    if v_st <> '42501' then raise exception 'KO A: ask_select su % = % (atteso 42501)', v_r, v_st; end if;
    v_basi := v_basi + 1;
  end loop;
  select count(*) into v_n from unnest(array['meta_ads_creative_daily', 'meta_ad_creative', 'meta_ad_freq7', 'meta_ads_window_reach',
                                              'meta_product_set_map']) b(x)
   where to_regclass('public.' || b.x) is null;
  if v_n > 0 or v_basi < 5 then raise exception 'KO A: basi meta_* provate %, mancano % delle 5 attese', v_basi, v_n; end if;

  raise exception 'TEST_OK: C G M V F U T R A K verdi; % giorni in comune fra le due serie (contati una volta, da ads-sync); mesi: %; replay K: %; ask_ro legge le 5 viste Ads e prende 42501 su % basi meta_* (rollback voluto)',
    v_sovrap, v_mesi, v_replay, v_basi;
end $t$;
