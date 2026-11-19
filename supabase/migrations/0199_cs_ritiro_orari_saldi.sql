-- 0199 - chat del sito e bozze email: le decisioni di Dan del 19-11-2026 su resi dei saldi, orari del ritiro e P5
--
-- Origine: file per il team `_CLAUDE_CODE_INBOX/TESTI_chat_sito_da_approvare_2026-11-13.md` (repo hub), sez. 3,
-- proposte P1, P5 e P8; decisioni di Dan del 19 novembre 2026, alla lettera: «Email come la chat» (resi dei saldi),
-- «Orari fissi» (ritiro in sede), «Code applica le minori» (P4 e P5; P4 e' un flag e la fa la sessione delle prove).
--
-- Cosa fa, solo su tabelle del modulo cs_* (Regola Ferrea 19), con UPDATE difensive come la 0184: ogni frase vecchia
-- deve esserci esattamente come scritta qui, altrimenti la migrazione solleva invece di sovrascrivere (riga cambiata a
-- mano, per esempio un bottone dalla scheda Chat).
--   1. Saldi: `cs_knowledge` 2 (valori operativi correnti, entra in ogni bozza email) smette di escludere da cambi e
--      resi gli articoli in saldo o in promozione, come la voce 7 del bottone Resi della chat (`cs_faq` 43), che non li
--      esclude. L'Informativa sui rimborsi di Shopify li esclude ancora: non si tocca qui (pendente di Dan e del legale).
--   2. Ritiro: gli orari fissi della portineria della voce 2 (`cs_faq` 38, decisione D3 del 3-11) entrano in
--      `cs_knowledge` 2 e 6, nella risposta standard A3 (`cs_faq` 9, P1 come scritta nel file) e nell'esempio di tono
--      del ritiro (`cs_faq` 3, che diceva la stessa cosa di A3 e che le bozze vedono sempre: ci sono 6 esempi di tono e
--      cs-assist ne prende 6). Spariscono "non esistono orari pubblicati" e "concorda giorno e fascia oraria". La frase
--      "non per pre-ordini o personalizzati" di `cs_knowledge` 2 resta com'e' (domanda ancora aperta per il team). In
--      `cs_knowledge` 6 la vecchia frase valeva anche per lo showroom di Via Plinio, che resta su appuntamento: la riga nuova
--      dice che giorno e ora dello showroom si fissano con la cliente (Gate 2, B1).
--   3. P5: nelle voci 5, 6 e 13 della chat (`cs_faq` 41, 42, 49, tipo `risposta_chat`, che le bozze email non leggono)
--      "lascia in chat nome, email..." diventa "scrivi qui...": nella chat l'email la cliente l'ha gia' data. La Knowledge
--      base di Shopify resta com'e'.
-- Tetto: cs-assist prende al massimo 6.000 caratteri di conoscenza per categoria, in ordine di id, e si ferma al primo
-- sforamento (al 19-11 Codice sconto e' a 5.902): la riga 2 nuova e' piu' corta della vecchia e la guardia della 0174
-- lo ricontrolla qui, contando come JavaScript.
-- Rollback: le stesse replace al contrario (le frasi di prima sono scritte qui sotto, nelle condizioni).

do $$
declare
  n int;
  peggiore int;
begin
  -- 1 e 2: cs_knowledge 2
  select count(*) into n from cs_knowledge
   where id = 2 and categoria is null
     and position('; articoli in saldo o comprati durante promozioni speciali: NIENTE cambi ne'' resi. DIFETTI:' in contenuto) > 0
     and position('RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati).' in contenuto) > 0
     and position('RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano; niente orari fissi: si concorda la fascia col cliente, mai inventare orari.' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 2: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(replace(replace(contenuto,
           '; articoli in saldo o comprati durante promozioni speciali: NIENTE cambi ne'' resi. DIFETTI:',
           '. DIFETTI:'),
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati).',
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria, lun-ven 8:00-13:00 e 14:00-17:00, sabato 8:00-11:00.'),
           'RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano; niente orari fissi: si concorda la fascia col cliente, mai inventare orari.',
           'RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano. Gli unici orari della portineria sono quelli del ritiro: mai inventarne altri.'),
         updated_at = now()
   where id = 2;

  -- 2: cs_knowledge 6 (linee guida del ritiro), testo intero
  select count(*) into n from cs_knowledge
   where id = 6 and categoria = 'Ritiro, negozio, appuntamenti'
     and contenuto = 'Ordini online: ritiro in Via Santa Maria Fulcorina 13, 20123 Milano. Showroom e prove borse: Via Plinio 43, 20129 Milano su appuntamento. Concorda giorno e fascia oraria col cliente: NON esistono orari pubblicati, mai inventarli.';
  if n <> 1 then
    raise exception 'cs_knowledge id 6: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = 'Ordini online: ritiro in Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, dal lunedi'' al venerdi'' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00: sono gli unici orari del ritiro, mai inventarne altri. Showroom e prove borse: Via Plinio 43, 20129 Milano, solo su appuntamento: lo showroom non ha orari di apertura, giorno e ora si fissano con la cliente.',
         updated_at = now()
   where id = 6;

  -- 2: A3 ritiro (P1), italiano e inglese
  select count(*) into n from cs_faq
   where id = 9 and tipo = 'risposta_standard' and categoria = 'Ritiro, negozio, appuntamenti'
     and position('Fammi sapere che giorno e in quale fascia oraria preferisci passare, cosi'' ci organizziamo.' in testo_it) > 0
     and position('Let me know which day and time slot works best for you so we can arrange it.' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 9: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'Fammi sapere che giorno e in quale fascia oraria preferisci passare, cosi'' ci organizziamo.',
           'Puoi passare in portineria dal lunedi'' al venerdi'' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00.'),
         testo_en = replace(testo_en,
           'Let me know which day and time slot works best for you so we can arrange it.',
           'You can collect it from the building''s concierge (portineria), Monday to Friday 8:00-13:00 and 14:00-17:00, Saturday 8:00-11:00.')
   where id = 9;

  -- 2: esempio di tono del ritiro (solo italiano)
  select count(*) into n from cs_faq
   where id = 3 and tipo = 'esempio_tono' and categoria = 'Ritiro, negozio, appuntamenti'
     and position('Fammi sapere che giorno e in che fascia oraria pensi di venire, cosi'' ti prepariamo tutto.' in testo_it) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 3: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'Fammi sapere che giorno e in che fascia oraria pensi di venire, cosi'' ti prepariamo tutto.',
           'Il ritiro e'' in portineria, dal lunedi'' al venerdi'' 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00.')
   where id = 3;

  -- 3: P5, solo righe della chat
  select count(*) into n from cs_faq
   where id = 41 and tipo = 'risposta_chat' and titolo like 'faq-dove-e-il-mio-ordine:%'
     and position('oppure lascia in chat nome, email e numero d''ordine (lo trovi nell''email di conferma dell''ordine). Il team ti risponde via email appena possibile.' in testo_it) > 0
     and position('or leave your name, email and order number in the chat (you will find it in the order confirmation email). Our team will reply by email as soon as possible.' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 41: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'oppure lascia in chat nome, email e numero d''ordine (lo trovi nell''email di conferma dell''ordine). Il team ti risponde via email appena possibile.',
           'oppure scrivi qui il numero d''ordine (lo trovi nell''email di conferma dell''ordine): il team ti risponde via email appena possibile.'),
         testo_en = replace(testo_en,
           'or leave your name, email and order number in the chat (you will find it in the order confirmation email). Our team will reply by email as soon as possible.',
           'or write your order number here (you will find it in the order confirmation email): our team will reply by email as soon as possible.')
   where id = 41;

  select count(*) into n from cs_faq
   where id = 42 and tipo = 'risposta_chat' and titolo like 'faq-annullare-modificare-ordine:%'
     and position('oppure lascialo in chat con nome ed email:' in testo_it) > 0
     and position('or leave it in the chat with your name and email:' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 42: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it, 'oppure lascialo in chat con nome ed email:', 'oppure scrivilo qui:'),
         testo_en = replace(testo_en, 'or leave it in the chat with your name and email:', 'or write it here:')
   where id = 42;

  select count(*) into n from cs_faq
   where id = 49 and tipo = 'risposta_chat' and titolo like 'faq-contatti:%'
     and position('oppure lascia in chat nome, email e domanda:' in testo_it) > 0
     and position('or leave your name, email and question in the chat:' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 49: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it, 'oppure lascia in chat nome, email e domanda:', 'oppure scrivi qui la tua domanda:'),
         testo_en = replace(testo_en, 'or leave your name, email and question in the chat:', 'or write your question here:')
   where id = 49;

  -- Nessuna riga attiva del modulo deve piu' dire "concorda la fascia" o "niente orari" per il ritiro, ne' escludere i
  -- saldi dai resi; nessuna voce della chat deve piu' chiedere nome ed email.
  select count(*) into n from (
    select contenuto as t from cs_knowledge where attiva
    union all select coalesce(testo_it, '') || ' ' || coalesce(testo_en, '') from cs_faq where attiva
  ) s where s.t ~* '(fascia oraria|concorda la fascia|orari pubblicati|niente orari fissi|time slot|in saldo o comprati|NIENTE cambi ne. resi)';
  if n <> 0 then
    raise exception 'restano % righe cs_* attive con orari da concordare o saldi esclusi dai resi', n;
  end if;
  select count(*) into n from cs_faq
   where attiva and tipo = 'risposta_chat'
     and (coalesce(testo_it, '') || ' ' || coalesce(testo_en, '')) ~* '(in chat nome|in chat con nome|your name, email|with your name and email)';
  if n <> 0 then
    raise exception 'restano % voci della chat che chiedono nome ed email', n;
  end if;

  -- Controllo positivo (Gate 2, C2): le frasi nuove ci sono davvero, cosi' un refuso nella frase cercata da replace() non
  -- lascia una riga senza orari pur passando la guardia qui sopra.
  select count(*) into n from (
    select contenuto as t from cs_knowledge where id in (2, 6)
    union all select testo_it from cs_faq where id in (3, 9)
    union all select testo_en from cs_faq where id = 9
  ) s where position('8:00-13:00' in s.t) > 0 and position('14:00-17:00' in s.t) > 0 and position('8:00-11:00' in s.t) > 0
          and position('portineria' in s.t) > 0;
  if n <> 5 then
    raise exception 'orari della portineria in % righe su 5 (cs_knowledge 2 e 6, cs_faq 3, 9 it e en)', n;
  end if;
  select count(*) into n from cs_knowledge where id = 2 and position('in perfette condizioni con etichette originali. DIFETTI:' in contenuto) > 0
     and position('Milano (non per pre-ordini o personalizzati), in portineria' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 2: frasi nuove non trovate dopo l''update';
  end if;
  select count(*) into n from cs_knowledge where id = 6 and position('giorno e ora si fissano con la cliente' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 6: frase dello showroom non trovata dopo l''update';
  end if;
  select count(*) into n from cs_faq
   where (id = 41 and position('oppure scrivi qui il numero d''ordine' in testo_it) > 0 and position('or write your order number here' in testo_en) > 0)
      or (id = 42 and position('oppure scrivilo qui:' in testo_it) > 0 and position('or write it here:' in testo_en) > 0)
      or (id = 49 and position('oppure scrivi qui la tua domanda:' in testo_it) > 0 and position('or write your question here:' in testo_en) > 0);
  if n <> 3 then
    raise exception 'P5: frasi nuove in % voci della chat su 3', n;
  end if;

  -- guardia sul tetto di cs-assist (0174), contata come JavaScript (unita' UTF-16: un carattere fuori dal BMP conta 2),
  -- per ogni categoria del classificatore: righe con categoria NULL piu' quelle della categoria.
  select max(tot) into peggiore from (
    select (select coalesce(sum(length(r.s) + (select count(*) from regexp_matches(r.s, '[\U00010000-\U0010FFFF]', 'g'))), 0)
              from (select '[' || k.titolo || '] ' || coalesce(k.contenuto, '') as s
                      from cs_knowledge k
                     where k.attiva and (k.categoria is null or k.categoria = c.categoria)) r) as tot
      from (select distinct categoria from cs_knowledge where categoria is not null
            union all select null) c
  ) x;
  if peggiore > 6000 then
    raise exception 'conoscenza oltre il tetto di cs-assist: % caratteri in una categoria (max 6000)', peggiore;
  end if;
end $$;
