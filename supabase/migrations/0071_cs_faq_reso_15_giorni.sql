-- Reso: finestra di RICHIESTA 14 -> 15 giorni (decisione owner riunione 2026-07-23).
-- Cambia SOLO "entro 14 giorni dalla consegna" (finestra reso); NON tocca "entro 14 giorni sul metodo"
-- (tempi di RIMBORSO, invariati) ne' i "14 giorni del recesso" nel prompt cs-assist (diritto legale, resta 14).
-- Caveat owner: il sito (policy resi) dice ancora 14 giorni -> allineare a mano il tema Shopify (fuori scope).
update cs_faq set
  testo_it = replace(testo_it, 'entro 14 giorni dalla consegna', 'entro 15 giorni dalla consegna'),
  testo_en = replace(testo_en, 'within 14 days of delivery', 'within 15 days of delivery')
where testo_it like '%entro 14 giorni dalla consegna%' or testo_en like '%within 14 days of delivery%';
