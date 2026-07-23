-- CS Fase 3: A1 (Spedizione) non hardcoda piu' il link tracking generico.
-- La logica del corriere (amimi-ship/SyncShopify.gs twsTrackingUrl_): link PER-ORDINE
--   https://www.mytws.it/tracking-status;ldv=<LDV> (fallback generico twsexpresscourier.it solo se manca l'LDV).
-- cs-assist.fetchTracking gia' recupera quel link per-ordine e lo mette nel BLOCCO DATI; la bozza deve usare
--   QUELLO ([link tracking] riempito dai DATI), non una pagina generica. Se il tracking manca -> [DA VERIFICARE].
update cs_faq set
  testo_it = $q$Ciao [nome]! Ho controllato il tuo ordine [#numero]: risulta [stato] in data [data]. Puoi seguire la spedizione da questo link: [link tracking]. Se ti serve altro sono qui 💛 Grazie, Team Amimì$q$,
  testo_en = $q$Hi [name]! I checked your order [#number]: it is [status] as of [date]. You can track your shipment here: [tracking link]. I'm here if you need anything else 💛 Thanks, Team Amimì$q$
where tipo = 'risposta_standard' and titolo = 'A1 spedizione';
