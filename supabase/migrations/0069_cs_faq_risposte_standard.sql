-- CS Fase 3: libreria risposte automatiche in cs_faq (spec Cowork 2026-07-23, PARTE A).
-- Valori operativi CONFERMATI (provvisori) dall'owner via Cowork il 2026-07-23:
--   reso 14gg dalla consegna, spedizione reso a carico cliente, rimborso 14gg sul metodo originale;
--   corriere TWS (link tracking nel testo = twsexpresscourier.it; NB: il link live per-ordine che il
--   codice pesca e' mytws.it/tracking-status;ldv=<n>, diverso: da allineare owner);
--   codice sconto = PERTE (AMIMILANO10 rotto, non proporlo), esclusi Lea Bag Animalier + restock esclusivi;
--   ritiro = Via Plinio 43, 20133 Milano (provvisorio, senza orari fissi: si concorda col cliente).
-- Tutti i valori restano modificabili qui (una riga = un dato), mai hardcoded nel codice della edge.
--
-- categoria = ESATTE 13 stringhe del classificatore cs-classify (senza emoji): cs-assist inietta le
--   risposta_standard filtrando r.categoria === conv.categoria. A13 "Modifica / correzione indirizzo"
--   NON e' (ancora) una categoria del classificatore -> resta inerte finche' non si promuove.
-- Idempotente: azzera le risposta_standard e re-inserisce (gli esempio_tono restano, li aggiorniamo sotto).

delete from cs_faq where tipo = 'risposta_standard';

insert into cs_faq (tipo, titolo, categoria, testo_it, testo_en, attiva) values
('risposta_standard','A1 spedizione','Spedizione e stato ordine',
 $q$Ciao [nome]! Ho controllato il tuo ordine [#numero]: risulta [stato] in data [data]. Puoi seguirlo qui: https://twsexpresscourier.it/traccia-spedizione/ inserendo il codice [tracking]. Se ti serve altro sono qui 💛 Grazie, Team Amimì$q$,
 $q$Hi [name]! I checked your order [#number]: it is [status] as of [date]. You can follow it here: https://twsexpresscourier.it/traccia-spedizione/ using code [tracking]. I'm here if you need anything else 💛 Thanks, Team Amimì$q$, true),

('risposta_standard','A2 restock','Restock e disponibilita',
 $q$Ciao [nome]! In questo momento la [prodotto] e' esaurita 💔 Iscriviti al "torna disponibile" sulla pagina del prodotto ([link]) e ti avviso appena rientra, cosi' non te la perdi. Grazie per l'interesse! Team Amimì$q$,
 $q$Hi [name]! [product] is currently sold out 💔 Sign up for the "back in stock" alert on the product page ([link]) and I'll let you know as soon as it returns. Thanks for your interest! Team Amimì$q$, true),

('risposta_standard','A3 ritiro','Ritiro, negozio, appuntamenti',
 $q$Ciao [nome]! Il tuo ordine [#numero] e' pronto per il ritiro presso la nostra sede in Via Plinio 43, 20133 Milano. Fammi sapere che giorno e in quale fascia oraria pensi di passare, cosi' ti confermo e ti accogliamo 🌸 Una volta arrivata, rivolgiti alla portineria e comunica il tuo nome. Grazie, Team Amimì$q$,
 $q$Hi [name]! Your order [#number] is ready for pickup at our location in Via Plinio 43, 20133 Milan. Let me know which day and time slot you plan to come by, so I can confirm and welcome you 🌸 When you arrive, go to the concierge and give your name. Thanks, Team Amimì$q$, true),

('risposta_standard','A4 cambio','Cambio e prodotto errato',
 $q$Ciao [nome]! Ci dispiace davvero per l'errore. Procediamo subito con il cambio: ti inviamo la versione corretta e organizziamo il ritiro di quella ricevuta. Se sei a Milano possiamo anche fare un passaggio a mano. Ci scusiamo per l'inconveniente 💛 Team Amimì$q$,
 $q$Hi [name]! We're so sorry for the mix-up. We'll arrange the exchange right away: we'll send the correct version and organize the pickup of the one you received. If you're in Milan we can also arrange a hand delivery. Apologies for the inconvenience 💛 Team Amimì$q$, true),

('risposta_standard','A5 codice sconto','Codice sconto',
 $q$Ciao [nome]! Ci dispiace per il disguido. Inserisci il codice PERTE al checkout, dovrebbe funzionare. Se hai ancora problemi scrivici e lo applichiamo noi 😊 Grazie, Team Amimì$q$,
 $q$Hi [name]! Sorry for the trouble. Please enter the code PERTE at checkout, it should work. If it still fails, write to us and we'll apply it for you 😊 Thanks, Team Amimì$q$, true),

('risposta_standard','A6 cerimonia','Personalizzazione e cerimonia',
 $q$Ciao [nome]! Che bello, grazie per aver pensato a noi per l'occasione 😊 Offriamo un servizio di personalizzazione per cerimonie. Per prepararti una proposta: per quando ti serve, quanti pezzi, e quale modello o colore avevi in mente? Team Amimì$q$,
 $q$Hi [name]! How lovely, thank you for thinking of us for your occasion 😊 We offer a personalization service for ceremonies. To prepare a proposal: by when do you need it, how many pieces, and which model or color did you have in mind? Team Amimì$q$, true),

('risposta_standard','A7 reso','Reso e rimborso',
 $q$Ciao [nome]! Nessun problema per il reso. Trovi tutte le istruzioni qui: [link resi]. La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e' a carico del cliente. Appena riceviamo la borsa procediamo con il rimborso, entro 14 giorni sul metodo di pagamento originale 💛 Grazie, Team Amimì$q$,
 $q$Hi [name]! No problem for the return. You'll find all instructions here: [returns link]. Requests must be made within 14 days of delivery and return shipping is at the customer's expense. As soon as we receive the bag we'll process the refund within 14 days to the original payment method 💛 Thanks, Team Amimì$q$, true),

('risposta_standard','A9 info prodotto','Info prodotto',
 $q$Ciao [nome]! La [modello] misura [misure], e' realizzata in [materiale] e la catena e' [oro/argento]. Ti allego il link: [link prodotto]. Se ti serve una foto in piu' te la mando volentieri 😊 Grazie, Team Amimì$q$,
 $q$Hi [name]! The [model] measures [size], it's made of [material] and the chain is [gold/silver]. Here's the link: [product link]. If you'd like an extra photo I'm happy to send one 😊 Thanks, Team Amimì$q$, true),

('risposta_standard','A10 riparazione','Riparazione',
 $q$Ciao [nome]! Certo, possiamo ripararla. Puoi portarcela in Via Plinio 43, 20133 Milano su appuntamento, oppure spedircela. Mandaci una foto del difetto cosi' capiamo come intervenire 💛 Team Amimì$q$,
 $q$Hi [name]! Of course, we can repair it. You can bring it to Via Plinio 43, 20133 Milan by appointment, or ship it to us. Send us a photo of the issue so we understand how to help 💛 Team Amimì$q$, true),

('risposta_standard','A11 pagamento','Pagamento',
 $q$Ciao [nome]! Controllo subito il tuo pagamento e ti confermo a breve. Se nel frattempo hai una ricevuta o uno screenshot, mandamelo pure 😊 Grazie, Team Amimì$q$,
 $q$Hi [name]! I'm checking your payment right now and will confirm shortly. If you have a receipt or screenshot in the meantime, feel free to send it 😊 Thanks, Team Amimì$q$, true),

('risposta_standard','A12 gift card','Gift card e account',
 $q$Ciao [nome]! Ti aiuto subito con [gift card / account]. [dettaglio]. Se mi dai [dato mancante] risolvo in un attimo 😊 Grazie, Team Amimì$q$,
 $q$Hi [name]! I'll help you right away with [gift card / account]. [detail]. If you send me [missing detail] I'll sort it out in a moment 😊 Thanks, Team Amimì$q$, true),

('risposta_standard','A13 modifica indirizzo','Modifica / correzione indirizzo',
 $q$Ciao [nome]! Abbiamo notato che nell'indirizzo di spedizione manca/e' errato [dettaglio]. Potresti inviarcelo completo e corretto? Appena lo riceviamo aggiorniamo l'ordine e procediamo con la spedizione. Grazie! Team Amimì$q$,
 $q$Hi [name]! We noticed the shipping address is missing/incorrect: [detail]. Could you send it to us complete and correct? As soon as we receive it we'll update the order and ship it out. Thank you! Team Amimì$q$, true);

-- Aggiorna i 3 esempio_tono che avevano ancora [DA VERIFICARE] coi valori confermati (id 3/4/5, guardati su titolo).
update cs_faq set testo_it = $q$Ciao {nome}! Certo, puoi passare a ritirarla in Via Plinio 43, 20133 Milano. Fammi sapere che giorno e in che fascia oraria pensi di venire, cosi' ti confermo. Una volta arrivata, rivolgiti alla portineria e comunica il tuo nome 🌸$q$
  where id = 3 and titolo = 'seed: ritiro';
update cs_faq set testo_it = $q$Ciao {nome}! Ci dispiace per il disguido. Inserisci il codice PERTE al checkout, dovrebbe funzionare. Se hai ancora problemi scrivici e lo applichiamo noi 😊$q$
  where id = 4 and titolo = 'seed: codice sconto';
update cs_faq set testo_it = $q$Ciao {nome}! Nessun problema per il reso. La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e' a carico del cliente. Appena ci arriva la borsa procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale 💛$q$
  where id = 5 and titolo = 'seed: reso';
