-- tests/ads_swap_viste.sql: prova VIVA della migr 0175 (cruscotto Ads, quando cambiare una creativita'), da lanciare
-- DOPO l'apply. Solo letture, piu' due scritture che non restano: l'insert che anon e authenticated NON devono poter
-- fare e la vista temporanea del replay F. Si incolla in UNA chiamata execute_sql (o psql): e' un unico blocco DO che
-- alla fine alza SEMPRE un'eccezione.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- In produzione plpgsql.variable_conflict vale 'error': le variabili hanno il prefisso v_ per non chiamarsi come una
-- colonna delle tabelle e viste lette qui.
-- Cosa prova:
--   M  oggetti della 0175 presenti: colonne video, meta_ads_window_reach con PK, RLS on e nessuna policy
--   V  v_fonti_freschezza (X1): le 10 colonne della 0109 nello stesso ordine, meta_ads_creative_ultimo_giorno in coda
--      = max(date) del daily, grant di anon, authenticated e ask_ro rimasti
--   S  v_ads_swap: una riga per ogni ad ACTIVE o con spesa negli ultimi 14 giorni, nessun doppio, stato/ordine coerenti
--   R  (C2/X3, B2) pubblico, soglia, segnali, freq_mancante e scala dello stato RICALCOLATI dalle colonne esposte con le
--      costanti dell'owner scritte qui a mano; testi del motivo (nuova, ok misurato, base senza click, freq non letta)
--   F  (B1) frequency non letta = mai "sotto soglia" in silenzio; replay della vista viva col join della freq7 spostato
--      su un giorno che non esiste (giro della freq7 saltato)
--   P  v_ads_periodo_14g: due finestre per oggetto; le righe ad, adset e campagna sommano come l'account per finestra;
--      la spesa dell'account e' quella della tabella; reach/frequency solo dalla finestra uguale di meta_ads_window_reach
--   A  anon e authenticated leggono le viste come il proprietario, 0 righe di meta_ads_window_reach, niente insert
do $t$
declare
  v_as_of date;
  v_dt date;
  v_n int;
  v_k int;
  v_m int;
  v_num numeric;
  v_num2 numeric;
  v_st text;
  v_r text;
  v_stati text;
  v_reach text;
  v_video text;
  v_cols text;
  v_def text;
  v_replay text;
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

  -- V
  select string_agg(attname, ',' order by attnum) into v_cols from pg_attribute
   where attrelid = 'public.v_fonti_freschezza'::regclass and attnum > 0 and not attisdropped;
  if v_cols is distinct from 'ultimo_ordine_shopify,ultimo_sync_ordini,ultima_vendita_qromo,meta_ads_ultimo_giorno,'
       || 'meta_ads_ultimo_pull,ultimo_batch_spedizioni,ultimo_sync_stock,ultimo_health,ultima_spesa_pagata,ultimo_arrivo,'
       || 'meta_ads_creative_ultimo_giorno' then
    raise exception 'KO V: colonne di v_fonti_freschezza = %', v_cols;
  end if;
  select meta_ads_creative_ultimo_giorno into v_dt from v_fonti_freschezza;
  if v_dt is distinct from v_as_of then raise exception 'KO V: meta_ads_creative_ultimo_giorno % contro max(date) %', v_dt, v_as_of; end if;
  foreach v_r in array array['anon', 'authenticated', 'ask_ro'] loop
    if not has_table_privilege(v_r, 'public.v_fonti_freschezza', 'select') then
      raise exception 'KO V: % ha perso il SELECT su v_fonti_freschezza', v_r;
    end if;
  end loop;

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
   where stato is null or motivo is null or as_of is distinct from v_as_of or freq_mancante is null
      or stato not in ('cambia', 'osserva', 'nuova', 'ok', 'senza_consegna', 'in_pausa')
      or ordine is distinct from case stato when 'cambia' then 1 when 'osserva' then 2 when 'nuova' then 3
                                            when 'ok' then 4 when 'senza_consegna' then 5 else 6 end;
  if v_n > 0 then raise exception 'KO S: % righe con stato, ordine, motivo, freq_mancante o as_of fuori posto', v_n; end if;
  select count(*) into v_n from v_ads_swap
   where (stato = 'in_pausa') <> (coalesce(effective_status, '') <> 'ACTIVE')
      or (stato = 'cambia' and not (segnale_spesa or (segnale_freq and segnale_ctr)))
      or (stato in ('nuova', 'ok', 'senza_consegna') and (segnale_spesa or segnale_freq or segnale_ctr));
  if v_n > 0 then raise exception 'KO S: % righe con lo stato in disaccordo coi segnali', v_n; end if;
  select string_agg(stato || ' ' || n, ', ' order by o) into v_stati
  from (select stato, min(ordine) o, count(*) n from v_ads_swap group by stato) q;

  -- R: costanti dell'owner A MANO (4.0 e 2.5 frequency, 0.75 calo del CTR, 1000 impression, 76.70 pareggio, 300
  --    consegna, 21 giorni) e stessa regex del pubblico: cambiarne una nel CTE k della vista senza questo file e' un KO
  with a as (
    select s.*,
      case when coalesce(s.campaign_name, '') ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'
             or coalesce(s.adset_name, '') ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'
           then 'retargeting' else 'cold' end as r_pubblico
    from v_ads_swap s
  ), b as (
    select a.*, case when a.r_pubblico = 'retargeting' then 4.0 else 2.5 end as r_soglia from a
  ), c as (
    select b.*,
      coalesce(b.freq_7g >= b.r_soglia, false) as r_freq,
      coalesce(b.impressions_7 >= 1000 and b.impressions_base >= 1000 and b.link_ctr_base > 0
               and b.link_ctr_7 <= 0.75 * b.link_ctr_base, false) as r_ctr,
      coalesce(b.spend_14 >= 76.70 and b.purchases_14 = 0, false) as r_spesa,
      (coalesce(b.effective_status, '') = 'ACTIVE' and b.impressions_7 >= 300
       and not exists (select 1 from meta_ad_freq7 f where f.ad_id = b.ad_id and f.day = b.as_of and f.freq_7d is not null))
        as r_freq_mancante
    from b
  ), d as (
    select c.*,
      case when coalesce(c.effective_status, '') <> 'ACTIVE' then 'in_pausa'
           when c.r_spesa or (c.r_freq and c.r_ctr) then 'cambia'
           when c.r_freq or c.r_ctr then 'osserva'
           when c.impressions_7 < 300 then 'senza_consegna'
           when c.impressions_base < 1000 and coalesce(c.giorni_live, 0) < 21 then 'nuova'
           else 'ok' end as r_stato
    from c
  )
  select count(*) filter (where (pubblico, freq_soglia, segnale_freq, segnale_ctr, segnale_spesa, freq_mancante, stato)
                                is distinct from (r_pubblico, r_soglia, r_freq, r_ctr, r_spesa, r_freq_mancante, r_stato)),
         count(*) filter (where segnale_ctr and (ctr_var_pct is null or coalesce(motivo, '') = ''))
    into v_n, v_k
  from d;
  if v_n > 0 then raise exception 'KO R: % righe dove pubblico, soglia, segnali, freq_mancante o stato non tornano col ricalcolo', v_n; end if;
  if v_k > 0 then raise exception 'KO R (B2): % righe con segnale_ctr senza variazione del CTR o senza motivo', v_k; end if;
  select count(*) into v_n from v_ads_swap
   where freq_al is distinct from (select max(day) from meta_ad_freq7)
      or (stato = 'nuova' and not starts_with(motivo, 'base di confronto non ancora completa (' || impressions_base
                                               || ' impression nei primi 14 giorni, live da ' || coalesce(giorni_live, 0) || ' giorni)'))
      or (stato = 'ok' and starts_with(motivo, 'nessun segnale di fatica misurato') is distinct from freq_mancante)
      or (stato = 'ok' and impressions_base >= 1000 and coalesce(link_ctr_base, 0) = 0
          and position('nessun click sul link nei primi 14 giorni)' in motivo) = 0)
      or (freq_mancante and position('; frequency 7g non letta per il ' || to_char(as_of, 'DD-MM') || ': segnale non valutato' in motivo) = 0)
      or (not freq_mancante and position('frequency 7g non letta' in motivo) > 0);
  if v_n > 0 then raise exception 'KO R: % righe con freq_al o testo del motivo fuori posto', v_n; end if;

  -- F (B1): un ad attivo che consegna senza frequency letta non passa per "sotto soglia" in silenzio
  select count(*) into v_n from v_ads_swap
   where effective_status = 'ACTIVE' and impressions_7 >= 300 and freq_7g is null
     and position('frequency 7g non letta' in motivo) = 0;
  if v_n > 0 then raise exception 'KO F: % ad attivi che consegnano senza frequency e senza avviso nel motivo', v_n; end if;
  -- replay: la vista viva col solo join della freq7 spostato su un giorno che non esiste (as_of - 1000), come un giro
  -- di freq7 saltato (non as_of + 1: col daily di ieri fallito e la freq7 riuscita quel giorno esiste davvero). Ogni ad attivo
  -- che consegna deve avvisare; COLD_AD_2_v2_Lea Color (cambia il 28-10 per frequency e CTR) non finisce ok/osserva
  -- senza l'avviso. La vista temporanea sparisce col rollback del blocco.
  v_def := pg_get_viewdef('public.v_ads_swap'::regclass, true);
  if regexp_count(v_def, 'fq\.day = r\.d\M') <> 1 then
    raise exception 'KO F: join stretto fq.day = r.d trovato % volte nella vista (atteso 1)', regexp_count(v_def, 'fq\.day = r\.d\M');
  end if;
  execute 'create temp view v_ads_swap_replay as '
          || rtrim(regexp_replace(v_def, 'fq\.day = r\.d\M', 'fq.day = (r.d - 1000)'), E'; \n');
  select count(*) into v_n from v_ads_swap_replay
   where effective_status = 'ACTIVE' and impressions_7 >= 300
     and (not freq_mancante or freq_7g is not null or position('frequency 7g non letta' in motivo) = 0);
  if v_n > 0 then raise exception 'KO F replay: % ad attivi che consegnano senza l''avviso della frequency non letta', v_n; end if;
  select stato || ': ' || motivo into v_replay from v_ads_swap_replay where ad_name = 'COLD_AD_2_v2_Lea Color';
  if v_replay is not null and split_part(v_replay, ':', 1) in ('ok', 'osserva') and position('frequency 7g non letta' in v_replay) = 0 then
    raise exception 'KO F replay: COLD_AD_2_v2_Lea Color %', v_replay;
  end if;

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
    select meta_ads_creative_ultimo_giorno into v_dt from v_fonti_freschezza;
    if v_dt is distinct from v_as_of then raise exception 'KO A %: v_fonti_freschezza da'' % come ultimo giorno ad, atteso %', v_r, v_dt, v_as_of; end if;
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

  raise exception 'TEST_OK: M V S R F P A verdi, dati al %; v_ads_swap % righe (%); replay freq saltata: COLD_AD_2 %; v_ads_periodo_14g % righe; meta_ads_window_reach %; video: % (rollback voluto)',
    v_as_of, v_m, v_stati, coalesce(v_replay, 'assente'), v_righe_periodo, v_reach, v_video;
end $t$;
