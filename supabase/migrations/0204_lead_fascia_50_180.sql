-- 0204: fascia di prezzo al pubblico dell'outreach B2B da "50-190 euro" a "50-180 euro" (owner in chat, 20-11-2026:
-- "Yes, 50-180"). Con la line sheet 2026 (pagina amimi-trade v8, migr 0203) il retail piu' alto a listino e' 180
-- (Lea Bag Maxi): il 190 era la Valentina, che non e' piu' nella line sheet.
-- Solo dati del modulo lead_* (Regola Ferrea 19): tre template di lead_sequences e una voce di lead_knowledge.
-- Le bozze gia' scritte in lead_drafts non si toccano: le rilegge la persona prima di inviare.
-- Rieseguibile: replace sul testo, controllo finale che conta le righe attese.

update lead_sequences set updated_at = now(),
  corpo = replace(replace(replace(corpo,
    'dai 50 ai 190 euro', 'dai 50 ai 180 euro'),
    'da 50 a 190 euro', 'da 50 a 180 euro'),
    'from 50 to 190 euros', 'from 50 to 180 euros')
where corpo like '%dai 50 ai 190 euro%' or corpo like '%da 50 a 190 euro%' or corpo like '%from 50 to 190 euros%';

update lead_knowledge set updated_at = now(),
  contenuto = replace(contenuto, 'da 50 a 190 euro', 'da 50 a 180 euro')
where titolo like 'Listino wholesale%' and contenuto like '%da 50 a 190 euro%';

do $$
declare n_s int; n_k int; n_old int;
begin
  select count(*) into n_s from lead_sequences
    where (codice, tocco) in (('boutique_it', 0), ('boutique_it', 1), ('boutique_en', 1))
      and (corpo like '%dai 50 ai 180 euro%' or corpo like '%da 50 a 180 euro%' or corpo like '%from 50 to 180 euros%');
  select count(*) into n_k from lead_knowledge
    where attiva and titolo like 'Listino wholesale%' and contenuto like '%da 50 a 180 euro%';
  select (select count(*) from lead_sequences where corpo ~ '190 euro')
       + (select count(*) from lead_knowledge where contenuto ~ '190 euro') into n_old;
  if n_s <> 3 then raise exception '0204: attesi 3 template con la fascia 50-180, trovati %', n_s; end if;
  if n_k <> 1 then raise exception '0204: attesa 1 voce "Listino wholesale" con la fascia 50-180, trovate %', n_k; end if;
  if n_old <> 0 then raise exception '0204: restano % testi con "190 euro"', n_old; end if;
end $$;
