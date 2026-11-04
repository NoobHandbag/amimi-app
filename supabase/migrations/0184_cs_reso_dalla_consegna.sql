-- 0184 - conoscenza di casa: il reso si chiede entro 14 giorni dalla CONSEGNA (2026-11-04)
--
-- Origine: decisione di Dan del 03-11-2026 (CASI_APERTI n.54 (e3) nel repo hub): 14 giorni dalla
-- consegna e una sola email, info@. Quel giorno sono state allineate l'Informativa sui rimborsi e le
-- regole di reso di Shopify; cs-assist v31 conta la finestra dalla consegna. Restavano tre righe che
-- dicevano ancora "dalla data dell'ordine", e nel prompt della bozza avrebbero contraddetto il blocco
-- CASO: `cs_knowledge` 2 (valori operativi correnti, entra in ogni bozza), `cs_faq` 13 (risposta
-- standard "A7 reso", IT ed EN) e `cs_faq` 5 (esempio di tono "seed: reso", solo IT).
--
-- Cosa fa: sostituisce SOLO la frase della finestra, nient'altro di quelle righe. Le UPDATE sono
-- difensive: se il testo atteso non c'e' piu' (riga gia' corretta o cambiata a mano), la migrazione
-- solleva invece di sovrascrivere. Solo tabelle del modulo cs_* (Regola Ferrea 19).
-- Rollback: le stesse tre replace al contrario (testi di prima scritti qui sotto, nelle condizioni).

do $$
declare
  n int;
begin
  select count(*) into n from cs_knowledge
   where id = 2 and contenuto like '%RESO: richiesta entro 14 giorni dalla DATA DELL''ORDINE;%';
  if n <> 1 then
    raise exception 'cs_knowledge id 2: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_knowledge
     set contenuto = replace(contenuto, 'RESO: richiesta entro 14 giorni dalla DATA DELL''ORDINE;', 'RESO: richiesta entro 14 giorni dalla CONSEGNA;'),
         updated_at = now()
   where id = 2;

  select count(*) into n from cs_faq
   where id = 13 and tipo = 'risposta_standard' and categoria = 'Reso e rimborso'
     and testo_it like '%La richiesta va fatta entro 14 giorni dalla data dell''ordine e%'
     and testo_en like '%Requests must be made within 14 days of the order date and%';
  if n <> 1 then
    raise exception 'cs_faq id 13: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it, 'entro 14 giorni dalla data dell''ordine', 'entro 14 giorni dalla consegna'),
         testo_en = replace(testo_en, 'within 14 days of the order date', 'within 14 days of delivery')
   where id = 13;

  select count(*) into n from cs_faq
   where id = 5 and tipo = 'esempio_tono' and categoria = 'Reso e rimborso'
     and testo_it like '%La richiesta va fatta entro 14 giorni dalla data dell''ordine e%';
  if n <> 1 then
    raise exception 'cs_faq id 5: testo atteso non trovato (trovate % righe). Non sovrascrivo.', n;
  end if;
  update cs_faq
     set testo_it = replace(testo_it, 'entro 14 giorni dalla data dell''ordine', 'entro 14 giorni dalla consegna')
   where id = 5;

  -- Nessuna riga attiva del modulo deve piu' contare il reso dalla data dell'ordine.
  select count(*) into n from (
    select contenuto as t from cs_knowledge where attiva
    union all select coalesce(testo_it, '') || ' ' || coalesce(testo_en, '') from cs_faq where attiva
  ) s where s.t ~* '(dalla data dell.ordine|DALLA DATA DELL.ORDINE|of the order date)';
  if n <> 0 then
    raise exception 'restano % righe cs_* attive con la finestra di reso dalla data dell''ordine', n;
  end if;
end $$;
