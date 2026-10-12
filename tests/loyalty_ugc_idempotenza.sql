-- tests/loyalty_ugc_idempotenza.sql: prova VIVA e SENZA RESIDUI delle funzioni della migr 0153 (Premia: recensioni e foto
-- delle borse) sull'account di test 10147859530055.
--   Si lancia con il connettore Supabase (execute_sql) o con psql: e' un unico blocco DO che scrive, verifica e alla
--   fine ALZA SEMPRE un'eccezione, cosi' ogni scrittura viene annullata (rollback) e il DB resta com'era. Le "foto" sono
--   righe di storage.objects create e annullate nella stessa transazione: nessun file vero.
--   Esito atteso: ERROR "TEST_OK: ... (rollback voluto)". Qualsiasi altro messaggio = un'asserzione fallita.
--   Cosa prova:
--     F  flag spento o cliente fuori lista -> 'off', nessuna scrittura
--     V  invii rifiutati a DB, nessuna riga: idemp, tipo, consenso, borsa, stelle, testo, foto (troppe, altrui, mancanti),
--        recensione di una borsa non comprata online
--     S  posti per caricare: 12 al giorno, atomici
--     R  recensione: una riga in revisione, verificata; stesso idemp = stessa riga; stessa borsa = already_sent; nessun punto
--     K  look con foto caricata; la stessa foto non vale per un secondo invio
--     Q  coda e decisione: senza login @amimi.it = 42501
--     A  approvazione: +20 una volta sola (seconda = already), una riga nel ledger col riferimento all'invio
--     X  rifiuto: motivo obbligatorio, nessun punto, la borsa torna proponibile
--     U  il vincolo UNIQUE su loyalty_events regge anche fuori dalla funzione
--     T  tetto di 5 invii in 24 ore
--     I  cosa vede la cliente: i suoi invii senza percorsi delle foto, il catalogo, i punti per tipo
--     L  ledger: v_loyalty_ledger_drift senza scarti alla fine
do $$
declare
  c   constant text := '10147859530055';
  c2  constant text := 'TEST_0153_B';
  p0 int; n int; r jsonb; v_bag text; v_altre text[]; f1 text; f2 text; f3 text; f4 text; f5 text; id_rec bigint; id_look bigint;
begin
  select points into p0 from loyalty_points where shopify_customer_id = c;
  if p0 is null then raise exception 'account di test % non e'' membro', c; end if;
  if exists (select 1 from loyalty_ugc where shopify_customer_id = c) then raise exception 'invii di prova gia'' presenti: pulire prima'; end if;
  -- una borsa comprata online dal cliente di test (serve per la recensione verificata) e tre borse a catalogo non sue
  select coalesce(nullif(li.codice_norm, ''), li.codice) into v_bag
    from loyalty_order_credits oc join shopify_line_items li on li.order_id = oc.order_name
    where oc.shopify_customer_id = c and coalesce(nullif(li.codice_norm, ''), li.codice) ~ '^[A-Z0-9_]{3,80}$' limit 1;
  if v_bag is null then raise exception 'il cliente di test non ha borse comprate online: la prova R non si puo'' fare'; end if;
  select array_agg(codice) into v_altre from (
    select distinct codice from shopify_stock where shopify_status = 'active' and codice ilike '%\_BAG\_%' and shopify_title is not null and codice <> v_bag
      and not exists (select 1 from loyalty_order_credits oc join shopify_line_items li on li.order_id = oc.order_name
                      where oc.shopify_customer_id = c and coalesce(nullif(li.codice_norm, ''), li.codice) = shopify_stock.codice)
    order by codice limit 5) s;
  if coalesce(array_length(v_altre, 1), 0) < 5 then raise exception 'servono 5 borse a catalogo non comprate dal cliente di test'; end if;
  f1 := c || '/20261012-' || gen_random_uuid() || '.jpg';  f2 := c || '/20261012-' || gen_random_uuid() || '.jpg';
  f3 := c || '/20261012-' || gen_random_uuid() || '.jpg';  f4 := c || '/20261012-' || gen_random_uuid() || '.jpg';
  f5 := c || '/20261012-' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name) values ('loyalty-ugc', f1), ('loyalty-ugc', f2), ('loyalty-ugc', f3), ('loyalty-ugc', f4), ('loyalty-ugc', f5);

  -- F: flag spento, poi acceso SOLO per il cliente di test
  update app_flags set value = 'false' where key = 'loyalty_ugc_enabled';
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 5, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-f');
  if (r->>'ok')::bool or r->>'reason' <> 'off' then raise exception 'F flag spento (invio): %', r; end if;
  r := loyalty_ugc_slot(c, 1);
  if (r->>'ok')::bool or r->>'reason' <> 'off' then raise exception 'F flag spento (posti): %', r; end if;
  update app_flags set value = c where key = 'loyalty_ugc_enabled';
  r := loyalty_ugc_submit(c2, 'look', v_altre[1], null, null, null, array[f1], true, 'test-0153-f2');
  if (r->>'ok')::bool or r->>'reason' <> 'off' then raise exception 'F cliente fuori lista: %', r; end if;
  if exists (select 1 from loyalty_ugc where shopify_customer_id in (c, c2)) or exists (select 1 from loyalty_ugc_slots where shopify_customer_id = c) then raise exception 'F ha scritto a flag spento'; end if;

  -- V: invii rifiutati, nessuna riga
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 5, 'Bellissima, la porto ovunque.', null, '{}', true, 'corto');
  if r->>'reason' <> 'bad_request' then raise exception 'V idemp corto: %', r; end if;
  r := loyalty_ugc_submit(c, 'video', v_bag, 5, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-v1');
  if r->>'reason' <> 'bad_request' then raise exception 'V tipo: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 5, 'Bellissima, la porto ovunque.', null, '{}', false, 'test-0153-v2');
  if r->>'reason' <> 'no_consent' then raise exception 'V consenso: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', 'borsa; drop', 5, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-v3');
  if r->>'reason' <> 'unknown_bag' then raise exception 'V codice: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, null, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-v4');
  if r->>'reason' <> 'bad_rating' then raise exception 'V stelle mancanti: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 6, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-v5');
  if r->>'reason' <> 'bad_rating' then raise exception 'V sei stelle: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 5, '  Bella  ', null, '{}', true, 'test-0153-v6');
  if r->>'reason' <> 'short_text' then raise exception 'V testo corto: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, null, null, '{}', true, 'test-0153-v7');
  if r->>'reason' <> 'no_photo' then raise exception 'V look senza foto: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, null, null, array[f1, f2, f3, f4], true, 'test-0153-v8');
  if r->>'reason' <> 'too_many_photos' then raise exception 'V quattro foto: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, null, null, array['999/20261012-' || gen_random_uuid() || '.jpg'], true, 'test-0153-v9');
  if r->>'reason' <> 'bad_photo' then raise exception 'V foto di un altro cliente: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, null, null, array[f1, f1], true, 'test-0153-v10');
  if r->>'reason' <> 'bad_photo' then raise exception 'V foto doppia: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, null, null, array[c || '/20261012-' || gen_random_uuid() || '.jpg'], true, 'test-0153-v11');
  if r->>'reason' <> 'photo_missing' then raise exception 'V foto mai caricata: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_altre[1], 5, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-v12');
  if r->>'reason' <> 'not_bought' then raise exception 'V recensione di una borsa non comprata: %', r; end if;
  if exists (select 1 from loyalty_ugc where shopify_customer_id = c) then raise exception 'V ha scritto una riga'; end if;

  -- S: posti per caricare, 12 al giorno
  r := loyalty_ugc_slot(c, 3);
  if not (r->>'ok')::bool or (r->>'used')::int <> 3 then raise exception 'S primi tre: %', r; end if;
  r := loyalty_ugc_slot(c, 4);
  if r->>'reason' <> 'bad_request' then raise exception 'S quattro in una volta: %', r; end if;
  perform loyalty_ugc_slot(c, 3); perform loyalty_ugc_slot(c, 3); r := loyalty_ugc_slot(c, 3);
  if not (r->>'ok')::bool or (r->>'used')::int <> 12 then raise exception 'S fino a 12: %', r; end if;
  r := loyalty_ugc_slot(c, 1);
  if (r->>'ok')::bool or r->>'reason' <> 'limit' then raise exception 'S oltre 12: %', r; end if;
  if (select n from loyalty_ugc_slots where shopify_customer_id = c) <> 12 then raise exception 'S contatore sforato'; end if;

  -- R: recensione verificata, una sola riga, nessun punto
  r := loyalty_ugc_submit(c, 'recensione', lower(v_bag), 4, '  Bellissima, la porto ovunque.  ', ' Giulia M. ', '{}', true, 'test-0153-r1');
  if not (r->>'ok')::bool or (r->>'already')::bool or r->>'status' <> 'in_revisione' or (r->>'punti')::int <> 20 or not (r->>'verificata')::bool then raise exception 'R primo invio: %', r; end if;
  id_rec := (r->>'id')::bigint;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 4, 'Bellissima, la porto ovunque.', null, '{}', true, 'test-0153-r1');
  if not (r->>'ok')::bool or not (r->>'already')::bool or (r->>'id')::bigint <> id_rec then raise exception 'R stesso idemp: %', r; end if;
  r := loyalty_ugc_submit(c, 'recensione', v_bag, 2, 'Ripensandoci, cambio voto alla borsa.', null, '{}', true, 'test-0153-r2');
  if (r->>'ok')::bool or r->>'reason' <> 'already_sent' then raise exception 'R stessa borsa: %', r; end if;
  if (select count(*) from loyalty_ugc where shopify_customer_id = c) <> 1 then raise exception 'R righe'; end if;
  if (select testo || '|' || firma || '|' || codice from loyalty_ugc where id = id_rec) <> 'Bellissima, la porto ovunque.|Giulia M.|' || v_bag then raise exception 'R testo, firma o codice non normalizzati'; end if;
  if (select consenso_testo from loyalty_ugc where id = id_rec) <> loyalty_ugc_consenso() then raise exception 'R consenso non salvato col testo del server'; end if;
  if (select points from loyalty_points where shopify_customer_id = c) <> p0 then raise exception 'R l''invio ha mosso i punti'; end if;

  -- K: look con una foto caricata; la stessa foto non vale due volte
  r := loyalty_ugc_submit(c, 'look', v_altre[1], 3, 'Al mare con la mia borsa.', null, array[f1], true, 'test-0153-k1');
  if not (r->>'ok')::bool or (r->>'punti')::int <> 30 or (r->>'verificata')::bool then raise exception 'K look: %', r; end if;
  id_look := (r->>'id')::bigint;
  if (select rating from loyalty_ugc where id = id_look) is not null then raise exception 'K il look non ha stelle'; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[2], null, null, null, array[f1], true, 'test-0153-k2');
  if r->>'reason' <> 'bad_photo' then raise exception 'K foto riusata: %', r; end if;

  -- Q: coda e decisione senza login @amimi.it = 42501
  perform set_config('request.jwt.claims', '', true);
  begin perform loyalty_ugc_queue('in_revisione', 10); raise exception 'Q coda senza login accettata';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '{"email":"qualcuno@gmail.com"}', true);
  begin perform loyalty_ugc_decide(id_rec, 'approva', null); raise exception 'Q decisione da un account esterno accettata';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '{"email":"prova@amimi.it"}', true);
  r := loyalty_ugc_queue('in_revisione', 200);
  if (r->'conteggi'->>'in_revisione')::int < 2 or not exists (select 1 from jsonb_array_elements(r->'items') e where (e->>'id')::bigint = id_look and e->'foto' = to_jsonb(array[f1])) then raise exception 'Q la coda non mostra il look coi percorsi: %', r->'conteggi'; end if;

  -- A: approvazione, una volta sola
  r := loyalty_ugc_decide(id_rec, 'approva', null);
  if not (r->>'ok')::bool or (r->>'already')::bool or (r->>'punti')::int <> 20 or (r->>'saldo')::int <> p0 + 20 then raise exception 'A approva: %', r; end if;
  r := loyalty_ugc_decide(id_rec, 'approva', null);
  if not (r->>'already')::bool or r->>'deciso_da' <> 'prova@amimi.it' then raise exception 'A seconda approvazione: %', r; end if;
  r := loyalty_ugc_decide(id_rec, 'rifiuta', 'ci ho ripensato');
  if not (r->>'already')::bool or (select status from loyalty_ugc where id = id_rec) <> 'approvata' then raise exception 'A un rifiuto dopo l''approvazione ha cambiato la riga: %', r; end if;
  if (select points from loyalty_points where shopify_customer_id = c) <> p0 + 20 then raise exception 'A saldo dopo tre decisioni'; end if;
  select count(*) into n from loyalty_events where shopify_customer_id = c and source = 'ugc' and meta->>'ugc' = id_rec::text and delta = 20;
  if n <> 1 then raise exception 'A righe nel ledger: % (attesa 1)', n; end if;
  if not exists (select 1 from change_log where tbl = 'loyalty_ugc' and row_id = id_rec::text and op = 'ugc_approva' and chi = 'prova@amimi.it') then raise exception 'A manca la traccia in change_log'; end if;

  -- X: rifiuto, motivo obbligatorio, nessun punto, la borsa torna proponibile
  r := loyalty_ugc_decide(id_look, 'rifiuta', ' ');
  if (r->>'ok')::bool or r->>'reason' <> 'motivo' then raise exception 'X rifiuto senza motivo: %', r; end if;
  r := loyalty_ugc_decide(id_look, 'rifiuta', 'Nella foto non si vede una borsa Amimì');
  if not (r->>'ok')::bool or r->>'status' <> 'rifiutata' then raise exception 'X rifiuto: %', r; end if;
  if (select points from loyalty_points where shopify_customer_id = c) <> p0 + 20 then raise exception 'X il rifiuto ha mosso i punti'; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[1], null, 'Riprovo con una foto migliore.', null, array[f2], true, 'test-0153-x1');
  if not (r->>'ok')::bool then raise exception 'X dopo un rifiuto la stessa borsa si puo'' rimandare: %', r; end if;

  -- U: il vincolo UNIQUE su loyalty_events regge anche fuori dalla funzione
  begin
    insert into loyalty_events (shopify_customer_id, delta, source, meta) values (c, 20, 'ugc', jsonb_build_object('ugc', id_rec::text));
    raise exception 'U un secondo evento ugc per lo stesso invio e'' stato accettato';
  exception when unique_violation then null;
  end;

  -- T: tetto di 5 invii in 24 ore (finora 3: recensione, look rifiutato, look rimandato)
  r := loyalty_ugc_submit(c, 'look', v_altre[3], null, null, null, array[f3], true, 'test-0153-t1');
  if not (r->>'ok')::bool then raise exception 'T quarto invio: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[4], null, null, null, array[f4], true, 'test-0153-t2');
  if not (r->>'ok')::bool then raise exception 'T quinto invio: %', r; end if;
  r := loyalty_ugc_submit(c, 'look', v_altre[5], null, null, null, array[f5], true, 'test-0153-t3');
  if (r->>'ok')::bool or r->>'reason' <> 'limit' then raise exception 'T sesto invio: %', r; end if;

  -- I: cosa vede la cliente
  r := loyalty_ugc_info(c);
  if (r->'punti'->>'recensione')::int <> 20 or (r->'punti'->>'look')::int <> 30 or r->>'consenso' <> loyalty_ugc_consenso() then raise exception 'I punti o consenso: %', r->'punti'; end if;
  if jsonb_array_length(r->'mine') <> 5 or jsonb_array_length(r->'catalogo') < 5 then raise exception 'I liste: % invii, % borse', jsonb_array_length(r->'mine'), jsonb_array_length(r->'catalogo'); end if;
  if exists (select 1 from jsonb_array_elements(r->'mine') e where jsonb_typeof(e->'foto') <> 'number') or position(c || '/' in r::text) > 0 then raise exception 'I alla cliente sono arrivati i percorsi delle foto'; end if;
  if exists (select 1 from jsonb_array_elements(r->'mine') e where (e->>'id')::bigint = id_look and (e->>'status' <> 'rifiutata' or e->>'motivo' <> 'Nella foto non si vede una borsa Amimì')) then raise exception 'I motivo del rifiuto'; end if;
  if loyalty_ugc_info(c2)->'mine' <> '[]'::jsonb then raise exception 'I un altro cliente vede invii non suoi'; end if;

  -- L: ledger in quadra
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L ledger fuori quadra'; end if;

  raise exception 'TEST_OK: flag, invii rifiutati a DB, posti, recensione verificata e idempotente, look con foto, accesso solo @amimi.it, approvazione una volta, rifiuto col motivo, UNIQUE, tetto, vista della cliente, ledger in quadra (rollback voluto)';
end $$;
