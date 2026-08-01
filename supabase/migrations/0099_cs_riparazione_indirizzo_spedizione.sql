-- 0099 — Riparazioni: dove si porta a mano E dove si spedisce
-- Brief: 2026-08-01_CLAUDE_CODE_BRIEF_cs_faq_indirizzo_e_link_resi, problema 1, chiuso dalla
-- PRECISAZIONE DELL'OWNER dell'01-08 notte: "per le riparazioni (cioe' da spedire), si mandano in
-- Fulcorina".
--
-- NB: applicata in produzione con il nome 0098 (registro: version 20260801193111) prima che una
-- sessione parallela occupasse quel numero con un altro file. Il file e stato rinumerato a 0099
-- per non avere due 0098 nel repo; nel registro del DB il nome resta quello con cui e passata.
--
-- Le due regole non erano in contraddizione, mancava un pezzo. La riparazione portata A MANO va in
-- Via Plinio 43 su appuntamento (showroom); la riparazione SPEDITA va in Via Santa Maria Fulcorina
-- 13, che e' l'indirizzo di ricezione. Le righe attuali dicevano "oppure spedircela" senza dire
-- DOVE: il difetto vero era quello, non l'indirizzo sbagliato. Percio' l'indirizzo di Plinio NON si
-- tocca (spostarlo, come chiedeva la lettera del brief, avrebbe mandato le clienti nel posto
-- sbagliato per la consegna a mano) e si aggiunge quello di spedizione.
-- Solo tabelle del modulo cs_*. Nessuna tabella core (Regola Ferrea 19).
-- Rollback: i valori precedenti sono riportati per esteso qui sotto.

--   PRECEDENTE testo_it: 'Ciao [nome]! Certo, possiamo ripararla. Puoi portarcela in Via Plinio 43,
--   20129 Milano su appuntamento, oppure spedircela. Mandaci una foto del difetto cosi'' capiamo
--   come intervenire 💛 Team Amimì'
--   PRECEDENTE testo_en: 'Hi [name]! Of course, we can repair it. You can bring it to Via Plinio 43,
--   20129 Milan by appointment, or ship it to us. Send us a photo of the issue so we understand how
--   to help 💛 Team Amimì'
update cs_faq set
  testo_it = 'Ciao [nome]! Certo, possiamo ripararla. Puoi portarcela a mano in Via Plinio 43, 20129 Milano su appuntamento, oppure spedircela a Amimì Milano Srl, Via Santa Maria Fulcorina 13, 20123 Milano. Mandaci una foto del difetto cosi'' capiamo come intervenire 💛 Team Amimì',
  testo_en = 'Hi [name]! Of course, we can repair it. You can bring it to Via Plinio 43, 20129 Milan by appointment, or ship it to Amimì Milano Srl, Via Santa Maria Fulcorina 13, 20123 Milan. Send us a photo of the issue so we understand how to help 💛 Team Amimì'
where id = 15 and categoria = 'Riparazione';

--   PRECEDENTE: 'Sempre disponibili a riparare, anche fuori garanzia. Chiedi una foto del difetto;
--   proponi consegna in Via Plinio 43, 20129 Milano su appuntamento oppure spedizione.'
update cs_knowledge set contenuto =
  'Sempre disponibili a riparare, anche fuori garanzia. Chiedi sempre una foto del difetto. '
  'DUE STRADE, e vanno tenute distinte: consegna A MANO in Via Plinio 43, 20129 Milano SU APPUNTAMENTO (e'' lo showroom); '
  'oppure SPEDIZIONE a Amimì Milano Srl, Via Santa Maria Fulcorina 13, 20123 Milano. '
  'Non dire "spediscicela" senza dare l''indirizzo di spedizione, ed e'' un indirizzo diverso da quello dello showroom.'
where id = 12 and categoria = 'Riparazione';

-- La riga dei valori operativi trasversali diceva "SHOWROOM, APPUNTAMENTI E RIPARAZIONI: Plinio",
-- che e' vero solo per la consegna a mano.
update cs_knowledge set contenuto = replace(contenuto,
  'SHOWROOM, APPUNTAMENTI E RIPARAZIONI: Via Plinio 43, 20129 Milano, SOLO su appuntamento;',
  'SHOWROOM, APPUNTAMENTI E RIPARAZIONI CONSEGNATE A MANO: Via Plinio 43, 20129 Milano, SOLO su appuntamento. RIPARAZIONI E RESI SPEDITI: Via Santa Maria Fulcorina 13, 20123 Milano;')
where id = 2 and contenuto like '%SHOWROOM, APPUNTAMENTI E RIPARAZIONI: Via Plinio 43%';
