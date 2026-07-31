-- 0082 (2026-07-31 sera, richiesta owner in chat: "Gemini deve avere quanto piu' contesto possibile"):
-- cs_knowledge = la conoscenza di casa che entra nel prompt di OGNI bozza (cs-assist v14).
-- Distillata da BASE_Ricerca_CS_Categorizzazione_Risposte_Tono_2026-07-22.md e
-- Risposte_Automatiche_e_Criteri_2026-07-23.md, coi valori CONFERMATI dall'owner il 31-07 sera
-- (reso 14gg dalla data dell'ordine come il sito; codice AMIMILANO10; ritiro ordini Fulcorina 13;
-- showroom/riparazioni Plinio 43 CAP 20129). Pattern app_guides: editabile senza redeploy.
-- categoria NULL = vale sempre; categoria valorizzata = iniettata solo su quella categoria
-- (stringhe ESATTE del classificatore cs-classify, stesso vincolo di cs_faq).

create table cs_knowledge (
  id serial primary key,
  categoria text,
  titolo text not null,
  contenuto text not null,
  attiva boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table cs_knowledge is 'Conoscenza di casa iniettata nel prompt delle bozze CS (cs-assist v14). categoria NULL = sempre; altrimenti solo sulla categoria (nomi ESATTI del classificatore). Si aggiorna qui, mai hardcoded nel prompt.';
alter table cs_knowledge enable row level security;  -- nessuna policy: SERVICE-ROLE ONLY, come app_guides

insert into cs_knowledge (categoria, titolo, contenuto) values
(null, 'Tono di voce Amimi',
'Apertura: "Ciao [Nome]," di default (caldo, informale); "Gentile [Nome]," solo per reclami o registro legale. Specchia il registro del cliente: "tu" caldo di default, "lei" se il cliente e'' formale o arrabbiato. Frasi brevi e dirette (2-4 righe), orientate alla soluzione: offri SEMPRE un''alternativa concreta. Emoji leggere e calde (🌸 💛 😊, 💔 per il dispiacere), mai eccessive. Empatia vera nelle scuse ("ci dispiace davvero per la delusione"). Chiudi con disponibilita'' ("Rimaniamo a disposizione") e firma "Grazie, Team Amimì". MAI: refusi, nome del cliente sbagliato, note interne nella risposta, promesse non coperte dai dati.'),
(null, 'Valori operativi correnti',
'RESO: richiesta entro 14 giorni dalla DATA DELL''ORDINE; spedizione di reso a carico del cliente; rimborso entro 14 giorni dal rientro sul metodo di pagamento originale; il prodotto deve essere in perfette condizioni con etichette originali; articoli in saldo o comprati durante promozioni speciali: NIENTE cambi ne'' resi. DIFETTI: invitare a segnalare entro 5 giorni dal ricevimento con foto; su un difetto vero vale la garanzia legale (24 mesi): mai negare citando solo la finestra reso. SPEDIZIONI: corriere TWS Express Courier, tracking su twsexpresscourier.it/traccia-spedizione/; Italia 2-6 giorni lavorativi a 3,90 EUR (gratis sopra 100 EUR); Europa 4-8 giorni a 15 EUR (gratis sopra 200 EUR); resto del mondo 9-15 giorni a 40 EUR (gratis sopra 600 EUR); si lavora lun-ven. CODICE SCONTO di benvenuto: AMIMILANO10. RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati). SHOWROOM, APPUNTAMENTI E RIPARAZIONI: Via Plinio 43, 20129 Milano, SOLO su appuntamento; niente orari fissi: si concorda la fascia col cliente, mai inventare orari.'),
(null, 'Quando la bozza non chiude da sola',
'Casi da NON chiudere in automatico (bozza prudente che raccoglie info e propone il contatto di una persona): difetto/garanzia (proponi riparazione o cambio, mai un no secco); rischio disputa/chargeback/banca (massima priorita''); reclamo sull''assistenza; reso arrivato via rivenditore o creator; collaborazioni/B2B legittime e preventivi cerimonia (la proposta la fa una persona, la bozza raccoglie le informazioni).'),
('Spedizione e stato ordine', 'Linee guida bozza',
'Dai lo stato reale dell''ordine dai DATI e il link tracking col codice (formato 1UW...). Su mancata consegna per assenza: rassicura, si riprogramma la consegna. Mai promettere date non presenti nei dati.'),
('Restock e disponibilita', 'Linee guida bozza',
'MAI promettere date di restock. Se il modello e'' esaurito: invita a iscriversi al "torna disponibile" sulla pagina prodotto e proponi UN''alternativa concreta disponibile ora (dai DATI), con gentilezza.'),
('Ritiro, negozio, appuntamenti', 'Linee guida bozza',
'Ordini online: ritiro in Via Santa Maria Fulcorina 13, 20123 Milano. Showroom e prove borse: Via Plinio 43, 20129 Milano su appuntamento. Concorda giorno e fascia oraria col cliente: NON esistono orari pubblicati, mai inventarli.'),
('Cambio e prodotto errato', 'Linee guida bozza',
'Scuse sincere + soluzione subito: inviamo la versione corretta e organizziamo il ritiro di quella sbagliata (bolla da stampare e attaccare al pacco). Se l''ordine e'' gia'' spedito: il cambio si organizza all''arrivo. Prima opzione se il cliente e'' a Milano: passaggio in showroom.'),
('Reso e rimborso', 'Linee guida bozza',
'Il verdetto entro/fuori finestra lo da'' il SISTEMA (blocco CASO): scrivi dentro quel verdetto. Entro: istruzioni + link resi, spese di rientro a carico del cliente, rimborso entro 14 giorni dal rientro. Fuori: rifiuto garbato con alternativa concreta; se emerge un difetto cambia tutto (garanzia).'),
('Codice sconto', 'Linee guida bozza',
'Il codice di benvenuto corrente e'' AMIMILANO10. Se al cliente non funziona: invitalo a riprovare e offriti di applicarlo tu ("scrivici e lo applichiamo noi").'),
('Personalizzazione e cerimonia', 'Linee guida bozza',
'Entusiasmo + raccolta info per la proposta (che fara'' una persona): per quando serve, quanti pezzi, quale modello/colore, eventuale abito. Mai promettere fattibilita'' o prezzi.'),
('Info prodotto', 'Linee guida bozza',
'Rispondi con misure/materiali/dettagli SOLO se nei DATI; fai domande di chiarimento prima di consigliare; proponi il link del prodotto se a catalogo. Offri foto extra volentieri.'),
('Riparazione', 'Linee guida bozza',
'Sempre disponibili a riparare, anche fuori garanzia. Chiedi una foto del difetto; proponi consegna in Via Plinio 43, 20129 Milano su appuntamento oppure spedizione.'),
('Modifica / correzione indirizzo', 'Linee guida bozza',
'Il verdetto (correggibile / gia'' partita / consegnata) lo da'' il SISTEMA: scrivi dentro quello. Se correggibile: rassicura e chiedi l''indirizzo completo (via, civico, CAP, citta'').'),
('Gift card e account', 'Linee guida bozza',
'Aiuto pratico e diretto: chiedi il dato mancante minimo per risolvere (numero gift card, email account). Niente promesse su saldi o riattivazioni senza dati.'),
('Altro / richiesta varia', 'Linee guida bozza',
'Se e'' solo un complimento o ringraziamento: risposta breve e calda, niente ticket. Altrimenti bozza libera nel tono di casa, sempre prudente sui dati.');
