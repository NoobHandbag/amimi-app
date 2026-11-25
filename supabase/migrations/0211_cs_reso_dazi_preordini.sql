-- 0211 - chat del sito e bozze email: le decisioni di Dan del 25-11-2026 (reso A7, ritiro di pre-ordini e su misura,
-- dazi fuori UE, nome del pulsante di riassortimento, inglese verificato)
--
-- Origine: file per il team `_CLAUDE_CODE_INBOX/TESTI_chat_sito_da_approvare_2026-11-13.md` (repo hub); decisioni di Dan
-- del 25 novembre 2026, alla lettera: P2 «Si', come la chat»; ritiro di pre-ordini e su misura «No, valgono anche loro»;
-- dazi «Amimi' paga fuori UE»; inglese dei 15 testi (D-15) «Vanno bene cosi'», con due fatti da verificare (letti il 25-11
-- in sola lettura: il pulsante di riassortimento e' «Avvisami quando torna disponibile» anche su /en/, perche' il form
-- Klaviyo e' solo in italiano dal 20-11; l'email di ritiro alle clienti inglesi e' il modello standard di Shopify,
-- titolo «Your order is ready for pickup»).
--
-- Cosa fa, solo su tabelle del modulo cs_* (Regola Ferrea 19), con UPDATE difensive come la 0184 e la 0199: ogni frase
-- vecchia deve esserci esattamente come scritta qui, altrimenti la migrazione solleva invece di sovrascrivere.
--   1. P2, risposta standard A7 (`cs_faq` 13), italiano e inglese: il rimborso parte dopo il controllo che la borsa sia in
--      perfette condizioni; niente etichette di reso; il su misura non si restituisce. La stessa frase del rimborso
--      nell'esempio di tono del reso (`cs_faq` 5), che le bozze vedono sempre (6 esempi, cs-assist ne prende 6).
--   2. Ritiro: `cs_knowledge` 2 non esclude piu' pre-ordini e pezzi su misura. La voce 2 della chat resta com'e'.
--   3. Dazi: la voce 3 della chat (`cs_faq` 39, bottone Spedizioni) dice che fuori dall'UE dazi e tasse di importazione li
--      paga Amimì. La conoscenza delle bozze email non parla di dazi: nulla da allineare. Informativa spedizioni e Knowledge
--      base di Shopify dicono ancora "a carico di chi riceve": non si toccano qui (pendenti di Dan).
--   4. P3, risposta standard A2 (`cs_faq` 8): il nome vero del pulsante; in inglese il nome italiano con la traduzione, come
--      nella voce 11 della chat (`cs_faq` 47), che in inglese ora lo nomina.
--   5. Voce 2 della chat (`cs_faq` 38), solo inglese: cita il titolo dell'email di ritiro, come fa l'italiano.
-- Tetto: la riga 2 si accorcia; la guardia della 0174 ricontrolla i 6.000 caratteri per categoria.
-- Rollback: le stesse replace al contrario (le frasi di prima sono scritte qui sotto, nelle condizioni).

do $$
declare
  n int;
  peggiore int;
begin
  -- 1: A7 reso (P2), italiano e inglese
  select count(*) into n from cs_faq
   where id = 13 and tipo = 'risposta_standard' and categoria = 'Reso e rimborso'
     and position('La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e'' a carico del cliente. Appena riceviamo la borsa procediamo con il rimborso, entro 14 giorni sul metodo di pagamento originale' in testo_it) > 0
     and position('Requests must be made within 14 days of delivery and return shipping is at the customer''s expense. As soon as we receive the bag we''ll process the refund within 14 days to the original payment method' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 13: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e'' a carico del cliente. Appena riceviamo la borsa procediamo con il rimborso, entro 14 giorni sul metodo di pagamento originale',
           'La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e'' a carico del cliente: non forniamo etichette di reso. Gli articoli fatti su misura non si possono restituire. Appena riceviamo la borsa e controlliamo che sia in perfette condizioni, procediamo con il rimborso sul metodo di pagamento originale, entro 14 giorni'),
         testo_en = replace(testo_en,
           'Requests must be made within 14 days of delivery and return shipping is at the customer''s expense. As soon as we receive the bag we''ll process the refund within 14 days to the original payment method',
           'Requests must be made within 14 days of delivery and return shipping is at the customer''s expense: we do not provide return labels. Made-to-measure items cannot be returned. As soon as we receive the bag and check that it is in perfect condition, we''ll process the refund to the original payment method within 14 days')
   where id = 13;

  -- 1: esempio di tono del reso (solo italiano)
  select count(*) into n from cs_faq
   where id = 5 and tipo = 'esempio_tono' and categoria = 'Reso e rimborso'
     and position('Appena ci arriva la borsa procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale' in testo_it) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 5: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'Appena ci arriva la borsa procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale',
           'Appena ci arriva la borsa e controlliamo che sia in perfette condizioni, procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale')
   where id = 5;

  -- 2: cs_knowledge 2, ritiro anche per pre-ordini e su misura
  select count(*) into n from cs_knowledge
   where id = 2 and categoria is null
     and position('RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria,' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 2: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(contenuto,
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria,',
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria,'),
         updated_at = now()
   where id = 2;

  -- 3: dazi fuori UE, voce 3 della chat (bottone Spedizioni)
  select count(*) into n from cs_faq
   where id = 39 and tipo = 'risposta_chat' and titolo like 'faq-costi-e-tempi-spedizione:%'
     and position('Fuori dall''Unione Europea dazi e tasse di importazione sono a carico di chi riceve il pacco.' in testo_it) > 0
     and position('Outside the European Union, import duties and taxes are paid by the recipient.' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 39: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'Fuori dall''Unione Europea dazi e tasse di importazione sono a carico di chi riceve il pacco.',
           'Per le spedizioni fuori dall''Unione Europea dazi e tasse di importazione li paga Amimì.'),
         testo_en = replace(testo_en,
           'Outside the European Union, import duties and taxes are paid by the recipient.',
           'For shipments outside the European Union, import duties and taxes are paid by Amimì.')
   where id = 39;

  -- 4: A2 riassortimento (P3), italiano e inglese
  select count(*) into n from cs_faq
   where id = 8 and tipo = 'risposta_standard' and categoria = 'Restock e disponibilita'
     and position('Iscriviti al "torna disponibile" sulla pagina del prodotto ([link])' in testo_it) > 0
     and position('Sign up for the "back in stock" alert on the product page ([link])' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 8: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it,
           'Iscriviti al "torna disponibile" sulla pagina del prodotto ([link])',
           'Tocca "Avvisami quando torna disponibile" sulla pagina del prodotto ([link])'),
         testo_en = replace(testo_en,
           'Sign up for the "back in stock" alert on the product page ([link])',
           'Tap "Avvisami quando torna disponibile" (notify me when it is back in stock) on the product page ([link])')
   where id = 8;

  -- 4: voce 11 della chat, solo inglese
  select count(*) into n from cs_faq
   where id = 47 and tipo = 'risposta_chat' and titolo like 'faq-riassortimento:%'
     and position('On the page of a sold-out product there is a button to be notified when it is back in stock:' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 47: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_en = replace(testo_en,
           'On the page of a sold-out product there is a button to be notified when it is back in stock:',
           'On the page of a sold-out product there is a button, "Avvisami quando torna disponibile" (notify me when it is back in stock):')
   where id = 47;

  -- 5: voce 2 della chat, solo inglese
  select count(*) into n from cs_faq
   where id = 38 and tipo = 'risposta_chat' and titolo like 'faq-ritiro-di-persona:%'
     and position('Please come only after you have received the email telling you that your order is ready for pickup.' in testo_en) > 0;
  if n <> 1 then
    raise exception 'cs_faq id 38: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_en = replace(testo_en,
           'Please come only after you have received the email telling you that your order is ready for pickup.',
           'Please come only after you have received the email "Your order is ready for pickup".')
   where id = 38;

  -- Guardie finali: nessuna riga attiva del modulo dice piu' le cose superate.
  select count(*) into n from (
    select contenuto as t from cs_knowledge where attiva
    union all select coalesce(testo_it, '') || ' ' || coalesce(testo_en, '') from cs_faq where attiva
  ) s where s.t ~* '(non per pre-ordini|a carico di chi riceve|paid by the recipient|Iscriviti al "torna disponibile"|"back in stock" alert|Appena (riceviamo|ci arriva) la borsa procediamo|we receive the bag we''ll process)';
  if n <> 0 then
    raise exception 'restano % righe cs_* attive con testi superati dalle decisioni del 25-11', n;
  end if;

  -- Controllo positivo: le frasi nuove ci sono davvero.
  select count(*) into n from cs_faq
   where (id = 13 and position('non forniamo etichette di reso' in testo_it) > 0 and position('su misura non si possono restituire' in testo_it) > 0
                  and position('controlliamo che sia in perfette condizioni' in testo_it) > 0
                  and position('we do not provide return labels' in testo_en) > 0 and position('Made-to-measure items cannot be returned' in testo_en) > 0
                  and position('check that it is in perfect condition' in testo_en) > 0)
      or (id = 5 and position('controlliamo che sia in perfette condizioni, procediamo col rimborso' in testo_it) > 0)
      or (id = 39 and position('li paga Amimì.' in testo_it) > 0 and position('are paid by Amimì.' in testo_en) > 0)
      or (id = 8 and position('Tocca "Avvisami quando torna disponibile"' in testo_it) > 0 and position('Tap "Avvisami quando torna disponibile"' in testo_en) > 0)
      or (id = 47 and position('"Avvisami quando torna disponibile" (notify me when it is back in stock):' in testo_en) > 0)
      or (id = 38 and position('the email "Your order is ready for pickup"' in testo_en) > 0);
  if n <> 6 then
    raise exception 'frasi nuove in % righe di cs_faq su 6', n;
  end if;
  select count(*) into n from cs_knowledge where id = 2 and position('RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, lun-ven 8:00-13:00' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 2: frase nuova del ritiro non trovata dopo l''update';
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
