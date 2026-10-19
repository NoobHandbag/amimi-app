-- 0166_push_eventi.sql (2026-10-18): eventi che mandano notifiche a ciascun profilo, primo lotto (modulo push_*, Regola
-- Ferrea 19). Brief: Cowork12/_CLAUDE_CODE_INBOX/2026-10-18_BRIEF_push_eventi_per_profilo.md (sez. 3.1).
--
-- Tutto nasce SPENTO: push_eventi_enabled = 'false' e i sei eventi con attivo = false. Il cron chiama la edge push-eventi
-- ogni 5 minuti, ma a flag spento il giro e' NO-OP; con il flag acceso un evento spento non legge e non manda.
-- Rollback = push_eventi_enabled a 'false', senza deploy. push_enabled e push_canale_guardie non si toccano: le guardie
-- (temi conti e vendite) continuano come prima.
--
-- Solo tabelle push_* (push_temi e' del modulo, non core) e app_flags; del core si scrive solo change_log, come le
-- migrazioni dei cron 0138 e 0148, piu' la funzione di salute del modulo (passo 9b, Gate 3 del 18-10) che scrive la SUA
-- riga di telemetria in health_log come loyalty_health_check della 0137. Postura di 0163: RLS accesa, nessuna policy,
-- revoke a public, anon e authenticated.
-- Idempotenza a DB (Regola 20): push_eventi_inviati ha UNIQUE (evento, chiave), la edge prenota con un insert su quel
-- vincolo e chi non riesce a prenotare salta; un controllo "esiste gia'?" scritto solo nel codice non basta.
-- updated_at senza trigger, come in 0163: lo scrive la edge a ogni cambio di stato.
--
-- Rieseguibile: ogni riga nasce con on conflict do nothing e la prova finale pretende i valori di nascita solo dalle
-- righe nate in questa esecuzione (insert ... returning), cosi' una modifica fatta a mano dopo non viene sovrascritta
-- ne' fa fallire un re-run.
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto. Le impostazioni amimi.* della transazione non
--    possono avere un pezzo che inizia con una cifra: 'amimi.0166_x' e' rifiutato con 42602 (misurato il 18-10).
do $$ begin
  perform set_config('amimi.push_eventi_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.push_eventi_canale_prima', coalesce((select value from app_flags where key = 'push_canale_guardie'), '<assente>'), true);
  perform set_config('amimi.push_eventi_predef_nata_qui',
    (not exists (select 1 from pg_attribute a where a.attrelid = 'public.push_temi'::regclass and a.attname = 'predefinito_per' and not a.attisdropped))::text, true);
  perform set_config('amimi.push_eventi_cron_nato_qui', (not exists (select 1 from cron.job where jobname = 'push-eventi'))::text, true);
  perform set_config('amimi.push_eventi_salute_cron_nato_qui', (not exists (select 1 from cron.job where jobname = 'push-eventi-salute'))::text, true);
end $$;

-- 1) interruttore del modulo: nasce SPENTO, una riaccensione manuale non viene sovrascritta da un re-run
do $$ begin
  insert into app_flags (key, value) values ('push_eventi_enabled', 'false') on conflict (key) do nothing;
  perform set_config('amimi.push_eventi_flag_nato_qui', found::text, true);
end $$;

-- 2) per chi un tema parte spuntato alla PRIMA iscrizione di un telefono (scheda Notifiche); dopo valgono i temi salvati.
--    Valori = chiavi di PEOPLE del web, come il check di push_subscriptions.chi (Bene = Benny, Ginevra = Ginni).
alter table push_temi add column if not exists predefinito_per text[] not null default '{}';
alter table push_temi drop constraint if exists push_temi_predefinito_per_ck;
alter table push_temi add constraint push_temi_predefinito_per_ck
  check (predefinito_per <@ array['Ale', 'Bene', 'Ginevra']::text[]);
comment on column push_temi.predefinito_per is 'Persone (chiavi di PEOPLE: Ale, Bene, Ginevra) per cui il tema parte spuntato alla prima iscrizione di un telefono.';

-- conti e vendite (le guardie) solo ad Ale: e' il destinatario di oggi. Solo se la colonna e' nata qui.
update push_temi set predefinito_per = array['Ale']
 where key in ('conti', 'vendite') and current_setting('amimi.push_eventi_predef_nata_qui', true) = 'true';

-- 3) temi nuovi. Decisione di Dan del 18-10: l'Assistenza (e le spedizioni) solo a Ginni; il riepilogo a tutti, ma
--    ognuno riceve il SUO (push-api invia con chi). ordine a passi di 10 come 0163.
do $$
declare
  v_nati text[];
begin
  with ins as (
    insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values
      ('negozi',     'Negozi B2B',          'Quando un negozio contattato risponde',                       30, array['Ale', 'Bene']),
      ('assistenza', 'Assistenza',          'Quando una richiesta diventa urgente o una cliente riscrive', 40, array['Ginevra']),
      ('spedizioni', 'Spedizioni bloccate', 'Quando il corriere segnala un problema su una spedizione',    50, array['Ginevra']),
      ('sistema',    'Sistema',             'Quando la lettura della posta clienti si ferma',              60, array['Ale']),
      ('riepilogo',  'Riepilogo serale',    'I numeri della giornata, alle 18:30 (domenica esclusa)',      70, array['Ale', 'Bene', 'Ginevra'])
    on conflict (key) do nothing
    returning key)
  select coalesce(array_agg(key), '{}') into v_nati from ins;
  perform set_config('amimi.push_eventi_temi_nati_qui', array_to_string(v_nati, ','), true);
end $$;

-- 4) un interruttore per evento: gli eventi si accendono uno alla volta, dopo l'anteprima della edge.
--    baseline_at: quando la edge ha segnato come gia' visto il pregresso (prima accensione o ripartenza dopo uno stallo),
--    null = mai. ultimo_giro_at: fine dell'ultimo giro riuscito dell'evento; lo usa la edge (stallo oltre 2 ore) e lo
--    guarda push_eventi_salute (passo 9b). Il battito che si VEDE sono le righe health_log 'push_eventi' (la edge, a
--    ogni giro) e 'push_eventi_fresh' (la funzione): Gate 3 del 18-10, MIG-B1, prima nessuno leggeva questa colonna.
--    soglie: parametri dell'evento letti dalla edge; '{}' = valori di default del codice.
--    Nome evento: minuscole, cifre e trattino basso, inizia con una lettera. La prima stesura (solo [a-z_]) rifiutava
--    b2b_risposta_negozio e la migrazione cadeva all'insert dei sei eventi (integrazione del 18-10, misurato con una SELECT).
create table if not exists push_eventi (
  evento          text primary key,
  tema            text not null,
  attivo          boolean not null default false,
  descrizione     text,
  soglie          jsonb not null default '{}',
  baseline_at     timestamptz,
  ultimo_giro_at  timestamptz,
  constraint push_eventi_tema_fk foreign key (tema) references push_temi (key),
  constraint push_eventi_evento_ck check (evento ~ '^[a-z][a-z0-9_]{1,47}$'),
  constraint push_eventi_soglie_ck check (jsonb_typeof(soglie) = 'object')
);

-- 5) registro degli invii: una riga per (evento, chiave), prenotata PRIMA di inviare. 'nessun_iscritto' e' un esito a
--    se' (nessun telefono iscritto al tema), non un errore da ritentare; 'saltato' = pregresso segnato senza inviare.
create table if not exists push_eventi_inviati (
  id          bigint generated always as identity primary key,
  evento      text not null,
  chiave      text not null,
  stato       text not null,
  tentativi   int not null default 0,
  esito       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_eventi_inviati_evento_fk foreign key (evento) references push_eventi (evento),
  constraint push_eventi_inviati_uk unique (evento, chiave),
  constraint push_eventi_inviati_stato_ck check (stato in ('prenotato', 'inviato', 'fallito', 'saltato', 'nessun_iscritto')),
  constraint push_eventi_inviati_chiave_ck check (char_length(chiave) between 1 and 500),
  constraint push_eventi_inviati_tentativi_ck check (tentativi >= 0)
);

comment on table push_eventi is 'Notifiche per profilo: un interruttore per evento della edge push-eventi. Solo service_role.';
comment on table push_eventi_inviati is 'Notifiche per profilo: registro degli invii, una riga per (evento, chiave) prenotata prima di inviare. Solo service_role.';

-- 6) i sei eventi del primo lotto, tutti spenti. cs_cliente_ha_riscritto resta spento anche all'accensione del lotto,
--    finche' non c'e' il fix sui "grazie" (CASI_APERTI n.22).
do $$
declare
  v_nati text[];
begin
  with ins as (
    insert into push_eventi (evento, tema, attivo, descrizione) values
      ('b2b_risposta_negozio',    'negozi',     false, 'Un negozio contattato ha risposto davvero (non bounce, risposta automatica o opt-out)'),
      ('cs_urgente',              'assistenza', false, 'Una richiesta di Assistenza diventa urgente (regole, AI o sollecito)'),
      ('cs_cliente_ha_riscritto', 'assistenza', false, 'Una conversazione chiusa da sola si riapre perche'' la cliente ha riscritto. Spento fino al fix sui "grazie" (CASI_APERTI n.22)'),
      ('spedizione_eccezione',    'spedizioni', false, 'Il corriere segnala un problema su una spedizione (v_spedizioni_eccezioni, classe eccezione)'),
      ('sistema_cs_sync_fermo',   'sistema',    false, 'La lettura della posta clienti e'' ferma o in errore (health_log cs_sync)'),
      ('riepilogo',               'riepilogo',  false, 'Riepilogo serale, uno a testa: 18:30 ora di Roma, lunedi''-sabato, solo se almeno una voce non e'' zero')
    on conflict (evento) do nothing
    returning evento)
  select coalesce(array_agg(evento), '{}') into v_nati from ins;
  perform set_config('amimi.push_eventi_eventi_nati_qui', array_to_string(v_nati, ','), true);
end $$;

-- 7) sicurezza, come 0163. La sequenza dell'identity riceve dai default privileges di Supabase anche anon e authenticated
--    (rwU, misurato il 18-10 sulle altre identity): si toglie. L'insert dell'identity non chiede privilegi sulla sequenza,
--    il grant al service_role e' esplicito solo per non dipendere da quei default.
alter table push_eventi enable row level security;
alter table push_eventi_inviati enable row level security;
revoke all on push_eventi, push_eventi_inviati from public, anon, authenticated;
grant select, insert, update, delete on push_eventi, push_eventi_inviati to service_role;

do $$
declare
  v_seq text := pg_get_serial_sequence('public.push_eventi_inviati', 'id');
begin
  if v_seq is null then raise exception '0166: sequenza di push_eventi_inviati.id non trovata'; end if;
  execute format('revoke all on sequence %s from public, anon, authenticated', v_seq);
  execute format('grant usage, select on sequence %s to service_role', v_seq);
end $$;

-- 8) i telefoni gia' iscritti ricevono i temi NATI QUI che spettano al loro profilo, come se si iscrivessero oggi (brief
--    3.1: oggi e' il solo Android di Ale, che prende negozi, sistema e riepilogo). Si aggiunge e basta, senza doppioni,
--    nell'ordine dei temi: le scelte gia' fatte dal telefono restano. Su un re-run i temi esistono gia', quindi non si
--    rimette un tema che il telefono ha tolto nel frattempo. change_log tiene il prima e il dopo (solo i temi).
--    Nessun `return` nei blocchi DO (MIG-C2, Gate 3 del 18-10): nella prova annullata prima dell'apply ogni DO diventa un
--    blocco annidato di UN solo DO, e un return uscirebbe da quello saltando cron, prova finale e l'eccezione TEST_OK
--    (la prova diventerebbe un apply vero). Il corpo si salta con un if.
do $$
declare
  v_nati text[] := string_to_array(nullif(current_setting('amimi.push_eventi_temi_nati_qui', true), ''), ',');
begin
  if v_nati is not null then
    with prima as (
      select s.id, s.temi from push_subscriptions s
       where exists (select 1 from push_temi t where t.key = any(v_nati) and s.chi = any(t.predefinito_per) and not (t.key = any(s.temi)))
       for update),
    agg as (
      update push_subscriptions s
         set temi = s.temi || array(select t.key from push_temi t
                                     where t.key = any(v_nati) and s.chi = any(t.predefinito_per) and not (t.key = any(s.temi))
                                     order by t.ordine, t.key),
             updated_at = now()
        from prima p
       where s.id = p.id
      returning s.id, p.temi as temi_prima, s.temi as temi_dopo)
    insert into change_log (tbl, row_id, op, before, after, chi, source)
    select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),
           jsonb_build_object('temi', temi_dopo, 'migr', '0166_push_eventi'), 'claude-code', 'push-eventi'
      from agg;
  end if;
end $$;

-- 9) cron del modulo, stesso schema degli altri (0138, 0148): net.http_post col PIN neutro, quello che hanno tutti i cron.
--    Minuti 1, 6, 11...: fuori da cs-classify (multipli di 5) e dai giri orari :07 :10 :17 :20 :25 :27 :30 :40 :50 :55;
--    cs-sync gira ogni 2 minuti e non si puo' evitare.
--    timeout_milliseconds 60000: col default di 5 secondi pg_net registra "timeout" un giro che ha solo impiegato di piu'
--    (critica del 18-10), e il giro manda fino al suo tetto di push una dopo l'altra. cron.schedule sullo stesso nome
--    aggiorna il job invece di crearne un secondo. Il comando sta fra $cmd$ e non fra $$: la prova in un blocco DO
--    annullato prima dell'apply (CONOSCENZA, 17-10) lo incolla cosi' com'e'.
-- Fermo d'emergenza: update app_flags set value = 'false' where key = 'push_eventi_enabled' (il giro diventa NO-OP)
-- oppure select cron.alter_job((select jobid from cron.job where jobname = 'push-eventi'), active := false).
select cron.schedule('push-eventi', '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/push-eventi',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","pin":"x","source":"cron"}'::jsonb,
       timeout_milliseconds := 60000
     ) $cmd$);

insert into change_log (tbl, row_id, op, after, chi, source)
select 'cron.job', 'push-eventi', 'cron_create',
       '{"schedule":"1,6,11,16,21,26,31,36,41,46,51,56 * * * *","edge":"push-eventi","action":"run","migr":"0166_push_eventi","gate":"app_flags.push_eventi_enabled"}'::jsonb,
       'claude-code', 'push-eventi'
 where current_setting('amimi.push_eventi_cron_nato_qui', true) = 'true';

-- 9b) salute del giro (MIG-B1, Gate 3 del 18-10). Una edge ferma (cron spento, errore all'avvio, bundle rotto da un deploy
--     di _shared/push.ts) non scrive niente, quindi la sua riga health_log 'push_eventi' non puo' dirlo da sola. Questa
--     funzione e' del modulo (Regola 19: niente innesti in ce-guard o in refresh_health_log): guarda ultimo_giro_at degli
--     eventi accesi e scrive health_log k = 'push_eventi_fresh' (upsert sul giorno UTC, current_date come
--     refresh_health_log). error = un evento acceso col giro fermo da oltre 30 minuti (anche un solo evento che fallisce
--     a ogni giro); warn = acceso e mai girato (appena acceso il primo giro arriva entro 5 minuti); ok altrimenti. A
--     modulo spento (push_eventi_enabled o push_enabled diversi da 'true') non scrive niente, come la edge. Cron alle :03
--     e :33, fuori dai minuti del giro; refresh_health_log delle 06:00 UTC cancella le righe del giorno e questa torna
--     alle 06:03. Nella label solo nomi di eventi (vincolo push_eventi_evento_ck) e numeri.
create or replace function public.push_eventi_salute() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_attivi int;
  v_n int;
  v_fermi text;
  v_mai text;
begin
  if exists (select 1 from app_flags where key = 'push_eventi_enabled' and lower(btrim(value, E' \t\r\n')) = 'true')
     and exists (select 1 from app_flags where key = 'push_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    select count(*) filter (where e.attivo),
           count(*) filter (where e.attivo and (e.ultimo_giro_at is null or e.ultimo_giro_at < now() - interval '30 minutes')),
           string_agg(e.evento, ', ' order by e.evento) filter (where e.attivo and e.ultimo_giro_at < now() - interval '30 minutes'),
           string_agg(e.evento, ', ' order by e.evento) filter (where e.attivo and e.ultimo_giro_at is null)
      into v_attivi, v_n, v_fermi, v_mai
      from push_eventi e;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'push_eventi_fresh',
            case when v_fermi is not null then 'giro fermo da oltre 30 minuti: ' || v_fermi || coalesce('; accesi e mai girati: ' || v_mai, '')
                 when v_mai is not null then 'accesi e mai girati: ' || v_mai
                 else 'eventi accesi: ' || v_attivi || ', giro visto negli ultimi 30 minuti' end,
            v_n,
            case when v_fermi is not null then 'error' when v_mai is not null then 'warn' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;
  end if;
end $fn$;
revoke all on function public.push_eventi_salute() from public, anon, authenticated;
grant execute on function public.push_eventi_salute() to service_role;

select cron.schedule('push-eventi-salute', '3,33 * * * *', $cmd$ select public.push_eventi_salute() $cmd$);

insert into change_log (tbl, row_id, op, after, chi, source)
select 'cron.job', 'push-eventi-salute', 'cron_create',
       '{"schedule":"3,33 * * * *","fn":"push_eventi_salute","health_log":"push_eventi_fresh","migr":"0166_push_eventi","gate":"app_flags.push_eventi_enabled"}'::jsonb,
       'claude-code', 'push-eventi'
 where current_setting('amimi.push_eventi_salute_cron_nato_qui', true) = 'true';

-- 10) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa.
--     `create table if not exists` e `add column if not exists` saltano in silenzio se l'oggetto esiste gia' (C2 della
--     0128): colonne, tipi e vincoli si contano qui.
do $$
declare
  t text;
  r name;
  v_vincolo text;
  v_grant text;
  v_val text;
  v_seq regclass := pg_get_serial_sequence('public.push_eventi_inviati', 'id')::regclass;
  v_cron record;
  v_atteso record;
  v_temi_nati text[] := coalesce(string_to_array(nullif(current_setting('amimi.push_eventi_temi_nati_qui', true), ''), ','), '{}');
  v_eventi_nati text[] := coalesce(string_to_array(nullif(current_setting('amimi.push_eventi_eventi_nati_qui', true), ''), ','), '{}');
  c_schedule constant text := '1,6,11,16,21,26,31,36,41,46,51,56 * * * *';
  c_schedule_salute constant text := '3,33 * * * *';
begin
  if current_setting('amimi.push_eventi_flag_nato_qui', true) is null or current_setting('amimi.push_eventi_predef_nata_qui', true) is null
     or current_setting('amimi.push_eventi_cron_nato_qui', true) is null or current_setting('amimi.push_eventi_temi_nati_qui', true) is null
     or current_setting('amimi.push_eventi_eventi_nati_qui', true) is null or current_setting('amimi.push_eventi_salute_cron_nato_qui', true) is null then
    raise exception '0166: manca una lettura iniziale (cosa e'' nato in questa migrazione)';
  end if;

  -- tabelle nuove: RLS accesa, nessuna policy, niente ad anon e authenticated, tutto al service_role
  foreach t in array array['push_eventi', 'push_eventi_inviati'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then
      raise exception '0166: RLS spenta su %', t;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass) then
      raise exception '0166: % ha una policy, deve restare senza (solo service_role)', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r, 'public.' || t, 'select, insert, update, references') then
        raise exception '0166: % ha ancora privilegi su %', r, t;
      end if;
    end loop;
    if not (has_table_privilege('service_role', 'public.' || t, 'select') and has_table_privilege('service_role', 'public.' || t, 'insert')
            and has_table_privilege('service_role', 'public.' || t, 'update') and has_table_privilege('service_role', 'public.' || t, 'delete')) then
      raise exception '0166: service_role non legge e scrive % (push-eventi non funzionerebbe)', t;
    end if;
  end loop;

  if v_seq is null then raise exception '0166: sequenza di push_eventi_inviati.id mancante'; end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_sequence_privilege(r, v_seq, 'usage, select, update') then
      raise exception '0166: % ha ancora privilegi sulla sequenza %', r, v_seq;
    end if;
  end loop;
  if not has_sequence_privilege('service_role', v_seq, 'usage') then
    raise exception '0166: service_role senza usage sulla sequenza %', v_seq;
  end if;

  -- grant diretti di qualunque tipo (anche MAINTAIN di PG17) a PUBLIC, anon e authenticated, tabelle e sequenza
  select string_agg(format('%s a %s su %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC'), cl.relname), ', ' order by cl.relname)
    into v_grant
    from pg_class cl
    cross join lateral aclexplode(cl.relacl) a
    left join pg_roles g on g.oid = a.grantee
   where cl.oid in ('public.push_eventi'::regclass, 'public.push_eventi_inviati'::regclass, v_seq)
     and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'));
  if v_grant is not null then raise exception '0166: privilegi di troppo: %', v_grant; end if;

  foreach v_vincolo in array array['push_temi_predefinito_per_ck', 'push_eventi_tema_fk', 'push_eventi_evento_ck', 'push_eventi_soglie_ck',
                                   'push_eventi_inviati_evento_fk', 'push_eventi_inviati_uk', 'push_eventi_inviati_stato_ck',
                                   'push_eventi_inviati_chiave_ck', 'push_eventi_inviati_tentativi_ck'] loop
    if not exists (select 1 from pg_constraint k where k.conname = v_vincolo and k.connamespace = 'public'::regnamespace) then
      raise exception '0166: vincolo mancante %', v_vincolo;
    end if;
  end loop;
  -- la prenotazione della edge (on conflict su evento e chiave) regge solo se il vincolo e' esattamente su quelle due
  if (select pg_get_constraintdef(k.oid) from pg_constraint k
       where k.conname = 'push_eventi_inviati_uk' and k.conrelid = 'public.push_eventi_inviati'::regclass)
     is distinct from 'UNIQUE (evento, chiave)' then
    raise exception '0166: push_eventi_inviati_uk non e'' UNIQUE (evento, chiave)';
  end if;
  if not exists (select 1 from pg_constraint k where k.conname = 'push_eventi_tema_fk' and k.contype = 'f'
                   and k.conrelid = 'public.push_eventi'::regclass and k.confrelid = 'public.push_temi'::regclass)
     or not exists (select 1 from pg_constraint k where k.conname = 'push_eventi_inviati_evento_fk' and k.contype = 'f'
                   and k.conrelid = 'public.push_eventi_inviati'::regclass and k.confrelid = 'public.push_eventi'::regclass) then
    raise exception '0166: chiavi esterne di push_eventi o push_eventi_inviati diverse dal contratto';
  end if;

  -- le colonne sono il contratto con push-eventi e push-api: una tabella o colonna preesistente diversa non deve passare
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.push_temi'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'key,etichetta,descrizione,ordine,attivo,predefinito_per' then
    raise exception '0166: colonne di push_temi diverse dal contratto';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.push_temi'::regclass and a.attname = 'predefinito_per'
                   and not a.attisdropped and a.attnotnull and format_type(a.atttypid, a.atttypmod) = 'text[]') then
    raise exception '0166: push_temi.predefinito_per deve essere text[] not null';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.push_eventi'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'evento,tema,attivo,descrizione,soglie,baseline_at,ultimo_giro_at' then
    raise exception '0166: colonne di push_eventi diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.push_eventi_inviati'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,evento,chiave,stato,tentativi,esito,created_at,updated_at' then
    raise exception '0166: colonne di push_eventi_inviati diverse dal contratto';
  end if;

  -- temi: tutti presenti; quelli nati qui con le persone giuste e attivi; conti e vendite ad Ale se la colonna e' nata qui
  for v_atteso in
    select * from (values ('negozi', array['Ale', 'Bene']), ('assistenza', array['Ginevra']), ('spedizioni', array['Ginevra']),
                          ('sistema', array['Ale']), ('riepilogo', array['Ale', 'Bene', 'Ginevra'])) x(k, persone)
  loop
    if not exists (select 1 from push_temi where key = v_atteso.k) then
      raise exception '0166: manca il tema %', v_atteso.k;
    end if;
    if v_atteso.k = any(v_temi_nati)
       and not exists (select 1 from push_temi where key = v_atteso.k and attivo and predefinito_per = v_atteso.persone) then
      raise exception '0166: il tema % nato qui non e'' attivo o non parte spuntato per %', v_atteso.k, v_atteso.persone;
    end if;
  end loop;
  if current_setting('amimi.push_eventi_predef_nata_qui', true) = 'true'
     and (select count(*) from push_temi where key in ('conti', 'vendite') and predefinito_per = array['Ale']) <> 2 then
    raise exception '0166: conti e vendite devono partire spuntati per la sola Ale';
  end if;

  -- eventi: i sei presenti; quelli nati qui sul tema giusto, spenti e senza soglie
  for v_atteso in
    select * from (values ('b2b_risposta_negozio', 'negozi'), ('cs_urgente', 'assistenza'), ('cs_cliente_ha_riscritto', 'assistenza'),
                          ('spedizione_eccezione', 'spedizioni'), ('sistema_cs_sync_fermo', 'sistema'), ('riepilogo', 'riepilogo')) x(ev, tema)
  loop
    if not exists (select 1 from push_eventi where evento = v_atteso.ev) then
      raise exception '0166: manca l''evento %', v_atteso.ev;
    end if;
    if v_atteso.ev = any(v_eventi_nati)
       and not exists (select 1 from push_eventi where evento = v_atteso.ev and tema = v_atteso.tema and attivo = false
                         and soglie = '{}'::jsonb and baseline_at is null and ultimo_giro_at is null) then
      raise exception '0166: l''evento % nato qui non e'' spento sul tema %', v_atteso.ev, v_atteso.tema;
    end if;
  end loop;

  -- iscrizioni: nessun telefono senza un tema nato qui che spetta al suo profilo, e nessun tema doppio
  if exists (select 1 from push_subscriptions s join push_temi pt on pt.key = any(v_temi_nati) and s.chi = any(pt.predefinito_per)
              where not (pt.key = any(s.temi))) then
    raise exception '0166: un telefono iscritto non ha ricevuto i temi nuovi del suo profilo';
  end if;
  if exists (select 1 from push_subscriptions s where cardinality(s.temi) <> (select count(distinct x) from unnest(s.temi) x)) then
    raise exception '0166: un telefono iscritto ha un tema doppio';
  end if;

  -- interruttori: il nuovo nasce spento, quelli che esistevano non cambiano
  select value into v_val from app_flags where key = 'push_eventi_enabled';
  if not found then raise exception '0166: manca app_flags.push_eventi_enabled'; end if;
  if current_setting('amimi.push_eventi_flag_nato_qui', true) = 'true' and v_val is distinct from 'false' then
    raise exception '0166: push_eventi_enabled nato qui vale % invece di false', v_val;
  end if;
  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.push_eventi_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_canale_guardie'), '<assente>') is distinct from current_setting('amimi.push_eventi_canale_prima', true) then
    raise exception '0166: push_enabled o push_canale_guardie cambiati dalla migrazione';
  end if;

  -- cron: uno solo, ogni 5 minuti, verso push-eventi azione run col timeout lungo; attivo se nato qui
  if (select count(*) from cron.job where jobname = 'push-eventi') <> 1 then
    raise exception '0166: il job cron push-eventi deve esistere una volta sola';
  end if;
  select schedule, command, active into v_cron from cron.job where jobname = 'push-eventi';
  if v_cron.schedule is distinct from c_schedule then
    raise exception '0166: cron push-eventi con schedule % invece di %', v_cron.schedule, c_schedule;
  end if;
  if position('/functions/v1/push-eventi''' in v_cron.command) = 0 or position('"action":"run"' in v_cron.command) = 0
     or position('timeout_milliseconds := 60000' in v_cron.command) = 0 then
    raise exception '0166: il comando del cron push-eventi non chiama la edge con action run e timeout 60000';
  end if;
  if current_setting('amimi.push_eventi_cron_nato_qui', true) = 'true' and not v_cron.active then
    raise exception '0166: cron push-eventi nato qui ma non attivo';
  end if;

  -- salute del giro (9b): la funzione c'e', security definer, la esegue solo il service_role; il suo cron una volta sola
  if to_regprocedure('public.push_eventi_salute()') is null then
    raise exception '0166: manca la funzione push_eventi_salute()';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.push_eventi_salute()'::regprocedure) then
    raise exception '0166: push_eventi_salute() deve essere security definer';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.push_eventi_salute()', 'execute') then
      raise exception '0166: % puo'' eseguire push_eventi_salute()', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.push_eventi_salute()', 'execute') then
    raise exception '0166: service_role non esegue push_eventi_salute()';
  end if;
  if (select count(*) from cron.job where jobname = 'push-eventi-salute') <> 1 then
    raise exception '0166: il job cron push-eventi-salute deve esistere una volta sola';
  end if;
  select schedule, command, active into v_cron from cron.job where jobname = 'push-eventi-salute';
  if v_cron.schedule is distinct from c_schedule_salute or position('public.push_eventi_salute()' in v_cron.command) = 0 then
    raise exception '0166: cron push-eventi-salute con schedule % o comando diversi dal contratto', v_cron.schedule;
  end if;
  if current_setting('amimi.push_eventi_salute_cron_nato_qui', true) = 'true' and not v_cron.active then
    raise exception '0166: cron push-eventi-salute nato qui ma non attivo';
  end if;
end $$;

commit;
