-- 0119 (2026-09-13, richiesta owner in chat): aggiunge 4 domini alla denylist rumore
-- app_flags.cs_noise_senders. Notifiche personali/servizi (ikea.com, posteitaliane.it,
-- superbexperience.com) e uno scam per dominio (web-reviewteam.com): non erano spam-pitch (che
-- ora prende il pre-filtro cs-spam v19), ma mittenti legittimi/da bloccare per DOMINIO, fuori
-- dallo scopo del punteggio spam. Regola di DOMINIO (denyMatch di cs-sync): match sul SOLO
-- mittente, dominio o sottodominio, mai sull'oggetto -> non tocca una cliente che nomina "ikea".
-- Nota: 'posteinfo-noreply@posteitaliane.it' era gia' presente come indirizzo esatto ma il
-- mittente reale e' 'posteinfo-noreplay@...' (refuso 'noreplay'): la regola di dominio lo copre.
-- Idempotente: appende solo i domini non gia' presenti (confronto per riga intera); ri-eseguita
-- non cambia nulla e non aggiunge righe vuote.
update app_flags
set value = value || E'\n' || array_to_string(
  array(
    select d from unnest(array['ikea.com','posteitaliane.it','superbexperience.com','web-reviewteam.com']) as d
    where position(E'\n' || d || E'\n' in E'\n' || value || E'\n') = 0
  ), E'\n')
where key = 'cs_noise_senders'
  and (
    select count(*) from unnest(array['ikea.com','posteitaliane.it','superbexperience.com','web-reviewteam.com']) as d
    where position(E'\n' || d || E'\n' in E'\n' || value || E'\n') = 0
  ) > 0;
