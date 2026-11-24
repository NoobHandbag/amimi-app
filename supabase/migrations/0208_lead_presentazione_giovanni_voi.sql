-- 0208 (24-11, Giovanni e Dan): la presentazione del tocco 1 e' quella che Giovanni scrive a mano dal 20-11 (13 email
-- su 15 in lead_touches la riscrivevano: "come posso modificare il paragrafo della presentazione in modo che esca ogni
-- volta quello che sto mandando?", chat Amimi B2B del 23-11). Dan in chat il 24-11: "voi" in tutta la sequenza.
-- 1) boutique_it tocchi 1-4 al plurale ("vi scrivo", "Qui trovate", "nel vostro negozio"), tocco 1 con le due frasi di
--    presentazione di Giovanni; fascia 50-180 come dalla 0204 (Giovanni scriveva 190: resta 180, Dan 24-11).
--    Niente "a Milano" vicino al tessuto: "fatte a Milano" vale solo per la pelle (regola del cotone).
-- 2) boutique_en tocco 1 sulla sua email per Oslo, senza "handmade in Milan" accanto al cotone.
-- La telefonata (boutique_it 0) resta al "lei": parla con una persona. I tocchi 2-4 inglesi non cambiano.
-- Solo dati del modulo lead_* (Regola Ferrea 19). Le bozze gia' scritte in lead_drafts non si toccano: le rilegge la
-- persona prima di inviare. Before in change_log. Rollback: i before di change_log con source 'migr 0208'.

begin;

create temp table nuovi_testi (codice text, tocco int, oggetto text, corpo text, primary key (codice, tocco)) on commit drop;
insert into nuovi_testi values
('boutique_it', 1, 'Amimì Milano per {{nome_negozio}}: borse artigianali e line sheet wholesale',
E'Gentile {{referente}},\n\nsono Giovanni e vi scrivo per presentarvi Amimì Milano, un brand di borse che unisce artigianalità italiana, ricerca dei colori e uno stile contemporaneo.\n\nRealizziamo borse in pelle Made in Italy e modelli in tessuto colorato, con prezzi al pubblico compresi tra 50 e 180 euro.\n\n{{gancio}}\n\nQui trovate la nostra line sheet con modelli, colori e condizioni commerciali: {{linesheet}}\n\nPossiamo fissare un appuntamento nel nostro showroom a Milano o nel vostro negozio per mostrarvi qualche pezzo dal vivo?\n\nUn caro saluto,\n{{firma}}\nSe preferite non ricevere altre email da parte mia, rispondete "no grazie" e non vi contatterò più.'),
('boutique_it', 2, 'Re: Amimì Milano per {{nome_negozio}}',
E'Gentile {{referente}},\n\nvi riscrivo per sapere se avete ricevuto la mia email con la line sheet. Vi segnalo i tre pezzi che stanno funzionando meglio in questa stagione: la Lea in pelle cocco, la Nina in cotone colorato e gli accessori piccoli (cover e case), che al banco cassa girano bene.\n\nPossiamo fissare un appuntamento nel nostro showroom a Milano o nel vostro negozio per mostrarvi qualche pezzo dal vivo?\n\nUn caro saluto,\n{{firma}}'),
('boutique_it', 3, 'Un''idea per {{nome_negozio}}: partire in piccolo',
E'Gentile {{referente}},\n\ncapisco che di brand ne vedete tanti. La mia proposta è semplice: si parte con un ordine piccolo, solo i modelli che secondo voi stanno con la vostra clientela, e vediamo come vanno. Listino e condizioni sono nella line sheet: {{linesheet}}\n\nVi va se passo con il campionario?\n\nUn caro saluto,\n{{firma}}'),
('boutique_it', 4, 'Resto a disposizione',
E'Gentile {{referente}},\n\nnon voglio disturbarvi oltre. Vi lascio la nostra line sheet con modelli, colori e condizioni commerciali: {{linesheet}}\n\nSe in futuro vorrete inserire le nostre borse, mi trovate sempre qui. Vi auguro buon lavoro.\n\nUn caro saluto,\n{{firma}}\nNon vi contatterò ulteriormente salvo un vostro cenno.'),
('boutique_en', 1, 'Amimì Milano, handmade Italian bags for {{nome_negozio}}',
E'Dear {{referente}},\n\nI''m Giovanni from Amimì Milano, an independent Italian handbag brand combining craftsmanship, research into colour and a contemporary style.\n\nWe make bags in Made in Italy leather and lighter styles in coloured natural cotton, with retail prices from 50 to 180 euros.\n\n{{gancio}}\n\nHere is our line sheet, with styles, colours, wholesale prices and terms: {{linesheet}}\n\nI''d love to introduce you to the collection: would you be open to a short call or a visit to our showroom in Milan? I''d also be happy to send a few samples.\n\nWarm regards,\n{{firma}}\nIf you''d rather not hear from me again, just reply "no thanks" and I won''t contact you further.');

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_sequences', s.id::text, 'update', jsonb_build_object('oggetto', s.oggetto, 'corpo', s.corpo),
       jsonb_build_object('oggetto', n.oggetto, 'corpo', n.corpo), 'claude-code', 'migr 0208'
  from lead_sequences s join nuovi_testi n on n.codice = s.codice and n.tocco = s.tocco
 where s.corpo is distinct from n.corpo or s.oggetto is distinct from n.oggetto;

update lead_sequences s set oggetto = n.oggetto, corpo = n.corpo, updated_at = now()
  from nuovi_testi n
 where s.codice = n.codice and s.tocco = n.tocco
   and (s.corpo is distinct from n.corpo or s.oggetto is distinct from n.oggetto);

do $$
begin
  if (select count(*) from lead_sequences s join nuovi_testi n on n.codice = s.codice and n.tocco = s.tocco
       where s.corpo = n.corpo and s.oggetto = n.oggetto and s.canale = 'email') <> 5 then
    raise exception '0208: testi non aggiornati (attesi 5 template email)';
  end if;
  if exists (select 1 from lead_sequences where codice = 'boutique_it' and tocco between 1 and 4
              and corpo ~ '(Qui trova |nel suo negozio|secondo lei|Le va |disturbarla|preferisce non)') then
    raise exception '0208: resta un "lei" nei tocchi email italiani';
  end if;
end $$;

commit;
