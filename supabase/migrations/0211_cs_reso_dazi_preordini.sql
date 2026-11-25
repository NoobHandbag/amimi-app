-- 0211 - chat del sito e bozze email: le decisioni di Dan del 25-11-2026 (reso A7, ritiro di pre-ordini e su misura,
-- dazi fuori UE, nome del pulsante di riassortimento, inglese verificato)
--
-- Origine: file per il team `_CLAUDE_CODE_INBOX/TESTI_chat_sito_da_approvare_2026-11-13.md` (repo hub); decisioni di Dan
-- del 25 novembre 2026, alla lettera: P2 «Si', come la chat»; ritiro di pre-ordini e su misura «No, valgono anche loro»;
-- dazi «Amimi' paga fuori UE», confermato «si li paghiamo noi»; inglese dei 15 testi (D-15) «Vanno bene cosi'». Con la
-- decisione sull'inglese sono arrivati due fatti da verificare e da correggere se servisse, e P3 da applicare se il nome
-- del pulsante sul sito era ancora quello. Letti il 25-11 in sola lettura: il pulsante di riassortimento e' «Avvisami
-- quando torna disponibile» anche su /en/ (il form Klaviyo e' solo in italiano dal 20-11), quindi P3 si applica; l'email
-- di ritiro alle clienti inglesi e' il modello standard di Shopify, titolo «Your order is ready for pickup».
--
-- Cosa fa, solo su tabelle del modulo cs_* (Regola Ferrea 19), con UPDATE difensive come la 0184 e la 0199: ogni frase
-- vecchia deve esserci esattamente come scritta qui, altrimenti la migrazione solleva invece di sovrascrivere.
--   1. P2, come la voce 7 della chat: rimborso entro 14 giorni dall'accettazione del reso, dopo il controllo che la borsa
--      sia in perfette condizioni; niente etichette di reso; su misura e ordini speciali non si restituiscono. In A7
--      (`cs_faq` 13, italiano e inglese), nell'esempio di tono del reso (`cs_faq` 5, che le bozze vedono sempre) e nella
--      conoscenza: `cs_knowledge` 2 (valori operativi, in ogni bozza) e 8 (linee guida del reso), che dicevano "entro 14
--      giorni dal rientro" (Gate 2, B1). Le stesse due frasi nel codice di cs-assist sono la v34.
--   2. Ritiro: `cs_knowledge` 2 non esclude piu' pre-ordini e pezzi su misura. La voce 2 della chat resta com'e'.
--   3. Dazi: la voce 3 della chat (`cs_faq` 39, bottone Spedizioni) dice che fuori dall'UE dazi e tasse di importazione li
--      paga Amimì. La conoscenza delle bozze email non parla di dazi: nulla da allineare. Informativa spedizioni,
--      Informativa rimborsi e Knowledge base di Shopify restano come sono per scelta di Dan del 25-11 («lasciamo cosi per
--      il sito per ora»).
--   4. P3: il nome vero del pulsante nella risposta standard A2 (`cs_faq` 8) e nelle linee guida del riassortimento
--      (`cs_knowledge` 5, Gate 2, C1); in inglese il nome italiano con la traduzione, come ora la voce 11 della chat
--      (`cs_faq` 47).
--   5. Voce 2 della chat (`cs_faq` 38), solo inglese: cita il titolo dell'email di ritiro, come fa l'italiano.
-- Tetto: la riga 2 resta sotto i 6.000 caratteri per categoria; la guardia della 0174 lo ricontrolla.
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
           'La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e'' a carico del cliente: non forniamo etichette di reso. Gli articoli fatti su misura o su ordine speciale non si possono restituire. Appena riceviamo la borsa e controlliamo che sia in perfette condizioni, procediamo con il rimborso sul metodo di pagamento originale, entro 14 giorni'),
         testo_en = replace(testo_en,
           'Requests must be made within 14 days of delivery and return shipping is at the customer''s expense. As soon as we receive the bag we''ll process the refund within 14 days to the original payment method',
           'Requests must be made within 14 days of delivery and return shipping is at the customer''s expense: we do not provide return labels. Made-to-measure and special-order items cannot be returned. As soon as we receive the bag and check that it is in perfect condition, we''ll process the refund to the original payment method within 14 days')
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

  -- 1 e 2: cs_knowledge 2, rimborso come la chat e ritiro anche per pre-ordini e su misura
  select count(*) into n from cs_knowledge
   where id = 2 and categoria is null
     and position('rimborso entro 14 giorni dal rientro sul metodo di pagamento originale;' in contenuto) > 0
     and position('RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria,' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 2: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(replace(contenuto,
           'rimborso entro 14 giorni dal rientro sul metodo di pagamento originale;',
           'rimborso sul metodo di pagamento originale entro 14 giorni dall''accettazione del reso, dopo il controllo delle condizioni;'),
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria,',
           'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria,'),
         updated_at = now()
   where id = 2;

  -- 1: cs_knowledge 8, linee guida del reso
  select count(*) into n from cs_knowledge
   where id = 8 and categoria = 'Reso e rimborso'
     and position('Entro: istruzioni + link resi, spese di rientro a carico del cliente, rimborso entro 14 giorni dal rientro.' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 8: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(contenuto,
           'Entro: istruzioni + link resi, spese di rientro a carico del cliente, rimborso entro 14 giorni dal rientro.',
           'Entro: istruzioni + link resi, spese di rientro a carico del cliente (niente etichette di reso), rimborso entro 14 giorni dall''accettazione del reso, dopo il controllo delle condizioni.'),
         updated_at = now()
   where id = 8;

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

  -- 4: cs_knowledge 5, linee guida del riassortimento
  select count(*) into n from cs_knowledge
   where id = 5 and categoria = 'Restock e disponibilita'
     and position('invita a iscriversi al "torna disponibile" sulla pagina prodotto' in contenuto) > 0;
  if n <> 1 then
    raise exception 'cs_knowledge id 5: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(contenuto,
           'invita a iscriversi al "torna disponibile" sulla pagina prodotto',
           'invita a toccare "Avvisami quando torna disponibile" sulla pagina prodotto'),
         updated_at = now()
   where id = 5;

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

  -- Guardia finale: nessuna riga attiva del modulo dice piu' le cose superate.
  select count(*) into n from (
    select contenuto as t from cs_knowledge where attiva
    union all select coalesce(testo_it, '') || ' ' || coalesce(testo_en, '') from cs_faq where attiva
  ) s where s.t ~* '(non per pre-ordini|a carico di chi riceve|paid by the recipient|iscriv\w* al "torna disponibile"|"back in stock" alert|Appena (riceviamo|ci arriva) la borsa procediamo|we receive the bag we''ll process|dal rientro)';
  if n <> 0 then
    raise exception 'restano % righe cs_* attive con testi superati dalle decisioni del 25-11', n;
  end if;

  -- Controllo positivo: le frasi nuove ci sono davvero.
  select count(*) into n from cs_faq
   where (id = 13 and position('non forniamo etichette di reso' in testo_it) > 0 and position('su misura o su ordine speciale non si possono restituire' in testo_it) > 0
                  and position('controlliamo che sia in perfette condizioni' in testo_it) > 0
                  and position('we do not provide return labels' in testo_en) > 0 and position('Made-to-measure and special-order items cannot be returned' in testo_en) > 0
                  and position('check that it is in perfect condition' in testo_en) > 0)
      or (id = 5 and position('controlliamo che sia in perfette condizioni, procediamo col rimborso' in testo_it) > 0)
      or (id = 39 and position('li paga Amimì.' in testo_it) > 0 and position('are paid by Amimì.' in testo_en) > 0)
      or (id = 8 and position('Tocca "Avvisami quando torna disponibile"' in testo_it) > 0 and position('Tap "Avvisami quando torna disponibile"' in testo_en) > 0)
      or (id = 47 and position('"Avvisami quando torna disponibile" (notify me when it is back in stock):' in testo_en) > 0)
      or (id = 38 and position('the email "Your order is ready for pickup"' in testo_en) > 0);
  if n <> 6 then
    raise exception 'frasi nuove in % righe di cs_faq su 6', n;
  end if;
  select count(*) into n from cs_knowledge
   where (id = 2 and position('RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, lun-ven 8:00-13:00' in contenuto) > 0
                 and position('entro 14 giorni dall''accettazione del reso, dopo il controllo delle condizioni;' in contenuto) > 0)
      or (id = 8 and position('(niente etichette di reso), rimborso entro 14 giorni dall''accettazione del reso' in contenuto) > 0)
      or (id = 5 and position('invita a toccare "Avvisami quando torna disponibile"' in contenuto) > 0);
  if n <> 3 then
    raise exception 'frasi nuove in % righe di cs_knowledge su 3', n;
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
