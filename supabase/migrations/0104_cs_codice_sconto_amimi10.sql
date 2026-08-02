-- 0104 — il codice sconto: un codice sbagliato e una restrizione che non esiste
-- (2026-08-02, brief cs_crop_e_dati_falsi Parte 2)
--
-- Due dati falsi erano in produzione e uscivano nelle bozze alle clienti.
--
-- 1) IL CODICE. `cs_knowledge` id 2 (categoria NULL, quindi caricata su OGNI conversazione) e id 9
--    dicevano AMIMILANO10. Decisione dell'owner: il codice corrente e' AMIMI10. Verificato
--    sull'Admin API di Shopify, non dedotto: AMIMI10 e' attivo dal 20/02/2026 e ha 277 utilizzi,
--    AMIMILANO10 e' attivo dal 23/07/2026 e ne ha 5. Nessuna cliente era stata bloccata al
--    checkout (AMIMILANO10 e' tuttora attivo): il danno era di coerenza, non operativo.
--
-- 2) LE ESCLUSIONI, che non esistono. La id 9 imponeva di CITARE che il codice "non vale su Lea
--    Bag Animalier ne' sui restock esclusivi". Sull'Admin API entrambi i codici di benvenuto hanno
--    `allItems: true`: si applicano a TUTTO il catalogo. L'unico codice con collezioni limitate e'
--    15PERTE, che e' un'altra cosa. La frase era falsa e ogni bozza sul codice sconto la ripeteva.
--
-- Al posto delle esclusioni finte, le cause VERE per cui un codice di benvenuto fallisce, lette
-- dalla configurazione del codice AMIMI10 e non ipotizzate:
--   - `appliesOncePerCustomer: true`  -> non funziona se il cliente l'ha gia' usato una volta;
--   - `combinesWith` orderDiscounts/productDiscounts/shippingDiscounts TUTTI false
--                                    -> non funziona se il carrello ha gia' un altro sconto.
-- SCOSTAMENTO DICHIARATO dal brief: il brief elencava come cause "provato prima che il codice
-- partisse" e "stava combinando col codice un'altra promozione". La prima e' vera per
-- AMIMILANO10 (partito il 23/07, e l'ordine di Elena era del 23/07) ma NON per AMIMI10, attivo da
-- febbraio: scriverla come causa generica sarebbe stato un terzo dato falso al posto dei due
-- corretti. Al suo posto c'e' "gia' usato una volta", che sul codice che comunichiamo e' la causa
-- piu' probabile davvero (277 utilizzi, uno per cliente).
--
-- AGGIUNTA AL PERIMETRO DEL BRIEF, ed e' la parte che pesa di piu'. Il brief nominava solo
-- `cs_knowledge`. Cercando le due falsita' in tutte le tabelle sono uscite altre DUE righe, in
-- `cs_faq`, entrambe attive: id 11 "A5 codice sconto" (tipo `risposta_standard`, IT ed EN) e id 4
-- "seed: codice sconto" (tipo `esempio_tono`). La id 11 e' il posto PEGGIORE in cui potesse
-- stare: e' una risposta pronta, che va alla cliente alla lettera senza passare dal modello, e
-- diceva parola per parola "Il codice non e' valido su Lea Bag Animalier e sui restock esclusivi".
-- Correggere solo `cs_knowledge` avrebbe tolto la falsita' dalle bozze lasciandola nel testo
-- pronto da inviare.
--
-- Le UPDATE sono difensive: se il testo atteso non c'e' piu' (una sessione parallela lo ha gia'
-- cambiato) la migrazione SOLLEVA invece di sovrascrivere in silenzio.

do $$
declare
  n int;
begin
  -- id 2: la riga caricata su ogni conversazione. Sostituzione mirata, il resto della scheda
  -- (resi, spedizioni, indirizzi) non si tocca.
  select count(*) into n from cs_knowledge
   where id = 2 and contenuto like '%CODICE SCONTO di benvenuto: AMIMILANO10.%';
  if n <> 1 then
    raise exception 'id 2: il testo atteso sul codice sconto non c''e'' (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_knowledge
     set contenuto = replace(
           contenuto,
           'CODICE SCONTO di benvenuto: AMIMILANO10.',
           'CODICE SCONTO di benvenuto: AMIMI10 (10%, vale su TUTTO il catalogo, una sola volta per cliente, non cumulabile con altre promozioni).')
   where id = 2;

  -- id 9: riscritta. La struttura a due sotto-casi resta (design 24-07, raffinato dalla 0096):
  -- cambia il codice e sparisce la frase sulle esclusioni, sostituita dalle due cause vere.
  select count(*) into n from cs_knowledge where id = 9 and categoria = 'Codice sconto';
  if n <> 1 then
    raise exception 'id 9: riga "Codice sconto" non trovata come attesa (trovate % righe).', n;
  end if;

  update cs_knowledge set contenuto =
    'Il codice di benvenuto corrente e'' AMIMI10, ed e'' il codice per il PRIMO acquisto di chi si iscrive alla newsletter. '
    'Due sotto-casi da distinguere SEMPRE. '
    '(1) IL CLIENTE DICE DI ESSERSI ISCRITTO E DI NON AVER RICEVUTO IL CODICE, oppure il codice non gli funziona: '
    'invitalo prima a controllare nello spam, poi dagli comunque AMIMI10 e offriti di applicarlo tu ("scrivici e lo applichiamo noi"). '
    'SE IL CODICE NON HA FUNZIONATO, le cause vere sono due, e sono queste: '
    '(a) il codice vale UNA SOLA VOLTA per cliente, quindi non parte se e'' gia'' stato usato in un ordine precedente; '
    '(b) il codice NON si cumula con altre promozioni ne'' con le spedizioni gratuite, quindi non parte se nel carrello c''e'' gia'' un altro sconto attivo. '
    'MAI dire che il codice non vale su certi prodotti: e'' FALSO, il codice si applica a tutto il catalogo. '
    'Se non sai quale delle due cause sia, dille entrambe come possibilita'' e offriti di applicare tu lo sconto. '
    '(2) RICHIESTA DI SCONTO GENERICA ("mi fate uno sconto?", "c''e'' una promo?", "fate sconti per il primo acquisto?"): '
    'NON dare nessun codice. Rispondi in modo cortese e caldo, e al massimo indica l''iscrizione alla newsletter come il modo '
    'per ricevere il codice di benvenuto. Il codice non si consegna su richiesta: e'' una regola commerciale, non una cortesia '
    'da valutare caso per caso.'
   where id = 9;

  -- cs_faq id 11: la risposta PRONTA, quella che parte alla lettera. Codice corretto e via le
  -- esclusioni; al loro posto le due cause vere, dette come possibilita' e non come diagnosi.
  select count(*) into n from cs_faq
   where id = 11 and tipo = 'risposta_standard' and testo_it like '%AMIMILANO10%' and testo_it like '%Animalier%';
  if n <> 1 then
    raise exception 'cs_faq id 11: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_faq set
    testo_it = 'Ciao [nome]! Ci dispiace per il disguido. Controlla anche nello spam, e intanto inserisci il codice AMIMI10 al checkout: dovrebbe funzionare. '
               'Se non parte, di solito e'' per uno di questi due motivi: il codice vale una sola volta per cliente, oppure nel carrello c''e'' gia'' un''altra promozione e i due sconti non si cumulano. '
               'Se hai ancora problemi scrivici e lo applichiamo noi 😊 Grazie, Team Amimì',
    testo_en = 'Hi [name]! Sorry for the trouble. Please check your spam folder too, and in the meantime enter the code AMIMI10 at checkout: it should work. '
               'If it does not, it is usually for one of two reasons: the code can be used only once per customer, or there is already another promotion in your cart and the two discounts cannot be combined. '
               'If it still fails, write to us and we''ll apply it for you 😊 Thanks, Team Amimì'
   where id = 11;

  -- cs_faq id 4: esempio di TONO, non di contenuto. Cambia il solo codice, il resto resta com'e'.
  select count(*) into n from cs_faq where id = 4 and testo_it like '%AMIMILANO10%';
  if n <> 1 then
    raise exception 'cs_faq id 4: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;

  update cs_faq set testo_it = replace(testo_it, 'AMIMILANO10', 'AMIMI10') where id = 4;
end $$;

-- guardia finale, su ENTRAMBE le tabelle: nessuna riga attiva deve piu' nominare il codice vecchio
-- o le esclusioni che non esistono. E' la guardia che avrebbe fatto scoprire prima le due righe
-- di cs_faq, quindi guarda dove il brief non guardava.
do $$
declare
  n int;
begin
  select (select count(*) from cs_knowledge
           where attiva and (contenuto ilike '%AMIMILANO10%' or contenuto ilike '%Animalier%' or contenuto ilike '%restock esclusiv%'))
       + (select count(*) from cs_faq
           where attiva and (coalesce(testo_it,'') || coalesce(testo_en,'')) ilike any (array['%AMIMILANO10%','%Animalier%','%restock esclusiv%','%exclusive restock%']))
    into n;
  if n <> 0 then
    raise exception 'restano % righe attive col codice vecchio o con le esclusioni che non esistono', n;
  end if;
end $$;
