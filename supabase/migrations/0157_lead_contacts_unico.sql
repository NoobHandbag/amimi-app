-- 0157_lead_contacts_unico.sql (2026-10-14, Regola Ferrea 20 primo capoverso)
--
-- lead_contacts: un contatto per account. Fino al 14-10 il dedup era solo nel codice: workers/lead/session_write.mjs
-- legge i contatti dell'account e confronta l'email senza maiuscole, o il nome se il contatto non ha email. "Controllo
-- e poi inserisco" cade con due sessioni che scrivono lo stesso negozio insieme; ora la chiave naturale e' a DB e
-- session_write tratta il 23505 come "gia presente".
--
-- Conteggio in sola lettura su prod il 14-10: 178 contatti (176 con email, 2 senza, tutti con nome), 0 doppioni per
-- (account_id, lower(email)) e 0 per (account_id, lower(nome)) senza email: niente da bonificare. Se un doppione
-- comparisse prima dell'apply, la create fallisce sul doppione e la migrazione non lascia niente a meta'.
--
-- Unici scrittori di lead_contacts: l'insert di session_write.mjs e il trigger lead_touches_apply (migr 0114), che
-- aggiorna solo opt_out e opt_out_at. lead-outreach e la PWA leggono soltanto.
--
-- Il nome conta solo fra i contatti senza email. Il codice resta piu' stretto (un contatto nuovo senza email e con lo
-- stesso nome di uno che l'email ce l'ha e' gia' presente): l'indice e' la rete sotto. Una riga senza email e senza nome
-- non collide mai.

create unique index if not exists lead_contacts_account_email_uq
  on lead_contacts (account_id, lower(email)) where email is not null;

create unique index if not exists lead_contacts_account_nome_uq
  on lead_contacts (account_id, lower(nome)) where email is null and nome is not null;
