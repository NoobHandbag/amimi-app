-- CS Fase 3: seed cs_faq (esempi di TONO) + cron del riassunto (cs-assist summary).
-- Le tabelle cs_faq / cs_drafts / colonne summary esistono gia' dalla 0053.
--
-- SEED cs_faq: SOLO `esempio_tono` (skeleton di STILE, con placeholder {..}, nessun dato/fatto inventato:
-- niente prezzi, indirizzi, date). Servono come few-shot per la VOCE della bozza (design 6.1: dare del tu,
-- frasi corte, emoji leggere, firma "Grazie, Team Amimi'", niente promesse su date). Le `faq`/`risposta_standard`
-- con contenuti REALI le aggiunge l'owner (cs_faq e' editabile): non si inventano fatti di brand (Regola 1).
-- Idempotente: cancella e re-inserisce solo gli esempi seed (titolo prefissato 'seed:').
delete from cs_faq where tipo = 'esempio_tono' and titolo like 'seed:%';
insert into cs_faq (tipo, titolo, testo_it, categoria, attiva) values
 ('esempio_tono', 'seed: restock', 'Ciao {nome}! Grazie per averci scritto 😊 In questo momento la {prodotto} e'' esaurita; ti aggiorno io appena rientra, cosi'' non te la perdi. A presto, Team Amimi''', 'Restock e disponibilita', true),
 ('esempio_tono', 'seed: spedizione', 'Ciao {nome}! Ho controllato il tuo ordine #{ordine}: risulta {stato_ordine}. {tracking}. Se hai bisogno di altro scrivimi pure 💛 Grazie, Team Amimi''', 'Spedizione e stato ordine', true),
 ('esempio_tono', 'seed: ritiro', 'Ciao {nome}! Certo, puoi passare a ritirarla. [DA VERIFICARE: orari e indirizzo del ritiro]. Fammi sapere quando pensi di venire, cosi'' la teniamo pronta 😊 Grazie, Team Amimi''', 'Ritiro, negozio, appuntamenti', true),
 ('esempio_tono', 'seed: codice sconto', 'Ciao {nome}! Controllo subito il codice {codice}. [DA VERIFICARE: validita'' e condizioni del codice]. Ti confermo a breve 😊 Grazie, Team Amimi''', 'Codice sconto', true),
 ('esempio_tono', 'seed: reso', 'Ciao {nome}! Nessun problema per il reso. [DA VERIFICARE: procedura e tempi del reso]. Appena ci arriva ti confermo il rimborso 💛 Grazie, Team Amimi''', 'Reso e rimborso', true),
 ('esempio_tono', 'seed: cerimonia', 'Ciao {nome}! Che bello, grazie per aver pensato a noi per l''occasione 😊 Raccontami qualche dettaglio in piu'' (modello, colore, data) e vediamo insieme la soluzione migliore. A presto, Team Amimi''', 'Personalizzazione e cerimonia', true);

-- Cron del riassunto: cs-assist azione summary, ogni 7 minuti, decoupled da classify (*/5) e ingest (*/2).
-- NO-OP se cs_enabled!='true'. Stesso pattern net.http_post/pin 'x'.
select cron.schedule(
  'cs-assist-summary',
  '*/7 * * * *',
  $$
  select net.http_post(
    url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/cs-assist',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"pin":"x","action":"summary","source":"cron"}'::jsonb
  );
  $$
);
