-- 0096 — CS: URL della pagina resi + regola commerciale del codice sconto
-- Brief: 2026-08-01_CLAUDE_CODE_BRIEF_cs_faq_indirizzo_e_link_resi (problema 2)
--        2026-08-01_CLAUDE_CODE_BRIEF_cs_codice_sconto_subcaso (decisione owner 01-08:
--        "applicare il design del 24-07 come sta")
-- Solo tabelle del modulo cs_* + app_flags. Nessuna tabella core toccata (Regola Ferrea 19).
-- Rollback: rimettere i due valori precedenti, riportati qui sotto per esteso.

-- 1) URL della pagina con le istruzioni di reso. Sta in app_flags e non nel codice perche' e'
--    una pagina del sito: l'owner deve poterla cambiare senza un deploy della edge.
--    VERIFICATO LIVE il 2026-08-01: risponde 200 e contiene l'indirizzo di restituzione giusto
--    ("Amimi' Milano Srl, Via Santa Maria Fulcorina 13, 20123 Milano"), coerente con la regola
--    indirizzi confermata dall'owner l'01-08. Se un domani nascesse una pagina dedicata ai resi,
--    si cambia QUESTO valore e nient'altro. Vuoto o assente = cs-assist degrada il segnaposto a
--    [DA VERIFICARE: link resi], mai un rimando a vuoto.
insert into app_flags (key, value)
values ('cs_link_resi_url', 'https://amimi.it/policies/refund-policy')
on conflict (key) do update set value = excluded.value;

-- 2) Codice sconto: il tool lo regalava a chiunque lo chiedesse.
--    Causa accertata dal test tecnico del 01-08 (casi T4 e T5): non e' un difetto del generatore,
--    e' che la regola non esiste nei dati che il generatore legge. cs_knowledge id 9 diceva solo
--    "il codice di benvenuto e' AMIMILANO10", e il modello faceva la cosa piu' ovvia.
--    Testo dal design approvato DESIGN_Risposte_Automatiche_Per_Caso_2026-07-24.md, riga 4.
--    NON scritto qui, e per scelta: la cumulabilita' col 20% Sun, Salt & Stripes e' una domanda
--    aperta all'owner nel brief. Inventarla sarebbe una regola commerciale decisa da un'AI.
--    VALORE PRECEDENTE (rollback):
--      'Il codice di benvenuto corrente e'' AMIMILANO10. Se al cliente non funziona: invitalo a
--       riprovare e offriti di applicarlo tu ("scrivici e lo applichiamo noi").'
update cs_knowledge set contenuto =
  'Il codice di benvenuto corrente e'' AMIMILANO10, ed e'' il codice per il PRIMO acquisto di chi si iscrive alla newsletter. '
  'Due sotto-casi da distinguere SEMPRE. (1) IL CLIENTE DICE DI ESSERSI ISCRITTO E DI NON AVER RICEVUTO IL CODICE, oppure il codice non gli funziona: '
  'invitalo prima a controllare nello spam, poi dagli comunque AMIMILANO10 e offriti di applicarlo tu ("scrivici e lo applichiamo noi"); '
  'in questo caso CITA le esclusioni: il codice non vale su Lea Bag Animalier ne'' sui restock esclusivi. '
  '(2) RICHIESTA DI SCONTO GENERICA ("mi fate uno sconto?", "c''e'' una promo?", "fate sconti per il primo acquisto?"): '
  'NON dare nessun codice. Rispondi in modo cortese e caldo, e al massimo indica l''iscrizione alla newsletter come il modo per ricevere il codice di benvenuto. '
  'Il codice non si consegna su richiesta: e'' una regola commerciale, non una cortesia da valutare caso per caso.'
where id = 9 and categoria = 'Codice sconto';

-- La risposta standard corrispondente era scritta come se il cliente avesse GIA'' un codice che
-- non funziona, quindi copriva solo il sotto-caso (1) e senza esclusioni. Le si aggiunge la sola
-- riga delle esclusioni: resta la risposta del sotto-caso (1), che e'' l''unico in cui il codice
-- si consegna. Il sotto-caso (2) non ha una risposta standard e non deve averla.
--   VALORE PRECEDENTE testo_it (rollback): 'Ciao [nome]! Ci dispiace per il disguido. Inserisci il
--   codice AMIMILANO10 al checkout, dovrebbe funzionare. Se hai ancora problemi scrivici e lo
--   applichiamo noi 😊 Grazie, Team Amimì'
--   VALORE PRECEDENTE testo_en (rollback): 'Hi [name]! Sorry for the trouble. Please enter the code
--   AMIMILANO10 at checkout, it should work. If it still fails, write to us and we''ll apply it for
--   you 😊 Thanks, Team Amimì'
update cs_faq set
  testo_it = 'Ciao [nome]! Ci dispiace per il disguido. Controlla anche nello spam, e intanto inserisci il codice AMIMILANO10 al checkout: dovrebbe funzionare. Il codice non e'' valido su Lea Bag Animalier e sui restock esclusivi. Se hai ancora problemi scrivici e lo applichiamo noi 😊 Grazie, Team Amimì',
  testo_en = 'Hi [name]! Sorry for the trouble. Please check your spam folder too, and in the meantime enter the code AMIMILANO10 at checkout: it should work. The code is not valid on Lea Bag Animalier or on exclusive restocks. If it still fails, write to us and we''ll apply it for you 😊 Thanks, Team Amimì'
where id = 11 and categoria = 'Codice sconto';
