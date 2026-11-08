-- 0186_chat_schema.sql (2026-11-08): chat del sito, Fase 1 pezzo 1 (modulo chat_*, Regola Ferrea 19). Proposta:
-- docs/PROPOSTA_chat_sito.md sez. 5.4, 5.6, 5.9, 7.2, 7.3 e 10, con le decisioni di Dan dell'8 novembre 2026 (D-8 modello
-- ticket, D-12 tetti). Brief nel repo hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md.
--
-- Solo tabelle chat_* e chiavi chat_* di app_flags; del resto si legge e basta (email_del_team per le policy,
-- cs_conversations per la chiave esterna della proiezione). Nessuna edge scrive ancora qui: chat-api, chat-staff e
-- chat-send arrivano coi pezzi 2 e 3. Tutto nasce SPENTO: chat_sito_enabled = 'false'. Rollback = il flag spento; le
-- tabelle vuote possono restare.
--
-- Sicurezza (5.9): RLS accesa su ogni tabella; revoke a public, anon e authenticated su tabelle, sequenze delle identity
-- e funzione, perche' i default privileges di public danno lettura sulle tabelle, rwU sulle sequenze ed EXECUTE sulle
-- funzioni (letti in produzione l'8-11); scrive solo il service_role. Il team (email_del_team) legge solo chat_sessioni e
-- chat_messaggi, con grant per colonna (una colonna aggiunta dopo non esce da sola) e una policy di sola lettura;
-- chat_token, chat_eventi e chat_contatori solo service_role. Nessuna scrittura in change_log (5.1): l'audit della chat
-- sta in chat_eventi, senza testi ne' email.
-- Idempotenza a DB (Regola 20, 7.3): (sessione_id, client_msg_id) e send_key UNIQUE sui messaggi, chiave UNIQUE sugli
-- eventi (prenotazione delle push, 8.4), hash UNIQUE sui token, contatori con PK (chiave, finestra) e incremento atomico
-- sotto il tetto in un solo statement (5.6).
-- Divergenze dalla proposta, dichiarate (e riportate in PROPOSTA_chat_sito.md 7.2):
--   - i token stanno in chat_token e non in chat_sessioni.token_hash: 5.4 vuole fino a 3 token di chat per sessione,
--     uno per dispositivo, e i token di ripresa delle email, ognuno con scadenza e revoca;
--   - niente presenza (last_seen_at, visibile): non si costruisce per D-8; delivered_at resta solo come "vista in chat",
--     non piu' condizione dell'email;
--   - niente chiavi per IP nei contatori: l'IP non arriva alla edge via App Proxy (spike S1, D-12);
--   - la RPC dei contatori e' SECURITY INVOKER: la chiama solo il service_role, che ha gia' i privilegi (5.9 punto 4,
--     definer solo se serve).
-- Rieseguibile: tabelle con if not exists, funzione e policy ricreate, flag con on conflict do nothing; la prova finale
-- controlla il contratto (colonne, vincoli, privilegi) e pretende i valori di nascita solo dai flag nati in questa
-- esecuzione, cosi' un testo cambiato dopo dalla scheda Chat non viene sovrascritto ne' fa fallire un re-run.
-- Nessun `return` nei blocchi DO (MIG-C2 della 0166): la prova annullata prima dell'apply li annida in un solo DO.
begin;

-- 1) sessioni: una per chat. stato e mappa verso Assistenza in 7.5; preso_da = nomi del selettore B/G/A (chat-api e
--    push-eventi mappano Benedetta in Bene per push-api, 8.5). customer_email obbligatoria (3.2, D-8) e gia' ripulita
--    dalla edge con l'espressione ancorata di 5.7: qui un secondo cancello contro spazi, a capo, caratteri di controllo e
--    <>,;" (niente header in piu' nell'email di chat-send). shopify_customer_id solo dal logged_in_customer_id firmato del
--    proxy. ultima_attivita_at = ultimo messaggio di chiunque o azione della cliente (non i poll): scadenza dei token di
--    chat a 4 ore (5.4) e conservazione (11.5). gmail_thread_id = thread del ripiego email di chat-send (7.9).
--    proiettato_seq = fin dove la chat e' gia' in cs_ (7.4).
create table if not exists chat_sessioni (
  id                        uuid primary key default gen_random_uuid(),
  stato                     text not null default 'bot',
  preso_da                  text,
  customer_email            text not null,
  customer_name             text,
  shopify_customer_id       text,
  lingua                    text not null default 'it',
  informativa_versione      text not null,
  informativa_at            timestamptz not null default now(),
  passaggi                  int not null default 0,
  passaggio_at              timestamptz,
  ultimo_cliente_at         timestamptz,
  ultima_risposta_staff_at  timestamptz,
  ultima_attivita_at        timestamptz not null default now(),
  chiusa_at                 timestamptz,
  gmail_thread_id           text,
  cs_conversation_id        uuid,
  proiettato_seq            bigint not null default 0,
  prova                     boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint chat_sessioni_stato_ck check (stato in ('bot', 'attesa_persona', 'aperta', 'chiusa')),
  constraint chat_sessioni_preso_da_ck check (preso_da is null or preso_da in ('Benedetta', 'Ginevra', 'Ale')),
  constraint chat_sessioni_aperta_ck check (stato <> 'aperta' or preso_da is not null),
  constraint chat_sessioni_chiusa_ck check ((stato = 'chiusa') = (chiusa_at is not null)),
  constraint chat_sessioni_email_ck check (char_length(customer_email) <= 254
    and customer_email ~ '^[^[:space:][:cntrl:]<>,;"@]+@[^[:space:][:cntrl:]<>,;"@]+\.[^[:space:][:cntrl:]<>,;"@]+$'),
  constraint chat_sessioni_nome_ck check (customer_name is null
    or (char_length(customer_name) between 1 and 80 and customer_name !~ '[[:cntrl:]]')),
  constraint chat_sessioni_shopify_ck check (shopify_customer_id is null or shopify_customer_id ~ '^[0-9]{1,20}$'),
  constraint chat_sessioni_lingua_ck check (lingua in ('it', 'en')),
  constraint chat_sessioni_informativa_ck check (char_length(informativa_versione) between 1 and 64),
  constraint chat_sessioni_passaggi_ck check (passaggi >= 0),
  constraint chat_sessioni_proiettato_ck check (proiettato_seq >= 0),
  constraint chat_sessioni_thread_ck check (gmail_thread_id is null or char_length(gmail_thread_id) between 1 and 64),
  constraint chat_sessioni_thread_uk unique (gmail_thread_id),
  constraint chat_sessioni_cs_uk unique (cs_conversation_id),
  constraint chat_sessioni_cs_fk foreign key (cs_conversation_id) references cs_conversations (id) on delete set null
);
create index if not exists chat_sessioni_attese_ix on chat_sessioni (passaggio_at) where stato in ('attesa_persona', 'aperta');
create index if not exists chat_sessioni_email_ix on chat_sessioni (lower(customer_email));
create index if not exists chat_sessioni_attivita_ix on chat_sessioni (ultima_attivita_at);

-- 2) messaggi. seq = cursore del polling (6.2). autore: cliente; automatica = risposta fissa della Fase 1; ai = dalla
--    Fase 2; staff = "Team Amimi"; sistema = avvisi (non proiettati in cs_, 7.4). Un messaggio della cliente porta sempre
--    il suo client_msg_id (un POST ripetuto non duplica), uno dello staff il send_key del dialogo di conferma. testo fino a
--    4.000 per tutti gli autori (tetto del DB; dal widget la cliente ne manda al massimo 1.000, 5.7). email_*: l'email di
--    chat-send, solo per i messaggi dello staff (D-8: ognuno parte per email); la prenotazione passa da null a
--    'prenotata' con un update condizionato prima di chiamare Gmail (7.9), email_at = ora dell'ultimo cambio di stato
--    (una 'prenotata' ferma da oltre 15 minuti diventa 'errore', mai rimandata).
create table if not exists chat_messaggi (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  sessione_id     uuid not null,
  autore          text not null,
  staff_nome      text,
  testo           text not null,
  client_msg_id   uuid,
  send_key        uuid,
  fonte           text,
  delivered_at    timestamptz,
  email_stato     text,
  email_at        timestamptz,
  email_gmail_id  text,
  email_errore    text,
  created_at      timestamptz not null default now(),
  constraint chat_messaggi_sessione_fk foreign key (sessione_id) references chat_sessioni (id) on delete cascade,
  constraint chat_messaggi_seq_uk unique (seq),
  constraint chat_messaggi_client_uk unique (sessione_id, client_msg_id),
  constraint chat_messaggi_send_key_uk unique (send_key),
  constraint chat_messaggi_autore_ck check (autore in ('cliente', 'automatica', 'ai', 'staff', 'sistema')),
  constraint chat_messaggi_staff_ck check ((autore = 'staff') = (staff_nome is not null)
    and (staff_nome is null or staff_nome in ('Benedetta', 'Ginevra', 'Ale'))),
  constraint chat_messaggi_testo_ck check (char_length(testo) between 1 and 4000),
  constraint chat_messaggi_client_msg_ck check (autore <> 'cliente' or client_msg_id is not null),
  constraint chat_messaggi_send_key_ck check (autore <> 'staff' or send_key is not null),
  constraint chat_messaggi_fonte_ck check (fonte is null or char_length(fonte) between 1 and 100),
  constraint chat_messaggi_email_stato_ck check (email_stato is null
    or (email_stato in ('prenotata', 'inviata', 'errore') and autore = 'staff' and email_at is not null)),
  constraint chat_messaggi_email_inviata_ck check (email_stato is distinct from 'inviata' or email_gmail_id is not null),
  constraint chat_messaggi_email_errore_ck check (email_stato is distinct from 'errore' or email_errore is not null),
  constraint chat_messaggi_gmail_id_ck check (email_gmail_id is null or char_length(email_gmail_id) between 1 and 64),
  constraint chat_messaggi_errore_ck check (email_errore is null or char_length(email_errore) between 1 and 200)
);
create index if not exists chat_messaggi_sessione_seq_ix on chat_messaggi (sessione_id, seq);
create index if not exists chat_messaggi_email_coda_ix on chat_messaggi (created_at)
  where autore = 'staff' and (email_stato is null or email_stato = 'prenotata');

-- 3) token (5.4): chat = nel localStorage del dispositivo (al massimo 3 attivi per sessione, scade alla chiusura o dopo 4
--    ore senza attivita' della sessione); ripresa = nel link "Continua la chat" delle email (30 giorni, D-10). Nel DB solo
--    lo SHA-256 in esadecimale del valore casuale (almeno 128 bit), mai il token. usato_at = ultimo scambio di un token di
--    ripresa (o ultimo uso di un token di chat).
create table if not exists chat_token (
  id           uuid primary key default gen_random_uuid(),
  sessione_id  uuid not null,
  tipo         text not null,
  hash         text not null,
  scade_at     timestamptz not null,
  revocato_at  timestamptz,
  usato_at     timestamptz,
  created_at   timestamptz not null default now(),
  constraint chat_token_sessione_fk foreign key (sessione_id) references chat_sessioni (id) on delete cascade,
  constraint chat_token_hash_uk unique (hash),
  constraint chat_token_tipo_ck check (tipo in ('chat', 'ripresa')),
  constraint chat_token_hash_ck check (hash ~ '^[0-9a-f]{64}$'),
  constraint chat_token_scadenza_ck check (scade_at > created_at)
);
create index if not exists chat_token_sessione_ix on chat_token (sessione_id, tipo);

-- 4) eventi: audit della chat e prenotazioni delle push di passaggio (chiave `<sessione>:passaggio:<n>`, 8.3-8.4: chi
--    inserisce la chiave manda, gli altri saltano). dettaglio senza testi ne' email (lo fissa un test sul sorgente delle
--    edge). Alla cancellazione di una sessione la traccia resta, con sessione_id nullo (11.6).
create table if not exists chat_eventi (
  id           bigint generated always as identity primary key,
  sessione_id  uuid,
  tipo         text not null,
  chiave       text,
  chi          text,
  esito        text,
  dettaglio    jsonb not null default '{}',
  at           timestamptz not null default now(),
  constraint chat_eventi_sessione_fk foreign key (sessione_id) references chat_sessioni (id) on delete set null,
  constraint chat_eventi_chiave_uk unique (chiave),
  constraint chat_eventi_tipo_ck check (tipo ~ '^[a-z][a-z0-9_]{1,47}$'),
  constraint chat_eventi_chiave_ck check (chiave is null or char_length(chiave) between 1 and 300),
  constraint chat_eventi_chi_ck check (chi is null or char_length(chi) between 1 and 40),
  constraint chat_eventi_esito_ck check (esito is null or char_length(esito) between 1 and 60),
  constraint chat_eventi_dettaglio_ck check (jsonb_typeof(dettaglio) = 'object' and octet_length(dettaglio::text) <= 4000)
);
create index if not exists chat_eventi_sessione_ix on chat_eventi (sessione_id);
create index if not exists chat_eventi_tipo_at_ix on chat_eventi (tipo, at);

-- 5) contatori (5.6): una riga per (chiave, finestra). chiave per sessione (`sess:<uuid>:<azione>`) o globale
--    (`glob:<voce>`), mai un IP. finestra = inizio della finestra; 'epoch' = senza finestra (per esempio i 100 messaggi
--    per chat di D-12). Si cancellano dopo 7 giorni senza aggiornamenti (job di conservazione, pezzo 3): un tetto
--    "per sempre" su una chat ferma da oltre 7 giorni riparte da zero, ed e' accettato.
create table if not exists chat_contatori (
  chiave         text not null,
  finestra       timestamptz not null,
  n              int not null default 0,
  aggiornato_at  timestamptz not null default now(),
  constraint chat_contatori_pk primary key (chiave, finestra),
  constraint chat_contatori_chiave_ck check (chiave ~ '^[a-z][a-z0-9_:.-]{0,199}$'),
  constraint chat_contatori_n_ck check (n >= 0)
);
create index if not exists chat_contatori_aggiornato_ix on chat_contatori (aggiornato_at);

-- 6) incremento atomico sotto il tetto, in un solo statement: restituisce il nuovo valore, o null se il tetto e' gia'
--    raggiunto (la chiamata NON passa). Mai "leggo e poi scrivo". p_finestra_secondi: 0 = senza finestra, altrimenti
--    finestre allineate all'epoca (86400 = giorno UTC). Input fuori dai limiti = errore 22023, che la edge tratta come
--    rifiuto (fallire chiusi, 5.8).
create or replace function public.chat_contatore_incrementa(p_chiave text, p_finestra_secondi int, p_tetto int)
returns int
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_finestra timestamptz;
  v_n int;
begin
  if p_chiave is null or p_chiave !~ '^[a-z][a-z0-9_:.-]{0,199}$' then
    raise exception 'chat_contatore_incrementa: chiave non valida' using errcode = '22023';
  end if;
  if p_tetto is null or p_tetto < 1 or p_tetto > 1000000 then
    raise exception 'chat_contatore_incrementa: tetto fuori dai limiti' using errcode = '22023';
  end if;
  if p_finestra_secondi is null or p_finestra_secondi < 0 or p_finestra_secondi > 604800 then
    raise exception 'chat_contatore_incrementa: finestra fuori dai limiti' using errcode = '22023';
  end if;
  v_finestra := case when p_finestra_secondi = 0 then 'epoch'::timestamptz
                     else to_timestamp(floor(extract(epoch from now()) / p_finestra_secondi) * p_finestra_secondi) end;
  insert into chat_contatori as c (chiave, finestra, n, aggiornato_at)
  values (p_chiave, v_finestra, 1, now())
  on conflict (chiave, finestra) do update set n = c.n + 1, aggiornato_at = now() where c.n < p_tetto
  returning c.n into v_n;
  return v_n;
end $fn$;

comment on table chat_sessioni is 'Chat del sito: una riga per chat (fonte di verita'', proiettata in cs_conversations). Scrive solo il service_role; il team legge.';
comment on table chat_messaggi is 'Chat del sito: messaggi, seq = cursore del polling. Scrive solo il service_role; il team legge.';
comment on table chat_token is 'Chat del sito: hash SHA-256 dei token di chat e di ripresa, mai il token. Solo service_role.';
comment on table chat_eventi is 'Chat del sito: audit e prenotazioni delle push, senza testi ne'' email. Solo service_role.';
comment on table chat_contatori is 'Chat del sito: contatori dei limiti (per sessione e globali, mai per IP). Solo service_role.';

-- 7) sicurezza: tutto al service_role, niente a public, anon e authenticated; poi la sola lettura del team
alter table chat_sessioni enable row level security;
alter table chat_messaggi enable row level security;
alter table chat_token enable row level security;
alter table chat_eventi enable row level security;
alter table chat_contatori enable row level security;
revoke all on chat_sessioni, chat_messaggi, chat_token, chat_eventi, chat_contatori from public, anon, authenticated;
grant select, insert, update, delete on chat_sessioni, chat_messaggi, chat_token, chat_eventi, chat_contatori to service_role;

do $$
declare
  v_seq text;
begin
  foreach v_seq in array array[pg_get_serial_sequence('public.chat_messaggi', 'seq'), pg_get_serial_sequence('public.chat_eventi', 'id')] loop
    if v_seq is null then raise exception '0186: sequenza di un''identity della chat non trovata'; end if;
    execute format('revoke all on sequence %s from public, anon, authenticated', v_seq);
    execute format('grant usage, select on sequence %s to service_role', v_seq);
  end loop;
end $$;

revoke all on function public.chat_contatore_incrementa(text, int, int) from public, anon, authenticated;
grant execute on function public.chat_contatore_incrementa(text, int, int) to service_role;

-- lettura del team (7.2): solo le due tabelle che la UI usa, colonna per colonna, policy di sola lettura con
-- email_del_team (0161). Nessuna policy di scrittura: le azioni del team passano da chat-staff.
grant select (id, stato, preso_da, customer_email, customer_name, shopify_customer_id, lingua, informativa_versione,
              informativa_at, passaggi, passaggio_at, ultimo_cliente_at, ultima_risposta_staff_at, ultima_attivita_at,
              chiusa_at, gmail_thread_id, cs_conversation_id, proiettato_seq, prova, created_at, updated_at)
  on chat_sessioni to authenticated;
grant select (id, seq, sessione_id, autore, staff_nome, testo, client_msg_id, send_key, fonte, delivered_at, email_stato,
              email_at, email_gmail_id, email_errore, created_at)
  on chat_messaggi to authenticated;
drop policy if exists chat_sessioni_sel on chat_sessioni;
create policy chat_sessioni_sel on chat_sessioni for select to authenticated
  using ((select public.email_del_team(auth.jwt() ->> 'email')));
drop policy if exists chat_messaggi_sel on chat_messaggi;
create policy chat_messaggi_sel on chat_messaggi for select to authenticated
  using ((select public.email_del_team(auth.jwt() ->> 'email')));

-- 8) chiavi NON segrete di app_flags (sez. 10), lette da chat-api con un elenco esplicito e cambiate dalla scheda Chat
--    (chat-staff). I testi sono JSON {it, en}: {email} = l'email della cliente mascherata (3.2). Sono bozze: italiano dalla
--    proposta e da D-8, inglese di Code da far approvare al team (D-15), informativa da far approvare a chi segue il legale
--    (D-22). chat_orari e' PROVVISORIO (giorni lavorativi di D-8, ore da confermare con Ginni dalla scheda Chat): giorni
--    ISO, 1 = lunedi'. chat_bottoni: i rapidi del widget ("Parla con una persona" e' fisso nel widget), faq = id di
--    cs_faq della risposta fissa, null finche' il pezzo 7 non importa le voci (un bottone senza faq non si mostra).
--    I tetti fissi (100 messaggi per chat di D-12, lunghezze) stanno nel codice di chat-api, non qui (sez. 10).
do $$
declare
  v_nati text[];
begin
  with ins as (
    insert into app_flags (key, value) values
      ('chat_sito_enabled', 'false'),
      ('chat_sollecito_ore', '24,48'),
      ('chat_limite_chat_giorno', '50'),
      ('chat_conservazione_mesi', '12'),
      ('chat_orari', jsonb_build_object('tz', 'Europe/Rome', 'giorni', jsonb_build_array(1, 2, 3, 4, 5),
                                        'dalle', '09:00', 'alle', '18:00', 'chiusure', jsonb_build_array())::text),
      ('chat_testo_saluto', jsonb_build_object(
        'it', $t$Ciao, questa è la chat di Amimi. Le risposte rapide sono testi preparati dal team. Se ci scrivi un messaggio ti risponde una persona del team: la risposta ti arriva via email e la trovi anche qui.$t$,
        'en', $t$Hi, this is the Amimi chat. The quick answers are texts written by our team. If you send us a message, a person from our team will reply: you will get the answer by email and find it here too.$t$)::text),
      ('chat_testo_orari', jsonb_build_object(
        'it', $t$Il team risponde nei giorni lavorativi, di solito entro 2 giorni lavorativi. La risposta ti arriva via email.$t$,
        'en', $t$Our team replies on working days, usually within 2 working days. The reply is sent to you by email.$t$)::text),
      ('chat_testo_attesa', jsonb_build_object(
        'it', $t$Abbiamo ricevuto la tua richiesta: ti risponderemo il prima possibile, di solito entro 2 giorni lavorativi, e riceverai la risposta via email all'indirizzo {email}.$t$,
        'en', $t$We have received your request: we will reply as soon as possible, usually within 2 working days, and you will receive the reply by email at {email}.$t$)::text),
      ('chat_testo_fuori_orario', jsonb_build_object(
        'it', $t$Abbiamo ricevuto la tua richiesta: il team ti risponderà appena possibile e riceverai la risposta via email all'indirizzo {email}.$t$,
        'en', $t$We have received your request: our team will reply as soon as possible and you will receive the reply by email at {email}.$t$)::text),
      ('chat_testo_informativa', jsonb_build_object(
        'it', $t$Usiamo la tua email, il nome se lo scrivi e i messaggi di questa chat per risponderti, anche per email. Le risposte rapide sono testi preparati dal team; ai messaggi scritti risponde una persona. Di norma conserviamo la chat per 12 mesi dall'ultimo messaggio. Non scrivere dati di pagamento o di salute. La chat non è pensata per i minori. Dettagli e diritti nell'informativa sulla privacy.$t$,
        'en', $t$We use your email, your name if you write it, and the messages in this chat to reply to you, also by email. The quick answers are texts written by our team; a person replies to written messages. We normally keep the chat for 12 months after the last message. Do not write payment or health details. The chat is not intended for minors. Details and your rights are in the privacy notice.$t$)::text),
      ('chat_bottoni', jsonb_build_array(
        jsonb_build_object('id', 'spedizioni', 'it', 'Spedizioni', 'en', 'Shipping', 'faq', null),
        jsonb_build_object('id', 'resi', 'it', 'Resi', 'en', 'Returns', 'faq', null),
        jsonb_build_object('id', 'ritiri', 'it', 'Ritiri', 'en', 'Pick-up', 'faq', null),
        jsonb_build_object('id', 'ordine', 'it', $t$Dov'è il mio ordine$t$, 'en', 'Where is my order', 'faq', null))::text)
    on conflict (key) do nothing
    returning key)
  select coalesce(array_agg(key), '{}') into v_nati from ins;
  perform set_config('amimi.chat_flag_nati_qui', array_to_string(v_nati, ','), true);
end $$;

-- 9) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa. `create table if not exists`
--    salta in silenzio se la tabella esiste gia' diversa (C2 della 0128): colonne, vincoli e privilegi si contano qui.
do $$
declare
  t text;
  r name;
  c text;
  v_val text;
  v_grant text;
  v_seq regclass;
  v_nati text[] := coalesce(string_to_array(nullif(current_setting('amimi.chat_flag_nati_qui', true), ''), ','), '{}');
  c_tabelle constant text[] := array['chat_sessioni', 'chat_messaggi', 'chat_token', 'chat_eventi', 'chat_contatori'];
  c_lette constant text[] := array['chat_sessioni', 'chat_messaggi'];
  c_flag constant text[] := array['chat_sito_enabled', 'chat_sollecito_ore', 'chat_limite_chat_giorno', 'chat_conservazione_mesi',
                                  'chat_orari', 'chat_testo_saluto', 'chat_testo_orari', 'chat_testo_attesa',
                                  'chat_testo_fuori_orario', 'chat_testo_informativa', 'chat_bottoni'];
  c_testi constant text[] := array['chat_testo_saluto', 'chat_testo_orari', 'chat_testo_attesa', 'chat_testo_fuori_orario', 'chat_testo_informativa'];
begin
  if current_setting('amimi.chat_flag_nati_qui', true) is null then
    raise exception '0186: manca la lettura dei flag nati in questa migrazione';
  end if;

  -- colonne: il contratto con chat-api, chat-staff e chat-send
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.chat_sessioni'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,stato,preso_da,customer_email,customer_name,shopify_customer_id,lingua,informativa_versione,informativa_at,passaggi,passaggio_at,ultimo_cliente_at,ultima_risposta_staff_at,ultima_attivita_at,chiusa_at,gmail_thread_id,cs_conversation_id,proiettato_seq,prova,created_at,updated_at' then
    raise exception '0186: colonne di chat_sessioni diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.chat_messaggi'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,seq,sessione_id,autore,staff_nome,testo,client_msg_id,send_key,fonte,delivered_at,email_stato,email_at,email_gmail_id,email_errore,created_at' then
    raise exception '0186: colonne di chat_messaggi diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.chat_token'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,sessione_id,tipo,hash,scade_at,revocato_at,usato_at,created_at' then
    raise exception '0186: colonne di chat_token diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.chat_eventi'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,sessione_id,tipo,chiave,chi,esito,dettaglio,at' then
    raise exception '0186: colonne di chat_eventi diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.chat_contatori'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'chiave,finestra,n,aggiornato_at' then
    raise exception '0186: colonne di chat_contatori diverse dal contratto';
  end if;

  -- vincoli: tutti presenti; quelli su cui la edge fa `on conflict` esattamente sulle colonne attese
  foreach c in array array['chat_sessioni_stato_ck', 'chat_sessioni_preso_da_ck', 'chat_sessioni_aperta_ck', 'chat_sessioni_chiusa_ck',
                           'chat_sessioni_email_ck', 'chat_sessioni_nome_ck', 'chat_sessioni_shopify_ck', 'chat_sessioni_lingua_ck',
                           'chat_sessioni_informativa_ck', 'chat_sessioni_passaggi_ck', 'chat_sessioni_proiettato_ck',
                           'chat_sessioni_thread_ck', 'chat_sessioni_thread_uk', 'chat_sessioni_cs_uk', 'chat_sessioni_cs_fk',
                           'chat_messaggi_sessione_fk', 'chat_messaggi_seq_uk', 'chat_messaggi_client_uk', 'chat_messaggi_send_key_uk',
                           'chat_messaggi_autore_ck', 'chat_messaggi_staff_ck', 'chat_messaggi_testo_ck', 'chat_messaggi_client_msg_ck',
                           'chat_messaggi_send_key_ck', 'chat_messaggi_fonte_ck', 'chat_messaggi_email_stato_ck',
                           'chat_messaggi_email_inviata_ck', 'chat_messaggi_email_errore_ck', 'chat_messaggi_gmail_id_ck',
                           'chat_messaggi_errore_ck', 'chat_token_sessione_fk', 'chat_token_hash_uk', 'chat_token_tipo_ck',
                           'chat_token_hash_ck', 'chat_token_scadenza_ck', 'chat_eventi_sessione_fk', 'chat_eventi_chiave_uk',
                           'chat_eventi_tipo_ck', 'chat_eventi_chiave_ck', 'chat_eventi_chi_ck', 'chat_eventi_esito_ck',
                           'chat_eventi_dettaglio_ck', 'chat_contatori_pk', 'chat_contatori_chiave_ck', 'chat_contatori_n_ck'] loop
    if not exists (select 1 from pg_constraint k where k.conname = c and k.connamespace = 'public'::regnamespace) then
      raise exception '0186: vincolo mancante %', c;
    end if;
  end loop;
  if (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_messaggi_client_uk' and k.conrelid = 'public.chat_messaggi'::regclass)
       is distinct from 'UNIQUE (sessione_id, client_msg_id)'
     or (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_eventi_chiave_uk' and k.conrelid = 'public.chat_eventi'::regclass)
       is distinct from 'UNIQUE (chiave)'
     or (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_contatori_pk' and k.conrelid = 'public.chat_contatori'::regclass)
       is distinct from 'PRIMARY KEY (chiave, finestra)' then
    raise exception '0186: un vincolo usato dagli on conflict non e'' sulle colonne attese';
  end if;
  if (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_messaggi_sessione_fk' and k.conrelid = 'public.chat_messaggi'::regclass)
       is distinct from 'FOREIGN KEY (sessione_id) REFERENCES chat_sessioni(id) ON DELETE CASCADE'
     or (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_token_sessione_fk' and k.conrelid = 'public.chat_token'::regclass)
       is distinct from 'FOREIGN KEY (sessione_id) REFERENCES chat_sessioni(id) ON DELETE CASCADE'
     or (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_eventi_sessione_fk' and k.conrelid = 'public.chat_eventi'::regclass)
       is distinct from 'FOREIGN KEY (sessione_id) REFERENCES chat_sessioni(id) ON DELETE SET NULL'
     or (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'chat_sessioni_cs_fk' and k.conrelid = 'public.chat_sessioni'::regclass)
       is distinct from 'FOREIGN KEY (cs_conversation_id) REFERENCES cs_conversations(id) ON DELETE SET NULL' then
    raise exception '0186: chiavi esterne della chat diverse dal contratto (cascata dei dati personali, 11.6)';
  end if;

  -- RLS, policy e privilegi di tabella
  foreach t in array c_tabelle loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then
      raise exception '0186: RLS spenta su %', t;
    end if;
    if not (has_table_privilege('service_role', 'public.' || t, 'select') and has_table_privilege('service_role', 'public.' || t, 'insert')
            and has_table_privilege('service_role', 'public.' || t, 'update') and has_table_privilege('service_role', 'public.' || t, 'delete')) then
      raise exception '0186: service_role non legge e scrive %', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r, 'public.' || t, 'insert, update, references') then
        raise exception '0186: % ha privilegi di tabella o di scrittura su %', r, t;
      end if;
    end loop;
    if has_any_column_privilege('anon', 'public.' || t, 'select') then
      raise exception '0186: anon legge colonne di %', t;
    end if;
    if t = any(c_lette) then
      if (select count(*) from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
            and not has_column_privilege('authenticated', ('public.' || t)::regclass, a.attnum, 'select')) > 0 then
        raise exception '0186: il team non legge tutte le colonne di %', t;
      end if;
      if (select count(*) from pg_policy p where p.polrelid = ('public.' || t)::regclass) <> 1
         or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t and p.policyname = t || '_sel'
                          and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
                          and p.qual like '%email_del_team%' and p.with_check is null) then
        raise exception '0186: % deve avere la sola policy di lettura del team (email_del_team)', t;
      end if;
    else
      if has_any_column_privilege('authenticated', 'public.' || t, 'select') then
        raise exception '0186: authenticated legge colonne di % (solo service_role)', t;
      end if;
      if exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass) then
        raise exception '0186: % ha una policy, deve restare senza (solo service_role)', t;
      end if;
    end if;
  end loop;

  -- grant diretti (anche MAINTAIN di PG17) a PUBLIC, anon e authenticated su tabelle e sequenze: nessuno; sulle colonne
  -- solo il SELECT del team sulle due tabelle lette
  select string_agg(format('%s a %s su %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC'), cl.relname), ', ' order by cl.relname)
    into v_grant
    from pg_class cl
    cross join lateral aclexplode(cl.relacl) a
    left join pg_roles g on g.oid = a.grantee
   where cl.oid in (select ('public.' || x)::regclass from unnest(c_tabelle) x
                    union all select pg_get_serial_sequence('public.chat_messaggi', 'seq')::regclass
                    union all select pg_get_serial_sequence('public.chat_eventi', 'id')::regclass)
     and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'));
  if v_grant is not null then raise exception '0186: privilegi di troppo: %', v_grant; end if;
  select string_agg(format('%s a %s su %s.%s', a.privilege_type, coalesce(g.rolname, 'PUBLIC'), cl.relname, att.attname), ', ')
    into v_grant
    from pg_attribute att
    join pg_class cl on cl.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    left join pg_roles g on g.oid = a.grantee
   where cl.oid in (select ('public.' || x)::regclass from unnest(c_tabelle) x)
     and (a.grantee = 0 or g.rolname = 'anon' or (g.rolname = 'authenticated' and (a.privilege_type <> 'SELECT' or not cl.relname = any(c_lette))));
  if v_grant is not null then raise exception '0186: privilegi di colonna di troppo: %', v_grant; end if;

  -- sequenze delle identity
  foreach v_seq in array array[pg_get_serial_sequence('public.chat_messaggi', 'seq')::regclass, pg_get_serial_sequence('public.chat_eventi', 'id')::regclass] loop
    if v_seq is null then raise exception '0186: sequenza di un''identity mancante'; end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_sequence_privilege(r, v_seq, 'usage, select, update') then
        raise exception '0186: % ha privilegi sulla sequenza %', r, v_seq;
      end if;
    end loop;
    if not has_sequence_privilege('service_role', v_seq, 'usage') then
      raise exception '0186: service_role senza usage sulla sequenza %', v_seq;
    end if;
  end loop;

  -- la RPC dei contatori: invoker, search_path fissato, solo service_role
  if to_regprocedure('public.chat_contatore_incrementa(text, integer, integer)') is null then
    raise exception '0186: manca chat_contatore_incrementa(text, int, int)';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.chat_contatore_incrementa(text, integer, integer)'::regprocedure)
     or not exists (select 1 from pg_proc p where p.oid = 'public.chat_contatore_incrementa(text, integer, integer)'::regprocedure
                      and p.proconfig @> array['search_path=public']) then
    raise exception '0186: chat_contatore_incrementa deve essere security invoker con search_path=public';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.chat_contatore_incrementa(text, integer, integer)', 'execute') then
      raise exception '0186: % puo'' eseguire chat_contatore_incrementa', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.chat_contatore_incrementa(text, integer, integer)', 'execute') then
    raise exception '0186: service_role non esegue chat_contatore_incrementa';
  end if;

  -- flag: tutti presenti; quelli nati qui coi valori di nascita; i JSON leggibili e del tipo giusto
  foreach c in array c_flag loop
    select value into v_val from app_flags where key = c;
    if not found then raise exception '0186: manca app_flags.%', c; end if;
  end loop;
  if 'chat_sito_enabled' = any(v_nati) and (select value from app_flags where key = 'chat_sito_enabled') is distinct from 'false' then
    raise exception '0186: chat_sito_enabled nato qui deve valere false';
  end if;
  if 'chat_sollecito_ore' = any(v_nati) and (select value from app_flags where key = 'chat_sollecito_ore') is distinct from '24,48' then
    raise exception '0186: chat_sollecito_ore nato qui deve valere 24,48 (D-8)';
  end if;
  if 'chat_limite_chat_giorno' = any(v_nati) and (select value from app_flags where key = 'chat_limite_chat_giorno') is distinct from '50' then
    raise exception '0186: chat_limite_chat_giorno nato qui deve valere 50 (D-12)';
  end if;
  if 'chat_conservazione_mesi' = any(v_nati) and (select value from app_flags where key = 'chat_conservazione_mesi') is distinct from '12' then
    raise exception '0186: chat_conservazione_mesi nato qui deve valere 12';
  end if;
  foreach c in array c_testi loop
    if c = any(v_nati) and not exists (select 1 from app_flags f where f.key = c and jsonb_typeof(f.value::jsonb) = 'object'
                                         and jsonb_typeof(f.value::jsonb -> 'it') = 'string' and jsonb_typeof(f.value::jsonb -> 'en') = 'string'
                                         and char_length(f.value::jsonb ->> 'it') between 1 and 1000 and char_length(f.value::jsonb ->> 'en') between 1 and 1000) then
      raise exception '0186: % nato qui non e'' un JSON {it, en} di testi', c;
    end if;
  end loop;
  if 'chat_orari' = any(v_nati) and not exists (select 1 from app_flags f where f.key = 'chat_orari' and f.value::jsonb ->> 'tz' = 'Europe/Rome'
                                                   and f.value::jsonb -> 'giorni' = '[1, 2, 3, 4, 5]'::jsonb) then
    raise exception '0186: chat_orari nato qui senza i giorni lavorativi';
  end if;
  if 'chat_bottoni' = any(v_nati) and (select jsonb_array_length(f.value::jsonb) from app_flags f where f.key = 'chat_bottoni') is distinct from 4 then
    raise exception '0186: chat_bottoni nato qui non ha i 4 bottoni';
  end if;

  -- nessuna riga della chat scritta da questa migrazione in change_log (5.1)
  if exists (select 1 from change_log where tbl like 'chat\_%' and ts > now() - interval '1 minute') then
    raise exception '0186: righe della chat in change_log';
  end if;
end $$;

commit;
