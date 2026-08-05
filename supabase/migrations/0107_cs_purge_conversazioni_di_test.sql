-- 0107 — cancellazione delle conversazioni di TEST del tool Assistenza
-- (2026-08-05, richiesta esplicita dell'owner; applicata live nella stessa sessione)
--
-- NOTA DI NUMERAZIONE: a database questa migrazione e' registrata col nome
-- `0106_cs_purge_conversazioni_di_test` (version `20260805151716`), perche' quando l'ho applicata
-- il numero libero era il 106. Nel frattempo una sessione parallela ha spinto la sua
-- `0106_shopify_stock_item_qtys` (applicata alle 09:45, prima della mia): il DB non ha problemi,
-- le version sono timestamp e i nomi sono solo etichette, ma nel repo due file `0106_` no. Ha la
-- precedenza chi e' arrivato prima, quindi il file rinumerato e' questo. Stessa cosa fatta il
-- 26-07 per la collisione `0078`. Se cerchi questa migrazione a DB, cercala come 0106.
--
-- 14 conversazioni, 20 messaggi, 87 eventi, 23 bozze, 4 ricevute di invio. Le tabelle figlie
-- (`cs_messages`, `cs_events`, `cs_drafts`, `cs_sends`) sono in CASCADE su `conversation_id`,
-- quindi basta cancellare la conversazione e non restano orfani. Verificato dopo: 0 orfani.
--
-- Lista ESPLICITA e non un predicato. Un `where customer_email like '%test%'` su una tabella di
-- posta cliente e' il modo classico di portarsi via una persona vera: basta un cognome che
-- contiene "test" o un dominio che ci somiglia. Gli id sono stati letti, contati e mostrati
-- all'owner uno per uno prima di cancellare.
--
-- ESCLUSA DI PROPOSITO: `2394cb04-b57a-49f9-9748-ac473e3c92ed` ("Domanda su Lea Bag cocco beige").
-- E' una delle due conversazioni con cui il 02-08 e' stato ripulito il set EVAL delle bozze
-- (`amimi-app/docs/EDGE_FUNCTIONS.md`, scheda cs-assist v27). Cancellarla avrebbe tolto un caso al
-- prossimo giro cieco e reso falso il doc, in silenzio. Decisione dell'owner dopo la segnalazione.
--
-- Le email vere restano su Gmail e non sono state toccate: qui si pulisce solo la coda del tool.
-- Non si ripresentano da sole, perche' il cursore `cs_last_history_id` e' gia' oltre. Se in uno di
-- quei thread arrivasse un messaggio NUOVO la conversazione rinascerebbe, ed e' il comportamento
-- giusto: significherebbe che non era piu' un test.
delete from cs_conversations
where id in (
  '00aadd73-6859-4eb8-8e41-65759810c835',   -- form, "New customer message on 1 August 2026 at 17:58"
  '10cd2d8d-ea7f-4d33-9473-56de2715cac1',   -- alepodasca, "Re: Disponibilita' lea bag"
  '1a2f40ce-6d80-4655-a5d4-b5d42ff848ed',   -- chat, "You have a new message from Dan Podasca"
  '282cbab1-094c-471e-ad0e-9a742165b642',   -- chat, "You have a new message from Dan Podasca"
  '34a3c229-096c-4e17-bb3a-bf41050ed0b6',   -- "Disponibilita' Lea Bag cocco beige"
  '39f73c4f-1b6e-44b8-9ddf-276f5179fe16',   -- form, "New customer message on 1 August 2026 at 17:38"
  '609d010d-e8c6-4b47-a3e4-1729ca734858',   -- "Ordine 9999, quando arriva?"
  '8ff10c17-d55c-4c82-a208-5baa1793a111',   -- spam SEO arrivato alla casella di prova (era gia' rumore)
  '960a2035-07bd-4e7c-b829-fdb2023885ae',   -- form, "New customer message on 1 August 2026 at 17:45"
  'a22d4069-2fb8-4e35-844f-a4906b67cc7c',   -- "Question about the Nina Bag"
  'a6876983-e994-4b07-a72b-3afa0f942c8f',   -- "Disponibilita' Lea Bag cocco beige"
  'ad794c14-d782-44b5-9350-bb2cdf849aee',   -- "Aggiornamento ordine 1601"
  'e9cc5696-ce41-4a4e-afbb-05cc022babf6',   -- "Vorrei restituire la borsa"
  'f2fa4d4a-4ee6-4ddd-ab87-e3e578caef42'    -- "Il manico si e' staccato"
);
