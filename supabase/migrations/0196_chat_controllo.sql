-- 0196_chat_controllo.sql (2026-11-15): chat del sito, Fase 1 pezzo 8, il controllo giornaliero in sola lettura dell'HTML
-- della home (docs/PROPOSTA_chat_sito.md 4.6 punto 2, 8.10 riga 12, 13.5). Brief nel repo hub:
-- Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md. Numero 0196: la 0195 e' l'ultima in produzione e in
-- origin/main al 15-11 (pezzo 7).
--
-- Due cose, nessuna tabella nuova:
--   1) due chiavi di app_flags, lette SOLO da chat-controllo (e la prima anche da push-eventi): non da chat-api ne' dalla
--      scheda Chat, che hanno i loro elenchi chiusi.
--        chat_controllo_home       'copia' fino al go-live (si controlla la copia di prova del tema, dove l'embed e' in
--                                  Modalita' prova per scelta), 'amimi.it' dal go-live (il passaggio e' questo solo valore,
--                                  nella checklist del go-live), 'spento' = nessun controllo. Nasce 'copia'.
--        chat_controllo_anteprima  il link d'anteprima per i visitatori della copia (https://<token>-<negozio>.shopifypreview.com).
--                                  NON pubblico: sta in app_flags (nessun privilegio ad anon ne' ad authenticated, provato
--                                  qui sotto) e mai nel repo, che e' pubblico. Shopify lo tiene 2 giorni: scaduto o vuoto,
--                                  la copia resta "non controllata" in una riga ok, senza push. Si rinnova dal menu della
--                                  copia (procedura nel repo hub, Monitoraggio_e_Notifiche.md). Nasce vuoto.
--   2) il cron `chat-controllo` ogni giorno alle 08:07 UTC (09:07 di Roma d'inverno, 10:07 d'estate: dopo il refresh di
--      health_log delle 06:00 UTC, che cancella le righe di oggi; minuto 7, fuori da push-eventi e da chat-send) col PIN
--      neutro di tutti i cron. La edge fa al massimo due chiamate fuori (la pagina e amimi.it/apps/chat/config, ognuna
--      ritentata una volta) e scrive una riga health_log `chat_controllo`; una seconda chiamata nello stesso giorno col PIN
--      non fa niente.
-- La push la manda push-eventi v11 (chat_salute `embed:<giorno>`) leggendo quella riga: nessun evento nuovo.
-- Rollback: select cron.unschedule('chat-controllo'); oppure update app_flags set value = 'spento' where key =
-- 'chat_controllo_home' (nessun controllo, nessuna riga, nessuna push). Nessuna scrittura in change_log.
begin;

-- 1) le chiavi, senza sovrascrivere
do $$
declare
  v_nati int;
begin
  insert into app_flags (key, value) values
    ('chat_controllo_home', 'copia'),
    ('chat_controllo_anteprima', '')
  on conflict (key) do nothing;
  get diagnostics v_nati = row_count;
  perform set_config('amimi.chat_controllo_nati', v_nati::text, true);
end $$;

-- 2) il cron (stesso nome = stesso job se la migrazione si riesegue)
select cron.schedule('chat-controllo', '7 8 * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-controllo',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"controlla","pin":"x"}'::jsonb,
       timeout_milliseconds := 60000
     ) $cmd$);

-- 3) prova dentro la stessa transazione
do $$
declare
  v_nati int := coalesce(nullif(current_setting('amimi.chat_controllo_nati', true), '')::int, -1);
begin
  if v_nati < 0 then
    raise exception '0196: manca la lettura iniziale (quante chiavi sono nate qui)';
  end if;
  if (select count(*) from app_flags where key in ('chat_controllo_home', 'chat_controllo_anteprima')) <> 2 then
    raise exception '0196: manca una delle due chiavi del controllo';
  end if;
  if v_nati = 2 and ((select value from app_flags where key = 'chat_controllo_home') <> 'copia'
                     or (select value from app_flags where key = 'chat_controllo_anteprima') <> '') then
    raise exception '0196: le chiavi nate qui non hanno i valori di nascita (copia, vuoto)';
  end if;
  if (select count(*) from cron.job where jobname = 'chat-controllo' and schedule = '7 8 * * *' and active
        and command like '%/functions/v1/chat-controllo%' and command like '%"action":"controlla"%') <> 1 then
    raise exception '0196: il cron chat-controllo non e'' uno solo, attivo, alle 08:07 UTC sulla edge giusta';
  end if;
  -- il link d'anteprima non e' pubblico solo se app_flags non si legge con la chiave del sito ne' da un utente qualunque,
  -- neanche una colonna sola (has_table_privilege non vede i grant per colonna: Gate 2, C5)
  if has_table_privilege('anon', 'public.app_flags', 'select') or has_table_privilege('authenticated', 'public.app_flags', 'select')
     or has_any_column_privilege('anon', 'public.app_flags', 'select') or has_any_column_privilege('authenticated', 'public.app_flags', 'select') then
    raise exception '0196: app_flags e'' leggibile da anon o authenticated: il link d''anteprima non puo'' starci';
  end if;
end $$;

commit;
