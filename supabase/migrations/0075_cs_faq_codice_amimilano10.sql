-- Codice sconto: PERTE -> AMIMILANO10 (owner 2026-07-24: "sto sistemando AMIMI10, usalo come sistemato").
-- AMIMILANO10 e' il codice benvenuto/newsletter: coerente col messaggio "controlla in spam la mail di
-- benvenuto". Tocca A5 (risposta_standard) + l'esempio_tono codice sconto (IT+EN).
-- Applicata live via MCP il 24-07; file committato a posteriori (nota review avversariale Parte B).
update cs_faq set
  testo_it = replace(testo_it, 'PERTE', 'AMIMILANO10'),
  testo_en = replace(testo_en, 'PERTE', 'AMIMILANO10')
where testo_it like '%PERTE%' or testo_en like '%PERTE%';
