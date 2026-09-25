-- 0145: contenuti dell'outreach B2B (25-09-2026): template rivisti, knowledge per l'AI, link della line sheet.
-- Numero 0145: in prod al 25-09 l'ultima e' 0144_mat_fase2 (letto da schema_migrations e da origin/main).
-- Solo tabelle e flag del modulo lead_* (Regola 19). Idempotente: gli update sono assoluti, l'insert salta i titoli
-- gia' presenti (lead_knowledge non ha un indice univoco).
-- Fonti: line sheet di Benny (Linesheet_Amimi_LIGHT.html: listino approvato il 05-09 ma NON pubblicato, decisione
-- owner del 25-09: la pagina amimi-trade dice "su richiesta"), CONOSCENZA.md (il cotone non si accosta mai
-- all'Italia; showroom in Via Plinio 43). Minimi d'ordine e condizioni NON sono approvati: nei template e nella
-- knowledge non compaiono prezzi wholesale, numeri o percentuali su quelle voci.
--
-- Cosa correggono i template rispetto al seed 0114 (revisione del 22-09 e Gate 2 del 25-09): via il riferimento a
-- un allegato e a una telefonata mai fatta; il cotone in una frase separata dal Made in Italy (regola di casa, ed
-- e' anche l'euristica avvisiContenuto della edge); via le condizioni non decise. Il segnaposto {{linesheet}} lo
-- riempiono la edge (lead-outreach v4) e il compositore (leadApi v2) da app_flags.lead_linesheet_url; se manca,
-- resta un [DA VERIFICARE] che blocca l'invio. I test 52-53 di tests/lead_outreach_guardie.mjs rileggono questo file.

update lead_sequences set
  oggetto = 'Amimì Milano per {{nome_negozio}}: borse artigianali, line sheet wholesale',
  corpo = E'Gentile {{referente}},\nsono Benedetta di Amimì Milano, un piccolo brand di borse artigianali fatte a mano, con prezzi al pubblico da 50 a 190 euro. La pelle è Made in Italy. Le linee più leggere sono in cotone naturale colorato.\n\n{{gancio}}\n\nQui trova la nostra line sheet, con modelli, materiali e colori: {{linesheet}}\n\nSe la collezione può stare bene nel suo negozio, fissiamo un appuntamento: una call, una visita nel nostro showroom a Milano, oppure passo io in negozio con qualche borsa da vedere dal vivo. In quell''occasione le presento anche il listino wholesale.\n\nUn caro saluto,\n{{firma}}\nSe preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.',
  updated_at = now()
where codice = 'boutique_it' and tocco = 1;

update lead_sequences set
  corpo = E'Gentile {{referente}},\nvolevo solo assicurarmi che avesse ricevuto la mia email con la line sheet. Se ha due minuti le segnalo i tre pezzi che stanno funzionando meglio in questa stagione: la Lea in pelle cocco, la Nina in cotone colorato e gli accessori piccoli (cover e case), che al banco cassa girano bene.\nResto a disposizione per un salto in negozio.\n{{firma}}',
  updated_at = now()
where codice = 'boutique_it' and tocco = 2;

update lead_sequences set
  corpo = E'Gentile {{referente}},\ncapisco che di brand ne vedete tanti. La mia proposta è semplice: si parte con un ordine piccolo, solo i modelli che secondo lei stanno con la vostra clientela, e vediamo come vanno. Il resto lo definiamo insieme all''appuntamento.\nLe va se passo con il campionario?\n{{firma}}',
  updated_at = now()
where codice = 'boutique_it' and tocco = 3;

update lead_sequences set
  corpo = E'Gentile {{referente}},\nnon voglio disturbarla oltre. Le lascio il link alla line sheet: {{linesheet}}\nSe in futuro vorrà inserire le nostre borse, mi trova sempre qui. Le auguro buon lavoro.\n{{firma}}\nNon la contatterò ulteriormente salvo un suo cenno.',
  updated_at = now()
where codice = 'boutique_it' and tocco = 4;

update lead_sequences set
  corpo = E'Buongiorno, sono Benedetta di Amimì Milano, siamo un piccolo brand di borse artigianali fatte a mano. {{gancio}} Ha un minuto?\nLavorate già con qualche brand di borse o accessori artigianali? Che fascia di prezzo funziona meglio da voi?\nLe nostre borse vanno dai 50 ai 190 euro al pubblico, fatte a mano, la pelle è Made in Italy. Sono colorate e riconoscibili, la cliente le compra d''impulso.\nLe mando via email il link alla nostra line sheet, così dà un''occhiata con calma. A che indirizzo glielo giro?',
  updated_at = now()
where codice = 'boutique_it' and tocco = 0;

update lead_sequences set
  corpo = E'Dear {{referente}},\nI''m Benedetta from Amimì Milano, a small Italian brand of handmade bags, retail from 50 to 190 euros. Our leather is Made in Italy. The lighter styles are in coloured natural cotton.\n\n{{gancio}}\n\nHere is our line sheet, with styles, materials and colours: {{linesheet}}\n\nIf the collection could sit well in your store, let''s set up a meeting: a call, or a visit to our showroom in Milan. I''d also be glad to send a few samples and to go through the wholesale price list.\n\nWarm regards,\n{{firma}}\nIf you''d rather not hear from me again, just reply "no thanks" and I won''t contact you further.',
  updated_at = now()
where codice = 'boutique_en' and tocco = 1;

update lead_sequences set
  corpo = E'Dear {{referente}},\njust making sure my email with the line sheet reached you. The three pieces doing best this season: the Lea in croc-embossed leather, the Nina in coloured cotton, and the small accessories (cases and covers) that sell well at the till.\nHappy to send samples.\n{{firma}}',
  updated_at = now()
where codice = 'boutique_en' and tocco = 2;

update lead_sequences set
  corpo = E'Dear {{referente}},\nI know you see many brands. My proposal is simple: start with a small order, only the styles you feel fit your customers, and see how they go. The rest we can define together at the meeting.\nWould samples help?\n{{firma}}',
  updated_at = now()
where codice = 'boutique_en' and tocco = 3;

update lead_sequences set
  corpo = E'Dear {{referente}},\nI won''t take more of your time. The line sheet stays available here: {{linesheet}}\nIf you ever wish to add our bags, I''m here. All the best for the season.\n{{firma}}\nI won''t contact you again unless you get in touch.',
  updated_at = now()
where codice = 'boutique_en' and tocco = 4;

-- Knowledge per la bozza AI: SOLO fatti verificati (link, stato del listino, regole di casa). Niente condizioni,
-- niente prezzi wholesale. Salta i titoli gia' presenti (rieseguibile).
insert into lead_knowledge (categoria, titolo, contenuto, attiva)
select v.categoria, v.titolo, v.contenuto, true
from (values
  ('line_sheet', 'Line sheet online (pagina riservata, solo per chi ha il link)',
   'La line sheet wholesale e'' su https://amimi.it/pages/amimi-trade (italiano) e https://amimi.it/pages/amimi-trade#en (inglese). Non e'' indicizzata e non e'' nel menu del sito. Per ogni modello mostra foto, materiale e varianti colore. I prezzi NON sono in pagina: dal 25-09 la pagina dice "su richiesta" e rimanda all''appuntamento. Nell''email si manda il link, non allegati.'),
  ('listino', 'Listino wholesale: approvato internamente, NON pubblicato',
   'Il listino wholesale 2026 esiste ed e'' approvato internamente (05-09-2026), ma per decisione dell''owner (25-09) non e'' pubblicato: ne'' in pagina ne'' nelle email. Nelle email NON si scrivono prezzi wholesale ne'' retail consigliato: si dice che il listino si presenta all''appuntamento o si manda su richiesta. Si puo'' citare solo la fascia al pubblico usata nei template, da 50 a 190 euro. Sophie non e'' a listino wholesale; Annie e Agata solo nel Kit Amiche della Sposa, su richiesta; Valentina solo in conto vendita.'),
  ('condizioni', 'Condizioni commerciali: NON ancora definite',
   'Minimi d''ordine, tempi di consegna, pagamenti, quota e durata del conto vendita, gestione dell''invenduto: nessuna di queste voci e'' approvata. Nelle email non si scrivono numeri, percentuali, minimi ne'' promesse su tempi e resi. Si dice che le condizioni si definiscono insieme all''appuntamento. Esistono due formule: wholesale (vendita ferma) e conto vendita su alcuni modelli.'),
  ('appuntamento', 'Dove e come si incontrano i buyer',
   'Lo showroom Amimì e'' in Via Plinio 43, 20129 Milano, su appuntamento. In alternativa una call, oppure Benedetta passa in negozio con qualche borsa da vedere dal vivo. Contatto wholesale: wholesale@amimi.it, telefono +39 333 280 8226. Le risposte arrivano nella casella info@amimi.it con etichetta Wholesale.'),
  ('prodotto', 'Materiali e origine: cosa si puo'' dire',
   'Le borse in pelle (Lea, Lea Maxi, Maria, Valentina) e Agata e Annie sono fatte in Italia con artigiani italiani. Le borse e gli accessori in cotone (Nina, Nina Maxi, Laptop Cover, Sunglass Cover, Airpod Cover) sono fatti a mano in cotone 100% naturale: NON scrivere mai che sono fatti in Italia e NON nominare mai l''India. Tratti distintivi: forme essenziali, colore, materiali scelti uno per uno, prezzo pensato per l''acquisto d''impulso.')
) as v(categoria, titolo, contenuto)
where not exists (select 1 from lead_knowledge k where k.titolo = v.titolo);

-- Link della line sheet per le email (pagina pubblicata il 25-09 senza prezzi): riempie {{linesheet}} e il prompt dell'AI
update app_flags set value = 'https://amimi.it/pages/amimi-trade' where key = 'lead_linesheet_url';
