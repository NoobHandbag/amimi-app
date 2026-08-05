-- 0105 — i mittenti di sistema Google mancanti dalla denylist del pre-filtro rumore
-- (2026-08-04, brief assistenza_4_fix punto D; applicata live nella stessa sessione)
--
-- Nello screenshot dell'owner comparivano in coda come card normali, categoria "Altro / richiesta
-- varia", quattro notifiche Google datate 22/07: Google Pay, Google Payments, Gemini (note della
-- riunione) e un avviso di sicurezza.
--
-- Verificato a DB prima di scrivere: di quei quattro mittenti UNO solo era gia' coperto
-- (`no-reply@accounts.google.com`, presente due volte). Le sue card sono in coda non perche' la
-- voce mancasse, ma perche' la denylist NON e' retroattiva: `classify()` gira solo all'ingest e
-- quelle mail sono piu' vecchie della voce. Quel pezzo lo risolve l'azione `reapply_noise` di
-- cs-sync v17, non questa migrazione.
--
-- Gli altri tre non c'erano proprio. Si aggiungono come INDIRIZZI ESATTI, non come dominio:
-- `@google.com` in blocco spegnerebbe anche una eventuale persona vera, e non serve a niente.
-- Nessuna voce generica tipo "google": aggancerebbe googlemail.com, dove vivono clienti VERE
-- (caso reale a DB: una cliente su googlemail.com, ordine #1516).
--
-- Idempotente: la guardia sul `not like` impedisce di appendere due volte.
update app_flags
set value = value || E'\ngooglepay-noreply@google.com\npayments-noreply@google.com\ngemini-notes@google.com'
where key = 'cs_noise_senders'
  and value not like '%gemini-notes@google.com%';
