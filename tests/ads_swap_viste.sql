-- tests/ads_swap_viste.sql: prova VIVA della migr 0175 (cruscotto Ads, quando cambiare una creativita'), da lanciare
-- DOPO l'apply. Solo letture (l'unica scrittura tentata e' quella che anon e authenticated NON devono poter fare). Si
-- incolla in UNA chiamata execute_sql (o psql): e' un unico blocco DO che alla fine alza SEMPRE un'eccezione.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- In produzione plpgsql.variable_conflict vale 'error': le variabili hanno il prefisso v_ per non chiamarsi come una
-- colonna delle tabelle e viste lette qui.
-- Cosa prova:
--   M  oggetti della 0175 presenti: colonne video, meta_ads_window_reach con PK, RLS on e nessuna policy
--   S  v_ads_swap: una riga per ogni ad ACTIVE o con spesa negli ultimi 14 giorni, nessun doppio, stato/ordine coerenti
--   P  v_ads_periodo_14g: due finestre per oggetto; le righe ad, adset e campagna sommano come l'account per finestra;
--      la spesa dell'account e' quella della tabella; reach/frequency solo dalla finestra uguale di meta_ads_window_reach
--   A  anon e authenticated leggono le due viste come il proprietario, 0 righe di meta_ads_window_reach, niente insert
do $t$
declare
  v_as_of date;
  v_n int;
  v_m int;
  v_num numeric;
  v_num2 numeric;
  v_st text;
  v_r text;
  v_stati text;
  v_reach text;
  v_video text;
  v_righe_periodo int;
begin
  -- M
  if to_regclass('public.meta_ads_window_reach') is null or to_regclass('public.v_ads_periodo_14g') is null
     or to_regclass('public.v_ads_swap') is null then
    raise exception 'KO M: migr 0175 non applicata';
  end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'meta_ads_creative_daily' and column_name in ('video_3s_views', 'thruplays');
  if v_n <> 2 then raise exception 'KO M: colonne video su meta_ads_creative_daily = % (attese 2)', v_n; end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_ads_window_reach_pkey') then
    raise exception 'KO M: manca meta_ads_window_reach_pkey (upsert di ads-sync)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.meta_ads_window_reach'::regclass) then
    raise exception 'KO M: RLS spenta su meta_ads_window_reach';
  end if;
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'meta_ads_window_reach';
  if v_n <> 0 then raise exception 'KO M: % policy su meta_ads_window_reach (attese 0)', v_n; end if;

  select max(date) into v_as_of from meta_ads_creative_daily;

  -- S
  select count(*) into v_m from (select ad_id from meta_ad_creative where effective_status = 'ACTIVE'
                                 union select ad_id from meta_ads_creative_daily where date > v_as_of - 14 and spend > 0) q;
  select count(*) into v_n from v_ads_swap;
  if v_n <> v_m then raise exception 'KO S: % righe in v_ads_swap, attese %', v_n, v_m; end if;
  select count(*) into v_n from (select ad_id from v_ads_swap group by ad_id having count(*) > 1) q;
  if v_n > 0 then raise exception 'KO S: % ad con piu'' di una riga', v_n; end if;
  select count(*) into v_n from meta_ad_creative c
   where c.effective_status = 'ACTIVE' and not exists (select 1 from v_ads_swap s where s.ad_id = c.ad_id);
  if v_n > 0 then raise exception 'KO S: % ad ACTIVE assenti da v_ads_swap', v_n; end if;
  select count(*) into v_n from v_ads_swap
   where stato is null or motivo is null or as_of is distinct from v_as_of
      or stato not in ('cambia', 'osserva', 'nuova', 'ok', 'senza_consegna', 'in_pausa')
      or ordine is distinct from case stato when 'cambia' then 1 when 'osserva' then 2 when 'nuova' then 3
                                            when 'ok' then 4 when 'senza_consegna' then 5 else 6 end;
  if v_n > 0 then raise exception 'KO S: % righe con stato, ordine, motivo o as_of fuori posto', v_n; end if;
  select count(*) into v_n from v_ads_swap
   where (stato = 'in_pausa') <> (coalesce(effective_status, '') <> 'ACTIVE')
      or (stato = 'cambia' and not (segnale_spesa or (segnale_freq and segnale_ctr)))
      or (stato in ('nuova', 'ok', 'senza_consegna') and (segnale_spesa or segnale_freq or segnale_ctr));
  if v_n > 0 then raise exception 'KO S: % righe con lo stato in disaccordo coi segnali', v_n; end if;
  select string_agg(stato || ' ' || n, ', ' order by o) into v_stati
  from (select stato, min(ordine) o, count(*) n from v_ads_swap group by stato) q;

  -- P
  select count(*) into v_righe_periodo from v_ads_periodo_14g;
  select count(*) into v_n from (select level, object_id from v_ads_periodo_14g group by 1, 2
                                 having count(*) <> 2 or count(distinct window_key) <> 2) q;
  if v_n > 0 then raise exception 'KO P: % oggetti senza esattamente le due finestre', v_n; end if;
  select count(*) into v_n
  from (select window_key, level, sum(spend) s, sum(impressions) i, sum(clicks) c, sum(link_clicks) l,
               sum(landing_page_views) lp, sum(add_to_cart) ac, sum(purchases) p, sum(purchase_value) pv
        from v_ads_periodo_14g group by 1, 2) a
  join (select window_key, spend s, impressions i, clicks c, link_clicks l, landing_page_views lp, add_to_cart ac,
               purchases p, purchase_value pv
        from v_ads_periodo_14g where level = 'account') t using (window_key)
  where (a.s, a.i, a.c, a.l, a.lp, a.ac, a.p, a.pv) is distinct from (t.s, t.i, t.c, t.l, t.lp, t.ac, t.p, t.pv);
  if v_n > 0 then raise exception 'KO P: % coppie (finestra, livello) che non sommano come l''account', v_n; end if;
  select coalesce(sum(spend), 0) into v_num from meta_ads_creative_daily where date between v_as_of - 13 and v_as_of;
  select spend into v_num2 from v_ads_periodo_14g where level = 'account' and window_key = 'cur14';
  if v_num is distinct from v_num2 then raise exception 'KO P: spesa cur14 tabella % vista %', v_num, v_num2; end if;
  select coalesce(sum(spend), 0) into v_num from meta_ads_creative_daily where date between v_as_of - 27 and v_as_of - 14;
  select spend into v_num2 from v_ads_periodo_14g where level = 'account' and window_key = 'prev14';
  if v_num is distinct from v_num2 then raise exception 'KO P: spesa prev14 tabella % vista %', v_num, v_num2; end if;
  select count(*) into v_n
  from v_ads_periodo_14g p
  left join meta_ads_window_reach w on w.level = p.level and w.object_id = p.object_id and w.window_key = p.window_key
                                   and w.since = p.since and w.until = p.until
  where p.frequency is distinct from round(w.frequency, 2) or p.reach is distinct from w.reach;
  if v_n > 0 then raise exception 'KO P: % righe con reach/frequency che non vengono dalla stessa finestra', v_n; end if;
  select count(*) || ' righe, ' || count(*) filter (where w.since = case w.window_key when 'cur14' then v_as_of - 13 else v_as_of - 27 end
                                                       and w.until = case w.window_key when 'cur14' then v_as_of else v_as_of - 14 end)
         || ' sulle finestre di oggi'
    into v_reach from meta_ads_window_reach w;
  select count(*) filter (where video_3s_views is not null) || ' giorni ad con video misurato, ultimo '
         || coalesce(max(date) filter (where video_3s_views is not null)::text, 'mai')
    into v_video from meta_ads_creative_daily;

  -- A
  foreach v_r in array array['anon', 'authenticated'] loop
    perform set_config('role', v_r, true);
    select count(*) into v_n from v_ads_swap;
    if v_n <> v_m then raise exception 'KO A %: v_ads_swap da'' % righe, attese %', v_r, v_n, v_m; end if;
    select count(*) into v_n from v_ads_periodo_14g;
    if v_n <> v_righe_periodo then raise exception 'KO A %: v_ads_periodo_14g da'' % righe, attese %', v_r, v_n, v_righe_periodo; end if;
    select count(*) into v_n from meta_ads_window_reach;
    if v_n <> 0 then raise exception 'KO A %: legge % righe di meta_ads_window_reach (RLS)', v_r, v_n; end if;
    v_st := 'ok';
    begin
      insert into meta_ads_window_reach (level, object_id, window_key, since, until) values ('ad', 'x', 'cur14', v_as_of, v_as_of);
    exception when others then v_st := sqlstate;
    end;
    if v_st <> '42501' then raise exception 'KO A %: insert su meta_ads_window_reach = % (atteso 42501)', v_r, v_st; end if;
    reset role;
  end loop;

  raise exception 'TEST_OK: M S P A verdi, dati al %; v_ads_swap % righe (%); v_ads_periodo_14g % righe; meta_ads_window_reach %; video: % (rollback voluto)',
    v_as_of, v_m, v_stati, v_righe_periodo, v_reach, v_video;
end $t$;
