-- 0149: outreach B2B allineato alla line sheet del 02-10-2026 (owner in chat, 03-10: "allinea tutto alla line sheet
-- nuova e pubblicala"). La pagina https://amimi.it/pages/amimi-trade dal 03-10 mostra listino e condizioni (v7).
-- Modulo lead_* (Regola Ferrea 19): solo lead_knowledge e lead_sequences, nessun dato core.
-- Cosa cambia: (1) lead_knowledge: condizioni DEFINITE (vendita ferma, niente conto vendita), line sheet con prezzi
-- in pagina, listino nuovo (wholesale = retail / 2,6); (2) template: l'email 1 non promette piu' di presentare il
-- listino all'appuntamento, perche' e' gia' nel link; l'email 3 rimanda a listino e condizioni.
-- Fonte dei numeri: LINESHEET_DRAFT_CON_MARGINI_GIUSTI.pdf del 02-10 (CASI_APERTI n.24). Il fido per negozio e la
-- formula del listino sono note interne: non entrano qui.
-- Rieseguibile: ogni update e' per titolo o per (codice, tocco) e il controllo finale conta le righe attese.

update lead_knowledge set
  titolo = 'Condizioni commerciali (line sheet del 02-10-2026)',
  contenuto = 'Il modello e'' vendita ferma: il conto vendita non c''e'' piu''. Primo ordine: 12 pezzi e almeno 400 euro netto IVA, mix libero. Riordino: 6 pezzi o 200 euro netto. Minimo per colore: 2 pezzi sulle borse, accessori liberi. Pagamento: primo ordine con bonifico anticipato su pro forma (sopra 1.000 euro, meta'' all''ordine e meta'' prima della spedizione); dal secondo ordine, 30 giorni data fattura. Consegna: pronto a magazzino spedito in 3 giorni; su ordine 3-4 settimane fino a 12 pezzi, 4-5 fino a 25, 6-7 fino a 50; Lea e Annie sono sempre su ordine; nessuna consegna in agosto. Spedizione: porto franco sopra 500 euro netto, sotto un contributo di 10-15 euro. Resi: nessun reso in denaro dell''invenduto; difetti segnalati con foto entro 7 giorni; cambio merce dei pezzi che ruotano meno a fronte di un riassortimento di pari valore, se a magazzino. Riassortimento rapido dai pezzi in pronta consegna: spedito in 3 giorni, con il supplemento indicato nella line sheet. Nessuna esclusiva territoriale: al massimo un negozio per localita'' piccola. Listino valido fino al 31 marzo 2027. Nelle email si rimanda alla line sheet; un dato si puo'' citare solo se identico a questo testo. Non si scrivono sconti, margini ne'' il credito concesso al negozio.'
where titolo like 'Condizioni commerciali%';

update lead_knowledge set
  titolo = 'Line sheet online (pagina riservata, solo per chi ha il link)',
  contenuto = 'La line sheet wholesale e'' su https://amimi.it/pages/amimi-trade (italiano) e https://amimi.it/pages/amimi-trade#en (inglese). Non e'' indicizzata e non e'' nel menu del sito. Per ogni modello mostra foto, materiale, varianti colore, prezzo wholesale (IVA esclusa) e retail consigliato (IVA inclusa); in fondo ci sono le condizioni: ordine minimo, pagamento, consegna, resi. Dal 03-10-2026 prezzi e condizioni sono in pagina. Nell''email si manda il link, non allegati.'
where titolo like 'Line sheet online%';

update lead_knowledge set
  titolo = 'Listino wholesale 2026 (pubblicato sulla line sheet dal 03-10-2026)',
  contenuto = 'Wholesale netto IVA e retail consigliato IVA inclusa, in euro. Lea Bag cocco e toasted: 51 e 135. Lea Bag pelli speciali (pony, cavallino, zebra), edizioni su richiesta: 63 e 165. Lea Bag Maxi: 71 e 185. Maria Bag: 51 e 135. Valentina Bag: 73 e 190, piccola produzione da magazzino senza riordino garantito. Nina Bag: 19 e 50. Nina Bag Maxi: 29 e 77. Laptop Cover: 18 e 49. Sunglass Cover: 7 e 20. Airpod Cover: 6 e 17. Annie e Agata solo nel Kit Amiche della Sposa: da 4 pezzi, da 80 a 120 euro a pezzo, produzione 6 settimane. Sophie non e'' a listino wholesale. Nelle email NON si riscrive il listino: si rimanda alla line sheet. Si puo'' citare la fascia al pubblico dei template, da 50 a 190 euro.'
where titolo like 'Listino wholesale%';

update lead_sequences set updated_at = now(), corpo = replace(replace(corpo,
  'Qui trova la nostra line sheet, con modelli, materiali e colori: {{linesheet}}',
  'Qui trova la nostra line sheet, con modelli, colori, listino wholesale e condizioni: {{linesheet}}'),
  ' In quell''occasione le presento anche il listino wholesale.', '')
where codice = 'boutique_it' and tocco = 1;

update lead_sequences set updated_at = now(), corpo = replace(corpo,
  'Il resto lo definiamo insieme all''appuntamento.',
  'Listino e condizioni sono nella line sheet: {{linesheet}}')
where codice = 'boutique_it' and tocco = 3;

update lead_sequences set updated_at = now(), corpo = replace(replace(corpo,
  'Here is our line sheet, with styles, materials and colours: {{linesheet}}',
  'Here is our line sheet, with styles, colours, wholesale prices and terms: {{linesheet}}'),
  'I''d also be glad to send a few samples and to go through the wholesale price list.',
  'I''d also be glad to send a few samples.')
where codice = 'boutique_en' and tocco = 1;

update lead_sequences set updated_at = now(), corpo = replace(corpo,
  'The rest we can define together at the meeting.',
  'Price list and terms are in the line sheet: {{linesheet}}')
where codice = 'boutique_en' and tocco = 3;

do $$
declare n_k int; n_s int; n_old int;
begin
  select count(*) into n_k from lead_knowledge
    where attiva and (titolo = 'Condizioni commerciali (line sheet del 02-10-2026)'
      or titolo = 'Listino wholesale 2026 (pubblicato sulla line sheet dal 03-10-2026)'
      or (titolo like 'Line sheet online%' and contenuto like '%prezzi e condizioni sono in pagina%'));
  select count(*) into n_s from lead_sequences
    where (codice, tocco) in (('boutique_it', 1), ('boutique_it', 3), ('boutique_en', 1), ('boutique_en', 3))
      and (corpo like '%listino wholesale e condizioni: {{linesheet}}%' or corpo like '%Listino e condizioni sono nella line sheet: {{linesheet}}%'
        or corpo like '%wholesale prices and terms: {{linesheet}}%' or corpo like '%Price list and terms are in the line sheet: {{linesheet}}%');
  select count(*) into n_old from lead_sequences
    where corpo like '%le presento anche il listino%' or corpo like '%go through the wholesale price list%'
      or corpo like '%definiamo insieme all''appuntamento%' or corpo like '%define together at the meeting%';
  if n_k <> 3 then raise exception '0149: attese 3 voci di lead_knowledge aggiornate, trovate %', n_k; end if;
  if n_s <> 4 then raise exception '0149: attesi 4 template aggiornati, trovati %', n_s; end if;
  if n_old <> 0 then raise exception '0149: restano % template con il testo vecchio', n_old; end if;
end $$;
