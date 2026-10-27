-- 0174 - conoscenza di casa: l'Area Membri e i punti Mimi' (2026-10-27, lancio del 28-10)
--
-- Origine: verifica di prontezza del lancio della comunicazione dell'Area Membri (newsletter e social
-- del 28-10, `Cowork12/projects/Premia_Area_Membri_2026-09/08_LANCIO_2026-10-28.md` nel repo hub),
-- richiesta di Dan del 27-10 ("puoi aggiustare assistenza"). Prima di questa migrazione nessuna riga
-- di `cs_knowledge` e di `cs_faq` parlava di punti, Area Membri o AMICA12. La riga 9 (categoria "Codice
-- sconto") e la risposta pronta `cs_faq` 11 dicevano di dare AMIMI10 a chi scrive che il codice non
-- funziona, e il BLOCCO DATI (dove stanno le risposte standard) vince sulla conoscenza: dopo la
-- newsletter l'AI avrebbe proposto il codice di benvenuto a chi ha un premio AMICA12 che non parte.
-- Correggere solo `cs_knowledge` non basta, come gia' imparato nella 0104.
--
-- Cosa fa:
--   1. riga nuova di `cs_knowledge` (categoria NULL) con le regole dei punti, "solo se la cliente chiede";
--   2. riga 9: il sotto-caso (1) diventa "il codice DI BENVENUTO non gli funziona" e in coda una frase
--      che rimanda alla risposta standard AMICA12;
--   3. `cs_faq` 11: "il codice AMIMI10" diventa "il codice di benvenuto AMIMI10" (IT ed EN);
--   4. `cs_faq` nuova risposta standard "Codice sconto" per i codici AMICA12 (le risposte standard non
--      pesano sul tetto della conoscenza: cs-assist ne prende 4 per categoria, qui diventano 2).
--
-- Le regole scritte qui sono lette nel codice e su Shopify il 27-10, non dedotte:
--   - punti = parte intera del subtotale (dopo gli sconti, senza spedizione) degli ordini Shopify pagati
--     (`loyalty-orders/index.ts` righe 87, 123, 135), giro ai minuti 10/25/40/55; storno proporzionale;
--   - coccola e gioco +5 al giorno ciascuno, look +30 e recensione +20 (solo borse comprate online) solo
--     all'approvazione (migr 0153); presenze agli eventi col QR (`loyalty_checkin_enabled` acceso);
--   - AMICA12: 12% su tutto, nessun minimo, uso singolo, nessuna scadenza, `combinesWith` tutto false;
--   - spedizione Italia gratuita da 100 EUR sul totale gia' scontato (UE da 200, resto del mondo da 600).
-- "Oggi" davanti a boutique e soglia di spedizione: sono vere oggi ma restano scelte dell'owner. Le
-- scelte ancora aperte (scadenze da comunicare, reso di un ordine pagato col 12%, codice usato in un
-- ordine reso, spostamento dei punti fra due account) NON sono regole: la riga le passa a una persona.
-- Accettato consapevolmente (Gate 2 del 27-10, C6): la riga porta nel corpus del linter i numeri 12, 20,
-- 30 e il dominio amimi.it in ogni conversazione; il rimedio vero sta nel linter, fuori da questo diff.
--
-- Tetto: cs-assist prende al massimo 6.000 caratteri di conoscenza in ordine di id e si ferma al primo
-- sforamento (`csKnowledge`, con `.length` di JavaScript, cioe' unita' UTF-16: un emoji conta 2). La
-- riga nuova ha l'id piu' alto, quindi sarebbe la prima a cadere. La guardia, nello stesso blocco,
-- conta come JavaScript per ogni categoria. Le UPDATE sono difensive: se il testo atteso non c'e' piu',
-- la migrazione solleva invece di sovrascrivere.

do $$
declare
  n int;
  peggiore int;
begin
  select count(*) into n from cs_knowledge where titolo = 'Area Membri e punti Mimi''';
  if n <> 0 then
    raise exception 'esiste gia'' una riga "%" (% righe): non la duplico', 'Area Membri e punti Mimi''', n;
  end if;

  insert into public.cs_knowledge (categoria, titolo, contenuto, attiva)
  values (null, 'Area Membri e punti Mimi''', 'Parlane solo se la cliente chiede di punti, Area Membri o codici AMICA12. AREA MEMBRI (punti Mimi''): si entra da amimi.it/punti con la mail usata per ordinare, con un codice via mail, niente password. PUNTI: 1 per ogni euro degli ordini pagati su amimi.it (dopo gli sconti, senza spedizione), di solito entro mezz''ora; +5 al giorno con la coccola a Mimi'' e +5 col gioco del giorno; foto del look +30 e recensione +20 (solo borse comprate online), dopo l''approvazione del team; agli eventi Amimi'' punti col QR. Gli acquisti in boutique e ai pop-up oggi non danno punti. PREMIO: ogni 100 punti uno sconto del 12% sul prossimo ordine, dalla pagina; il codice AMICA12-XXXXXX e'' personale, vale una volta, oggi solo su amimi.it, uno per ordine, non si somma ad altri codici (nemmeno col codice di benvenuto); in Italia, oggi, sotto i 100 euro dopo lo sconto la spedizione si paga. RESI: i punti dell''ordine reso si tolgono in proporzione. PUNTI A ZERO O MANCANTI: di solito e'' entrata con un''altra mail o all''ordine ha lasciato solo il telefono: chiedi numero d''ordine e mail o telefono usati, non promettere di spostare i punti. Decide una persona del team, non rispondere nel merito: scadenze di punti e codici, reso di un ordine pagato col 12%, codice usato in un ordine poi reso, spostamento dei punti. Non scrivere mai il saldo punti: la cliente lo vede nella pagina.', true);

  -- riga 9: il sotto-caso (1) parla del codice di benvenuto, piu' una frase in coda.
  select count(*) into n from cs_knowledge
   where id = 9 and categoria = 'Codice sconto'
     and contenuto like '%oppure il codice non gli funziona:%' and contenuto not like '%AMICA12%';
  if n <> 1 then
    raise exception 'id 9: testo atteso non trovato o gia'' aggiornato (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_knowledge
     set contenuto = replace(contenuto, 'oppure il codice non gli funziona:', 'oppure il codice di benvenuto non gli funziona:') || ' CODICI AMICA12-XXXXXX: sono i premi personali dell''Area Membri (12%), non il codice di benvenuto. Se una cliente dice che un AMICA12 non funziona, mai dare AMIMI10 al suo posto: usa la risposta standard sui codici AMICA12 e, se non basta, passa a una persona.',
         updated_at = now()
   where id = 9;

  -- cs_faq 11: la risposta pronta nomina il codice di benvenuto come tale.
  select count(*) into n from cs_faq
   where id = 11 and tipo = 'risposta_standard' and categoria = 'Codice sconto'
     and testo_it like '%inserisci il codice AMIMI10 al checkout%'
     and testo_en like '%enter the code AMIMI10 at checkout%';
  if n <> 1 then
    raise exception 'cs_faq id 11: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_faq
     set testo_it = replace(testo_it, 'inserisci il codice AMIMI10 al checkout', 'inserisci il codice di benvenuto AMIMI10 al checkout'),
         testo_en = replace(testo_en, 'enter the code AMIMI10 at checkout', 'enter the welcome code AMIMI10 at checkout')
   where id = 11;

  -- cs_faq: risposta standard per i codici AMICA12 (id identity, generato).
  select count(*) into n from cs_faq where testo_it like '%AMICA12%';
  if n <> 0 then
    raise exception 'cs_faq: esiste gia'' una riga su AMICA12 (% righe): non la duplico', n;
  end if;

  insert into public.cs_faq (tipo, titolo, testo_it, testo_en, categoria, attiva)
  values ('risposta_standard', 'A5b codice AMICA12 (Area Membri)',
          'Ciao [nome]! Ci dispiace per il disguido. Il codice AMICA12 è personale: copialo intero dalla pagina dei tuoi punti (amimi.it/punti), trattino compreso, e incollalo al checkout. Vale una sola volta e non si somma ad altri sconti: se nel carrello c''è già un altro codice, toglilo prima. Se ancora non parte, mandaci uno screenshot del carrello e lo controlliamo noi. Grazie, Team Amimì',
          'Hi [name]! Sorry for the trouble. Your AMICA12 code is personal: copy it in full from your points page (amimi.it/punti), dash included, and paste it at checkout. It can be used only once and cannot be combined with other discounts: if there is already another code in your cart, remove it first. If it still does not work, send us a screenshot of your cart and we''ll look into it. Thanks, Team Amimì',
          'Codice sconto', true);

  -- guardia sul tetto, contata come JavaScript (unita' UTF-16: un carattere fuori dal BMP conta 2),
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
