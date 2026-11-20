-- 0203: outreach B2B allineato alla line sheet 2026 (pagina https://amimi.it/pages/amimi-trade v8, pubblicata il
-- 20-11-2026; owner in chat lo stesso giorno: "Yes, align it"). Solo dati del modulo lead_* (Regola Ferrea 19):
-- due voci di lead_knowledge, nessun dato core, nessun template.
-- Cosa cambia: (1) "Listino wholesale": Lea in cavallino 62 e 165 a listino (era 63, su richiesta), Lea Maxi 69 e 180
-- (era 71 e 185), Annie e Agata 34 e 90 a listino (erano solo Kit Amiche della Sposa), Nina Maxi 28 e 70 (era 29 e 77);
-- Maria, Valentina, accessori in cotone e Kit non sono piu' nella line sheet. (2) "Line sheet online": la pagina ora ha
-- un capitolo per modello con tutti i colori e le condizioni in "Come funziona un ordine" e "Condizioni complete".
-- NON cambia, di proposito: la voce "Condizioni commerciali" (le condizioni sono le stesse; "Lea e Annie sempre su
-- ordine" e "accessori liberi" non sono piu' scritti in pagina: decisione owner aperta) e la fascia al pubblico
-- "da 50 a 190 euro" dei template e di Negozi.tsx (il massimo in line sheet ora e' 180: decisione owner aperta).
-- Rieseguibile: update per titolo, controllo finale che conta le righe attese.

update lead_knowledge set
  titolo = 'Listino wholesale 2026 (line sheet 2026, in pagina dal 20-11-2026)',
  contenuto = 'Wholesale netto IVA e retail consigliato IVA inclusa, in euro. Lea Bag (cocco, toasted, vernice, suede): 51 e 135. Lea Bag in cavallino (muccato, zebra, bambi, leopardo): 62 e 165. Lea Bag Maxi: 69 e 180. Annie Bag: 34 e 90. Agata Bag: 34 e 90. Nina Bag: 19 e 50. Nina Bag Maxi: 28 e 70. Maria, Valentina, Sophie, gli accessori in cotone e il Kit Amiche della Sposa non sono nella line sheet: nelle email non se ne danno i prezzi. Nelle email NON si riscrive il listino: si rimanda alla line sheet. Si puo'' citare la fascia al pubblico dei template, da 50 a 190 euro.',
  updated_at = now()
where titolo like 'Listino wholesale%';

update lead_knowledge set
  contenuto = 'La line sheet wholesale e'' su https://amimi.it/pages/amimi-trade (italiano) e https://amimi.it/pages/amimi-trade#en (inglese). Non e'' indicizzata e non e'' nel menu del sito. Dal 20-11-2026 segue la line sheet 2026: un capitolo per modello (Lea, Lea Maxi, Annie, Agata, Nina, Nina Maxi) con tutti i colori; per ogni colore foto, materiale e misure, per ogni modello prezzo wholesale (IVA esclusa) e retail consigliato (IVA inclusa). In fondo, "Come funziona un ordine" (scelta dal listino, ordine minimo, tempi di consegna) e il blocco "Condizioni complete" (pagamento, spedizione, resi, riassortimento, esclusiva). Nell''email si manda il link, non allegati.',
  updated_at = now()
where titolo like 'Line sheet online%';

do $$
declare n_l int; n_p int; n_old int;
begin
  select count(*) into n_l from lead_knowledge
    where attiva and titolo = 'Listino wholesale 2026 (line sheet 2026, in pagina dal 20-11-2026)'
      and contenuto like '%62 e 165%' and contenuto like '%69 e 180%' and contenuto like '%34 e 90%' and contenuto like '%28 e 70%';
  select count(*) into n_p from lead_knowledge
    where attiva and titolo like 'Line sheet online%' and contenuto like '%un capitolo per modello%';
  select count(*) into n_old from lead_knowledge
    where contenuto like '%71 e 185%' or contenuto like '%29 e 77%' or contenuto like '%63 e 165%' or contenuto like '%73 e 190%'
      or contenuto like '%solo nel Kit Amiche della Sposa%';
  if n_l <> 1 then raise exception '0203: attesa 1 voce "Listino wholesale" aggiornata, trovate %', n_l; end if;
  if n_p <> 1 then raise exception '0203: attesa 1 voce "Line sheet online" aggiornata, trovate %', n_p; end if;
  if n_old <> 0 then raise exception '0203: restano % voci di lead_knowledge con il listino della v7', n_old; end if;
end $$;
