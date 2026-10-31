-- 0180 (2026-10-31, OK di Dan in chat: "All 29 should be excluded. Do close the chats that you
-- think can be closed. Then let's work on this hidden and Shopify inbox"). Solo DATI del modulo cs_*
-- (Regola 19: nessuna tabella core toccata). Analisi: Cowork12/_CLAUDE_CODE_INBOX/
-- REPORT_assistenza_chat_e_denylist_2026-10-31.md (repo amimi-finance-system), CASI_APERTI n.54.
--
-- Parte 1. Denylist rumore `app_flags.cs_noise_senders`: +21 voci, cioe' le 29 conversazioni
--   non-cliente entrate in coda negli ultimi 45 giorni. Forma della voce = regola (denyMatch di
--   cs-sync v17+): `dominio.tld` = dominio o sottodominio, solo sul mittente; `nome@dominio` =
--   indirizzo esatto. Verificato il 31-10: nessuna voce corrisponde alle email dei 974 ordini
--   Shopify (965 con email). MAI `libero.it` o `dhl.com` interi: solo gli indirizzi esatti.
--   Idempotente come la 0119: appende solo le voci non gia' presenti (confronto per riga intera).
-- Parte 2. Chiusura di 3 conversazioni "in corso" gia' risolte (verificato su Gmail e Admin API
--   Shopify il 31-10): Fittipaldi (#1927 PICKED_UP 23-10), Turato (#1836 evaso 08-10), Rossino
--   (codice dato il 28-10, l'ultimo messaggio e' nostro). Ambrosini resta aperta: il rientro del
--   reso non risulta da nessuna parte.
-- Parte 3. Le chat di Shopify Inbox finite nel rumore perche' cs-classify le aveva etichettate
--   "Collaborazioni e B2B" (6 su 7; resta nel rumore solo lo spam di "jae mary"). Tornano canale
--   'chat_notifica', categoria azzerata (era sbagliata), flag 'passaggio_agente' dove la notifica
--   era solo il passaggio del chatbot. Petra Casarin (30-09) torna DA FARE: nessuna traccia di una
--   risposta. Le altre 5 tornano CONCLUSE, ognuna col motivo nell'evento: la stessa cliente e' stata
--   gestita altrove (Matilde e Marika: chat chiuse da Ginevra il 30-10, Marika anche via email;
--   Martina Celli: risposta al modulo del 03-08; Giulia Tettamanti: chat chiusa col suo "grazie").
-- Ogni riga toccata ha un evento cs_events (chi 'claude-code'). Conteggi attesi con RAISE: se un
-- solo numero non torna, l'intera migrazione si annulla. Ri-eseguita non tocca nulla.

do $$
declare
  voci text[] := array[
    'photosi.com', 'shipping.amazon.it', 'ads.google.com', 'fatturazioneelettronica.aruba.it',
    'sefin.it', 'luma-mail.com', 'support@dhl.com', 'noreply@adobe.com',
    'horlarbright018@gmail.com', 'teamzealous0w@gmail.com', 'babamale046@gmail.com',
    'brassfieldericson@gmail.com', 'ghaffmanhub9@gmail.com', 'taiyecomsult3@gmail.com',
    'gracebright00011@gmail.com', 'malikteslim064@gmail.com', 'sbeneda678@gmail.com',
    'vincenzo.terramagra@libero.it', 'conceria-alpaca.it', 'info@pellamiesposito.it',
    'itcustoms.exportmxp@dhl.com'];
  prima int; dopo int; n int;
begin
  -- ===== Parte 1: denylist =====
  select count(*) into prima from app_flags, regexp_split_to_table(value, E'\n') r
   where key = 'cs_noise_senders' and btrim(r) <> '';
  update app_flags
     set value = value || E'\n' || array_to_string(array(
           select d from unnest(voci) d
            where position(E'\n' || d || E'\n' in E'\n' || value || E'\n') = 0), E'\n')
   where key = 'cs_noise_senders'
     and exists (select 1 from unnest(voci) d
                  where position(E'\n' || d || E'\n' in E'\n' || value || E'\n') = 0);
  select count(*) into dopo from app_flags, regexp_split_to_table(value, E'\n') r
   where key = 'cs_noise_senders' and btrim(r) <> '';
  select count(*) into n from app_flags, unnest(voci) d
   where key = 'cs_noise_senders' and position(E'\n' || d || E'\n' in E'\n' || value || E'\n') > 0;
  if n <> 21 then raise exception '0180 parte 1: attese 21 voci presenti, trovate %', n; end if;
  if dopo - prima not in (0, 21) then raise exception '0180 parte 1: aggiunte % righe (attese 21, o 0 se gia'' applicata)', dopo - prima; end if;
  raise notice '0180 parte 1: denylist % -> % righe', prima, dopo;

  -- ===== Parte 2: chiusure =====
  with target(id, motivo) as (values
    ('92538dd6-a585-433c-b5ed-ab04ebc71dfc'::uuid, 'ordine #1927 ritirato il 23-10 (Admin API Shopify: PICKED_UP)'),
    ('4352b57e-5979-4db3-b2ac-1c3bdeca973e'::uuid, 'ordine #1836 evaso l''08-10, ritiro fatto come annunciato'),
    ('db964277-83da-42af-aac5-15185e0a0f87'::uuid, 'codice sconto dato il 28-10, ultimo messaggio nostro')
  ), upd as (
    update cs_conversations c
       set stato = 'fatto', stato_by = 'Claude Code', stato_at = now()
      from target t
     where c.id = t.id and c.stato = 'in_corso'
    returning c.id, t.motivo
  ), ev as (
    insert into cs_events (conversation_id, azione, chi, dettaglio)
    select id, 'stato', 'claude-code',
           jsonb_build_object('da', 'in_corso', 'a', 'fatto', 'motivo', motivo, 'ok_owner', 'Dan in chat 31-10')
      from upd returning 1
  )
  select count(*) into n from ev;
  if n not in (0, 3) then raise exception '0180 parte 2: chiuse % conversazioni (attese 3, o 0 se gia'' applicata)', n; end if;
  raise notice '0180 parte 2: chiuse %', n;

  -- ===== Parte 3: chat ripristinate dal rumore =====
  with target(id, stato_nuovo, passaggio, motivo) as (values
    ('3caa3903-1324-4135-8419-b8bce36bc1e6'::uuid, 'da_fare', true,  'Petra Casarin 30-09: solo passaggio del chatbot, nessuna traccia di risposta: da verificare in Inbox'),
    ('9a3d01b2-0c6c-45b6-9b50-1b5fd8358a19'::uuid, 'fatto',   true,  'Matilde Pulpito 26-10: stessa chat Inbox della conversazione chiusa da Ginevra il 30-10'),
    ('ef8d7c74-24aa-4fa9-88de-108ae3609237'::uuid, 'fatto',   true,  'Marika D''Elia 26-10: gestita da Ginevra il 30-10 (chat del 29-10) e via email (reso #1917)'),
    ('7569d28c-c36e-423b-a3cd-2dc20683b5a4'::uuid, 'fatto',   true,  'Marika D''Elia 28-10: gestita da Ginevra il 30-10 (chat del 29-10) e via email (reso #1917)'),
    ('3f1469ec-e35e-49db-a928-a16699ad4e84'::uuid, 'fatto',   false, 'Martina Celli 03-08: risposta data lo stesso giorno al suo modulo contatti'),
    ('bc607b06-d469-4e9e-b4d4-a80a0fa77196'::uuid, 'fatto',   false, 'Giulia Tettamanti 23-07: chat chiusa dal suo "Top!!! Grazie"')
  ), upd as (
    update cs_conversations c
       set canale = 'chat_notifica',
           categoria = null, categoria_source = 'ai_low', categoria_confidence = null,
           flags = case when t.passaggio and not (coalesce(c.flags, '[]'::jsonb) ? 'passaggio_agente')
                        then coalesce(c.flags, '[]'::jsonb) || '["passaggio_agente"]'::jsonb
                        else coalesce(c.flags, '[]'::jsonb) end,
           stato = t.stato_nuovo,
           stato_by = case when t.stato_nuovo = 'fatto' then 'Claude Code' else null end,
           stato_at = now()
      from target t
     where c.id = t.id and c.canale = 'rumore' and c.categoria = 'Collaborazioni e B2B'
    returning c.id, t.stato_nuovo, t.motivo
  ), ev as (
    insert into cs_events (conversation_id, azione, chi, dettaglio)
    select id, 'chat_ripristinata', 'claude-code',
           jsonb_build_object('da', 'rumore', 'a', 'chat_notifica', 'stato', stato_nuovo, 'motivo', motivo,
                              'causa', 'cs-classify etichettava B2B il passaggio del chatbot Shopify (CASI_APERTI n.54)',
                              'ok_owner', 'Dan in chat 31-10')
      from upd returning 1
  )
  select count(*) into n from ev;
  if n not in (0, 6) then raise exception '0180 parte 3: ripristinate % chat (attese 6, o 0 se gia'' applicata)', n; end if;
  raise notice '0180 parte 3: ripristinate %', n;
end $$;
