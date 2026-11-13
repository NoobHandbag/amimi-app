-- 0195 - chat del sito, Fase 1 pezzo 7: le risposte fisse dei bottoni rapidi (proposta 9.1, 9.8, D-15)
--
-- Cosa fa:
--   1. importa UNA volta in `cs_faq` le 15 voci `faq-*` della Knowledge base di Shopify (metaobject
--      `shopify--knowledge-base-fact`, testi decisi da Dan il 3 novembre 2026 e pubblicati quel giorno; letti
--      dall'Admin API il 13 novembre 2026). Italiano = il testo pubblicato su Shopify, alla lettera; inglese = bozza
--      di Claude Code. Tutte e due da approvare dal team (D-15): sono bozze, nessuna cliente le vede finche' la chat e'
--      spenta, e l'accensione al go-live (`chat_sito_enabled`) aspetta quell'OK (Gate 2 del pezzo 7, C2).
--   2. collega i quattro bottoni di `chat_bottoni` (nati nella 0186 con `faq` null) alle voci della chat:
--      spedizioni -> faq-costi-e-tempi-spedizione, resi -> faq-reso-e-spedizione-reso,
--      ritiri -> faq-ritiro-di-persona, ordine -> faq-dove-e-il-mio-ordine. Etichette dei bottoni invariate.
--
-- Perche' `tipo = 'risposta_chat'` e non `faq` o `risposta_standard` (9.8, "righe marcate per la sola chat"):
--   cs-assist legge `cs_faq` per le bozze delle email (faqTono) e tiene SOLO `esempio_tono`, `faq` e
--   `risposta_standard`, al massimo 4 risposte per bozza, e quelle a categoria nulla entrano sempre: righe nuove di
--   quei tipi cambierebbero le bozze di oggi. Il tipo nuovo le tiene fuori dal flusso email per costruzione (cs-assist
--   non cambia e non si rideploya); le leggono solo chat-api (risposta del bottone) e chat-staff (scheda Chat, azione
--   conoscenza_testo), che dalla api-4 e dalla staff-4 accettano anche questo tipo. Le 13 risposte standard e i 6
--   esempi di tono restano come sono: la deduplica con le voci e' una PROPOSTA per il team, scritta nel repo hub.
--   La categoria e' quella della tassonomia di cs-classify dove l'argomento combacia (serve alla Fase 2), null se no.
--
-- Solo tabelle del modulo (cs_faq del modulo cs_*, chiave chat_* di app_flags): niente CE, stock o vendite
-- (Regola Ferrea 19). La migrazione si ferma invece di sovrascrivere se trova voci gia' importate o un chat_bottoni
-- diverso da quello della 0186.
--
-- Rollback (tutte e due le cose, in una transazione):
--   update app_flags set value = '[{"en": "Shipping", "id": "spedizioni", "it": "Spedizioni", "faq": null}, {"en": "Returns", "id": "resi", "it": "Resi", "faq": null}, {"en": "Pick-up", "id": "ritiri", "it": "Ritiri", "faq": null}, {"en": "Where is my order", "id": "ordine", "it": "Dov''è il mio ordine", "faq": null}]' where key = 'chat_bottoni';
--   delete from cs_faq where tipo = 'risposta_chat';

begin;

do $$
declare
  n int;
  v_prima jsonb;
  v_ids text[];
  v_nuovo jsonb;
begin
  -- mai due volte: un secondo giro duplicherebbe le voci
  select count(*) into n from public.cs_faq where tipo = 'risposta_chat';
  if n <> 0 then
    raise exception '0195: in cs_faq ci sono gia'' % righe risposta_chat. Non importo di nuovo.', n;
  end if;

  insert into public.cs_faq (tipo, titolo, categoria, testo_it, testo_en, attiva) values
  ('risposta_chat', 'faq-negozio-fisico-showroom: Avete un negozio fisico? Dove vi trovo a Milano?', 'Ritiro, negozio, appuntamenti',
   $t$Non abbiamo un negozio aperto al pubblico: vendiamo online su amimi.it. A Milano abbiamo uno showroom in Via Plinio 43, visitabile solo su appuntamento: per fissarlo scrivi a info@amimi.it. Se cerchi un modello preciso, chiedilo quando prendi appuntamento, perché in showroom non ci sono sempre tutti i pezzi.$t$,
   $t$We don't have a shop open to the public: we sell online at amimi.it. In Milan we have a showroom in Via Plinio 43, open by appointment only: to book a visit, write to info@amimi.it. If you are looking for a specific model, mention it when you book, because not every piece is always in the showroom.$t$, true),
  ('risposta_chat', 'faq-ritiro-di-persona: Posso ritirare l''ordine di persona? Dove e quando?', 'Ritiro, negozio, appuntamenti',
   $t$Sì, a Milano: scegli il ritiro al checkout. Il ritiro è in Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, dal lunedì al venerdì 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00. Passa solo dopo aver ricevuto l'email "il tuo ordine è pronto per il ritiro". Per qualsiasi problema scrivi a info@amimi.it con il numero d'ordine.$t$,
   $t$Yes, in Milan: choose pickup at checkout. Pickup is at Via Santa Maria Fulcorina 13, 20123 Milano, from the building's concierge (portineria), Monday to Friday 8:00-13:00 and 14:00-17:00, Saturday 8:00-11:00. Please come only after you have received the email telling you that your order is ready for pickup. For any problem, write to info@amimi.it with your order number.$t$, true),
  ('risposta_chat', 'faq-costi-e-tempi-spedizione: Quanto costa la spedizione e quanto ci mette?', 'Spedizione e stato ordine',
   $t$Italia 3,90 EUR, gratuita sopra i 100 EUR. Europa 15 EUR, gratuita sopra i 200 EUR. Resto del mondo 40 EUR, gratuita sopra i 600 EUR. Tempi indicativi: Italia 2-6 giorni lavorativi, Europa 4-8, resto del mondo 9-15. Spediamo dal lunedì al venerdì, festivi esclusi. Per i modelli in pre-order vale il tempo scritto nella scheda del prodotto. Fuori dall'Unione Europea dazi e tasse di importazione sono a carico di chi riceve il pacco.$t$,
   $t$Italy EUR 3.90, free over EUR 100. Europe EUR 15, free over EUR 200. Rest of the world EUR 40, free over EUR 600. Estimated delivery times: Italy 2-6 working days, Europe 4-8, rest of the world 9-15. We ship Monday to Friday, public holidays excluded. For pre-order models, the time written on the product page applies. Outside the European Union, import duties and taxes are paid by the recipient.$t$, true),
  ('risposta_chat', 'faq-corriere-e-tracking: Con che corriere spedite? Come seguo il pacco?', 'Spedizione e stato ordine',
   $t$Quando il corriere ritira il pacco ricevi un'email di conferma della spedizione con il link per seguirlo sul sito MyTWS. Se non la trovi, controlla anche nello spam.$t$,
   $t$When the courier collects your parcel, you receive a shipping confirmation email with the link to track it on the MyTWS website. If you can't find it, please check your spam folder too.$t$, true),
  ('risposta_chat', 'faq-dove-e-il-mio-ordine: Dov''è il mio ordine? È in ritardo', 'Spedizione e stato ordine',
   $t$Il link per seguire il pacco è nell'email di conferma della spedizione. La chat del sito non vede lo stato degli ordini: se il pacco non è ancora partito o il tracciamento è fermo, scrivi a info@amimi.it oppure lascia in chat nome, email e numero d'ordine (lo trovi nell'email di conferma dell'ordine). Il team ti risponde via email appena possibile.$t$,
   $t$The tracking link is in the shipping confirmation email. The website chat cannot see the status of orders: if your parcel has not left yet or the tracking has stopped, write to info@amimi.it or leave your name, email and order number in the chat (you will find it in the order confirmation email). Our team will reply by email as soon as possible.$t$, true),
  ('risposta_chat', 'faq-annullare-modificare-ordine: Posso annullare o modificare un ordine?', null,
   $t$Scrivi il prima possibile a info@amimi.it con il numero d'ordine, oppure lascialo in chat con nome ed email: il team verifica se l'ordine è ancora da spedire e ti risponde via email.$t$,
   $t$Write to info@amimi.it as soon as possible with your order number, or leave it in the chat with your name and email: our team will check whether the order has not shipped yet and reply by email.$t$, true),
  ('risposta_chat', 'faq-reso-e-spedizione-reso: Come faccio un reso? Chi paga la spedizione del reso?', 'Reso e rimborso',
   $t$Puoi restituire un articolo entro 14 giorni dalla consegna. Prima scrivi a info@amimi.it con il numero d'ordine, dicendo se vuoi un reso o un cambio: ti mandiamo le istruzioni. L'articolo deve essere in perfette condizioni, con le etichette originali; non accettiamo articoli danneggiati o macchiati. La spedizione del reso è a carico del cliente: non forniamo etichette di reso. Non si possono restituire gli articoli fatti su misura o su ordine speciale. Il rimborso arriva sul metodo di pagamento originale entro 14 giorni dall'accettazione del reso. I cambi te li rispediamo gratis.$t$,
   $t$You can return an item within 14 days of delivery. First write to info@amimi.it with your order number, saying whether you want a return or an exchange: we will send you the instructions. The item must be in perfect condition, with its original tags; we do not accept damaged or stained items. Return shipping is paid by the customer: we do not provide return labels. Made-to-measure and special-order items cannot be returned. The refund goes to the original payment method within 14 days of the return being accepted. We ship exchanges back to you free of charge.$t$, true),
  ('risposta_chat', 'faq-reso-a-mano-milano: Posso riportare il reso a mano a Milano?', 'Reso e rimborso',
   $t$Sì. Dopo aver scritto a info@amimi.it, puoi lasciare il pacco in Via Santa Maria Fulcorina 13, 20123 Milano, in portineria, dal lunedì al venerdì 8:00-13:00 e 14:00-17:00, il sabato 8:00-11:00. Metti nel pacco la ricevuta dell'ordine o una sua copia.$t$,
   $t$Yes. After writing to info@amimi.it, you can leave the parcel at Via Santa Maria Fulcorina 13, 20123 Milano, with the building's concierge (portineria), Monday to Friday 8:00-13:00 and 14:00-17:00, Saturday 8:00-11:00. Put the order receipt, or a copy of it, in the parcel.$t$, true),
  ('risposta_chat', 'faq-articolo-difettoso: Ho ricevuto un articolo difettoso o danneggiato', 'Riparazione',
   $t$Scrivi a info@amimi.it entro 5 giorni dal ricevimento, con il numero d'ordine e, se puoi, una foto del difetto: ti proponiamo una riparazione o un cambio.$t$,
   $t$Write to info@amimi.it within 5 days of receiving the item, with your order number and, if you can, a photo of the defect: we will offer you a repair or an exchange.$t$, true),
  ('risposta_chat', 'faq-codice-newsletter: Il codice sconto della newsletter non funziona', 'Codice sconto',
   $t$Il codice di benvenuto vale una sola volta per cliente e non si somma ad altri sconti: se l'hai già usato, o nel carrello c'è già uno sconto, il checkout non lo accetta. Se il problema è un altro, scrivi a info@amimi.it.$t$,
   $t$The welcome code can be used once per customer and cannot be combined with other discounts: if you have already used it, or there is already a discount in your cart, the checkout will not accept it. If the problem is something else, write to info@amimi.it.$t$, true),
  ('risposta_chat', 'faq-riassortimento: Tornerà disponibile questo modello?', 'Restock e disponibilita',
   $t$Non abbiamo date di riassortimento. Sulla pagina del prodotto esaurito c'è il pulsante "Avvisami quando torna disponibile": lasci la tua email e ti scriviamo quando torna. Alcuni modelli sono in pre-order: in quel caso il tempo di spedizione è scritto nella scheda.$t$,
   $t$We don't have restock dates. On the page of a sold-out product there is a button to be notified when it is back in stock: leave your email and we will write to you when it returns. Some models are on pre-order: in that case the shipping time is written on the product page.$t$, true),
  ('risposta_chat', 'faq-su-misura: Fate borse su misura o personalizzate?', 'Personalizzazione e cerimonia',
   $t$Sì. Per un pezzo su misura compila il modulo nella pagina "Su misura" del sito, oppure scrivi a info@amimi.it con il modello e la modifica che vorresti (colore, laccio, materiale): ti diciamo se è possibile, quanto costa e in quanto tempo. Gli ordini su misura non si possono restituire.$t$,
   $t$Yes. For a made-to-measure piece, fill in the form on the "Su misura" (made to measure) page of our website, or write to info@amimi.it with the model and the change you would like (colour, strap, material): we will tell you whether it is possible, how much it costs and how long it takes. Made-to-measure orders cannot be returned.$t$, true),
  ('risposta_chat', 'faq-contatti: Avete un numero di telefono? Come vi contatto?', null,
   $t$Scrivici a info@amimi.it oppure lascia in chat nome, email e domanda: ti rispondiamo via email appena possibile.$t$,
   $t$Write to us at info@amimi.it or leave your name, email and question in the chat: we will reply by email as soon as possible.$t$, true),
  ('risposta_chat', 'faq-produzione-e-materiali: Dove sono fatte le borse? Di che materiale sono?', 'Info prodotto',
   $t$Le borse in pelle (Lea, Valentina, Maria, Sophie) e le Agata e Annie sono fatte a mano in Italia. Le borse e gli accessori in cotone (Nina, Nina Maxi, Laptop Cover, Mini Case, Sunglass Cover e le AirPods Case in cotone) sono fatti a mano in cotone 100% naturale. Misure e materiali di ogni modello sono nella scheda del prodotto.$t$,
   $t$Our leather bags (Lea, Valentina, Maria, Sophie) and the Agata and Annie bags are handmade in Italy. Our cotton bags and accessories (Nina, Nina Maxi, Laptop Cover, Mini Case, Sunglass Cover and the cotton AirPods Case) are handmade in 100% natural cotton. The size and materials of each model are on its product page.$t$, true),
  ('risposta_chat', 'faq-altri-negozi: Trovo le vostre borse in altri negozi?', 'Ritiro, negozio, appuntamenti',
   $t$Sì, alcuni modelli sono da Amo Bijoux, in Via Varese 6 a Milano. La disponibilità di un modello preciso in boutique non è garantita: per verificarla, o per sapere dove trovarci in un'altra città, scrivi a info@amimi.it.$t$,
   $t$Yes, some models are available at Amo Bijoux, Via Varese 6, Milan. We cannot guarantee that a specific model is in the boutique: to check, or to find out where to find us in another city, write to info@amimi.it.$t$, true);
  get diagnostics n = row_count;
  if n <> 15 then
    raise exception '0195: inserite % voci invece di 15', n;
  end if;

  -- i bottoni: solo se chat_bottoni e' ancora quello della 0186 (quattro bottoni, in quest'ordine, tutti senza faq)
  select value::jsonb into v_prima from public.app_flags where key = 'chat_bottoni' for update;
  if v_prima is null or jsonb_typeof(v_prima) <> 'array' then
    raise exception '0195: chat_bottoni assente o non e'' un elenco. Non sovrascrivo.';
  end if;
  select array_agg(e ->> 'id' order by o) into v_ids from jsonb_array_elements(v_prima) with ordinality as t(e, o);
  if v_ids is distinct from array['spedizioni', 'resi', 'ritiri', 'ordine']
     or exists (select 1 from jsonb_array_elements(v_prima) as e where coalesce(e -> 'faq', 'null'::jsonb) <> 'null'::jsonb) then
    raise exception '0195: chat_bottoni non e'' quello della 0186 (bottoni %, o uno ha gia'' una risposta). Non sovrascrivo.', v_ids;
  end if;

  select jsonb_agg(e || jsonb_build_object('faq', f.id) order by o) into v_nuovo
    from jsonb_array_elements(v_prima) with ordinality as t(e, o)
    join (values ('spedizioni', 'faq-costi-e-tempi-spedizione'), ('resi', 'faq-reso-e-spedizione-reso'),
                 ('ritiri', 'faq-ritiro-di-persona'), ('ordine', 'faq-dove-e-il-mio-ordine')) as mp(bottone, handle)
      on mp.bottone = e ->> 'id'
    join public.cs_faq f on f.tipo = 'risposta_chat' and split_part(f.titolo, ':', 1) = mp.handle;
  if v_nuovo is null or jsonb_array_length(v_nuovo) <> 4
     or exists (select 1 from jsonb_array_elements(v_nuovo) as e where jsonb_typeof(e -> 'faq') <> 'number') then
    raise exception '0195: collegamento dei bottoni incompleto: %', v_nuovo;
  end if;

  update public.app_flags set value = v_nuovo::text where key = 'chat_bottoni';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '0195: chat_bottoni non aggiornato (% righe)', n;
  end if;
end $$;

commit;
