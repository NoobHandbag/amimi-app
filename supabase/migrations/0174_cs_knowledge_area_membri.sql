-- 0174 - conoscenza di casa: l'Area Membri e i punti Mimi' (2026-10-27, lancio del 28-10)
--
-- Origine: verifica di prontezza del lancio della comunicazione dell'Area Membri (newsletter e social
-- del 28-10, `Cowork12/projects/Premia_Area_Membri_2026-09/08_LANCIO_2026-10-28.md` nel repo hub),
-- richiesta di Dan del 27-10 ("puoi aggiustare assistenza"). Prima di questa migrazione nessuna riga
-- di `cs_knowledge` e di `cs_faq` parlava di punti, Area Membri o AMICA12, e la riga 9 (categoria
-- "Codice sconto") diceva di dare "comunque AMIMI10" a chi scrive che il codice non funziona: dopo la
-- newsletter l'AI avrebbe proposto il codice di benvenuto a chi ha un premio AMICA12 che non parte.
--
-- Le regole scritte qui sono lette nel codice e su Shopify, non dedotte:
--   - punti = parte intera del subtotale (dopo gli sconti, senza spedizione) degli ordini Shopify pagati
--     (`loyalty-orders/index.ts`), giro ogni 15 minuti; storno proporzionale ai resi (migr 0136);
--   - giochi +5 al giorno ciascuno, look +30 e recensione +20 solo all'approvazione (migr 0153);
--   - AMICA12: 12% su tutto, nessun minimo, uso singolo, nessuna scadenza, `combinesWith` tutto false;
--   - spedizione Italia gratuita da 100 EUR sul totale gia' scontato (zona Italia del profilo spedizioni).
-- Le scelte non ancora prese dall'owner (scadenze da comunicare, reso di un ordine pagato col 12%,
-- codice usato in un ordine reso, spostamento dei punti fra due account) NON sono scritte come regole:
-- la riga dice di passarle a una persona. La riga 2 dice che gli articoli comprati "durante promozioni
-- speciali" non si rendono: senza questa riga l'AI potrebbe applicarlo a chi ha usato il 12%.
--
-- categoria NULL = entra in ogni conversazione: le domande sui punti arrivano da piu' categorie
-- (Codice sconto, Gift card e account, Altro). Il prompt di cs-assist prende al massimo 6.000 caratteri
-- di conoscenza in ordine di id e si ferma al primo sforamento (`csKnowledge`): la riga nuova ha l'id
-- piu' alto, quindi sarebbe la prima a cadere. La guardia finale controlla il tetto per ogni categoria.
-- Le UPDATE sono difensive come nella 0104: se il testo atteso non c'e' piu', la migrazione solleva.

do $$
declare
  n int;
begin
  select count(*) into n from cs_knowledge where titolo = 'Area Membri e punti Mimi''';
  if n <> 0 then
    raise exception 'esiste gia'' una riga "%" (% righe): non la duplico', 'Area Membri e punti Mimi''', n;
  end if;

  insert into public.cs_knowledge (categoria, titolo, contenuto, attiva)
  values (
    null,
    'Area Membri e punti Mimi''',
    'AREA MEMBRI (punti Mimi''): si entra da amimi.it/punti con la mail usata per ordinare; arriva un codice via mail, niente password, e la prima volta l''account si crea in un minuto. PUNTI: 1 punto per ogni euro degli ordini pagati su amimi.it (dopo gli sconti, senza spedizione), di solito entro mezz''ora dal pagamento; +5 al giorno con la coccola a Mimi'' e +5 col gioco del giorno; una foto del look +30 e una recensione +20, solo dopo l''approvazione del team. Gli acquisti in boutique e ai pop-up oggi non danno punti. PREMIO: ogni 100 punti uno sconto del 12% sul prossimo ordine, si ritira dalla pagina; il codice AMICA12-... vale una volta, su amimi.it, uno per ordine, non si somma ad altri codici (AMIMI10 compreso); sotto i 100 euro dopo lo sconto la spedizione si paga. RESI: i punti dell''ordine reso si tolgono in proporzione. PUNTI A ZERO O MANCANTI: di solito e'' entrata con una mail diversa da quella dell''ordine, o all''ordine ha lasciato solo il telefono: chiedi numero d''ordine e mail o telefono usati e non promettere di spostare i punti. Decide una persona del team, quindi non rispondere nel merito: scadenza di punti e codici, reso di un ordine pagato col 12%, codice usato in un ordine poi reso, spostamento dei punti. Non scrivere mai il saldo punti: la cliente lo vede nella pagina.',
    true
  );

  -- riga 9: una frase in coda, il resto della scheda non si tocca.
  select count(*) into n from cs_knowledge
   where id = 9 and categoria = 'Codice sconto'
     and contenuto like '%dagli comunque AMIMI10%' and contenuto not like '%AMICA12%';
  if n <> 1 then
    raise exception 'id 9: testo atteso non trovato o gia'' aggiornato (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_knowledge
     set contenuto = contenuto || ' CODICI AMICA12-...: sono i premi dell''Area Membri (12%), non il codice di benvenuto. Se una cliente dice che un codice AMICA12 non funziona vale la riga Area Membri: mai dare AMIMI10 al suo posto.'
   where id = 9;
end $$;

-- guardia finale: per ogni categoria del classificatore la conoscenza che entra nel prompt (righe
-- con categoria NULL piu' quelle della categoria, nel formato "[titolo] contenuto") resta sotto i
-- 6.000 caratteri, cosi' nessuna riga viene tagliata in silenzio.
do $$
declare
  peggiore int;
begin
  select max(tot) into peggiore from (
    select c.categoria,
           (select coalesce(sum(length('[' || k.titolo || '] ' || coalesce(k.contenuto, ''))), 0)
              from cs_knowledge k
             where k.attiva and (k.categoria is null or k.categoria = c.categoria)) as tot
      from (select distinct categoria from cs_knowledge where categoria is not null
            union all select null) c
  ) x;
  if peggiore > 6000 then
    raise exception 'conoscenza oltre il tetto di cs-assist: % caratteri in una categoria (max 6000)', peggiore;
  end if;
end $$;
