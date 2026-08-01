-- 0098 — conoscenza di casa: i prodotti che ci sono in magazzino ma NON si vendono.
--
-- Origine: brief cs_assist_migliorie punto 7, decisione dell'owner del 01-08 ("io direi riga
-- conoscenza"). Il caso: `LEA_BAG_CAVALLINO_CHOCOLATE` ha 1 pezzo e nel BLOCCO DATI compare come
-- disponibile ma "non a catalogo" (verificato il 01-08: giacenza 1, disponibili_da_vendere 1,
-- on_shopify false, nessuna scheda). Un modello puo' leggerlo come "ce l'abbiamo, non e' online,
-- quindi possiamo proporla", che e' esattamente cio' che non va fatto: per decisione dell'owner del
-- 17-06 quella borsa non si vende.
--
-- Perche' una riga di conoscenza e non un flag sul prodotto: e' UN prodotto, e il motivo e' una
-- decisione commerciale, non una proprieta' del dato. La riga si modifica senza deploy (la tocca
-- l'owner o Cowork) e arriva al modello dove serve, cioe' nel contesto in cui sceglie cosa
-- proporre. Il limite, dichiarato: e' una regola che il modello DEVE seguire, non un cancello che
-- glielo impedisce. Se un domani i prodotti da non vendere diventano cinque o sei, la risposta
-- giusta cambia: serve un flag sul prodotto, perche' un elenco dentro un paragrafo invecchia e
-- viene ignorato.
--
-- categoria NULL = riga trasversale: entra SEMPRE nel contesto, non solo su una categoria. Serve
-- cosi', perche' il rischio si presenta su Info prodotto, su Restock e su Altro allo stesso modo.

insert into public.cs_knowledge (categoria, titolo, contenuto, attiva)
values (
  null,
  'Prodotti che NON si vendono',
  'Alcuni prodotti risultano in giacenza ma non sono in vendita per decisione nostra: non proporli, non citarne la disponibilita'', non offrirli come alternativa, nemmeno se il BLOCCO DATI li mostra disponibili. Oggi l''elenco e'': LEA BAG CAVALLINO CHOCOLATE (codice LEA_BAG_CAVALLINO_CHOCOLATE). Se una cliente chiede proprio quel prodotto, non dire che ce l''abbiamo: proponi un''alternativa concreta fra quelle a catalogo e, se insiste, passa la richiesta a una persona.',
  true
);
